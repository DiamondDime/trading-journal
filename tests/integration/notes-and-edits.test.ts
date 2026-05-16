/**
 * Wave 6 contract tests — locks in the surface introduced in Wave 6 so future
 * refactors don't silently break it.
 *
 * Covered:
 *   • updateTradeActivity / updateSaleActivity / updateAirdropActivity happy
 *     paths — subtype patches actually land in the right table.
 *   • upsertNote blind insert returns a fresh row.
 *   • upsertNote optimistic concurrency — expectedVersion match bumps, mismatch
 *     throws NoteVersionConflict.
 *   • Soft-deleted activity hides its note from getNoteForActivity.
 *
 * Terse on purpose — one assert per scenario unless a second is structurally
 * required. Edge cases live in activity.test.ts; this file scopes to the Wave
 * 6 contract.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@/lib/db/client';
import {
  updateTradeActivity,
  updateSaleActivity,
  updateAirdropActivity,
  deleteActivity,
} from '@/lib/db/activity';
import {
  upsertNote,
  getNoteForActivity,
  NoteVersionConflict,
} from '@/lib/db/notes';
import {
  seedTestUser,
  resetUserData,
  seedTradeActivity,
  seedSaleActivity,
  seedAirdropActivity,
  seedActivityWithNote,
  TEST_USER_ID,
} from '../helpers/db';

let testUser: Awaited<ReturnType<typeof seedTestUser>>;

beforeAll(async () => {
  testUser = await seedTestUser(TEST_USER_ID);
});

beforeEach(async () => {
  await resetUserData(TEST_USER_ID);
});

afterAll(async () => {
  await sql.end();
});

// ============================================================================
// Subtype updates — happy paths
// ============================================================================

describe('updateTradeActivity', () => {
  it('persists subtype changes (symbol) to activity_trade', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const ok = await updateTradeActivity(
      TEST_USER_ID,
      id,
      {},
      { symbol: 'ETH-PERP' },
    );
    expect(ok).toBe(true);
    const [row] = await sql<{ symbol: string }[]>`
      SELECT symbol FROM public.activity_trade WHERE activity_id = ${id}::uuid
    `;
    expect(row.symbol).toBe('ETH-PERP');
  });
});

describe('updateSaleActivity', () => {
  it('persists subtype changes (tokenSymbol) to activity_sale', async () => {
    const id = await seedSaleActivity({ asset: 'EIGEN' });
    const ok = await updateSaleActivity(
      TEST_USER_ID,
      id,
      {},
      { tokenSymbol: 'NEW' },
    );
    expect(ok).toBe(true);
    const [row] = await sql<{ tokenSymbol: string }[]>`
      SELECT token_symbol FROM public.activity_sale WHERE activity_id = ${id}::uuid
    `;
    expect(row.tokenSymbol).toBe('NEW');
  });

  it('persists parent closed_at + fees_usd patches (Wave 8 fix M-6)', async () => {
    const id = await seedSaleActivity({});
    const closedAt = '2026-06-01T00:00:00Z';
    const ok = await updateSaleActivity(
      TEST_USER_ID,
      id,
      { closedAt, feesUsd: '7.25' },
      {},
    );
    expect(ok).toBe(true);
    const [row] = await sql<{ closedAt: string | Date; feesUsd: string }[]>`
      SELECT closed_at, fees_usd FROM public.activity WHERE id = ${id}::uuid
    `;
    const closedIso = row.closedAt instanceof Date ? row.closedAt.toISOString() : String(row.closedAt);
    expect(closedIso).toContain('2026-06-01');
    expect(Number(row.feesUsd)).toBeCloseTo(7.25, 5);
  });
});

describe('updateAirdropActivity', () => {
  it('persists subtype changes (qtyReceived) to activity_airdrop', async () => {
    const id = await seedAirdropActivity({});
    const ok = await updateAirdropActivity(
      TEST_USER_ID,
      id,
      {},
      { qtyReceived: '500' },
    );
    expect(ok).toBe(true);
    const [row] = await sql<{ qtyReceived: string }[]>`
      SELECT qty_received FROM public.activity_airdrop WHERE activity_id = ${id}::uuid
    `;
    expect(Number(row.qtyReceived)).toBeCloseTo(500, 5);
  });
});

// ============================================================================
// upsertNote — insert + version conflict
// ============================================================================

describe('upsertNote', () => {
  it('inserts a brand-new note and returns it', async () => {
    const activityId = await seedTradeActivity({
      connectionId: testUser.connectionId,
    });
    const note = await upsertNote(TEST_USER_ID, activityId, 'first draft');
    expect(note.body).toBe('first draft');
    expect(note.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('updates body when expectedVersion matches, advances updated_at', async () => {
    const activityId = await seedTradeActivity({
      connectionId: testUser.connectionId,
    });
    const inserted = await upsertNote(TEST_USER_ID, activityId, 'v1');
    // Small delay so tg_set_updated_at moves the timestamp forward by more
    // than 1ms (Postgres timestamptz millisecond precision could otherwise
    // leave updatedAt unchanged on a very fast machine).
    await new Promise((r) => setTimeout(r, 10));
    const updated = await upsertNote(TEST_USER_ID, activityId, 'v2', inserted.updatedAt);
    expect(updated.body).toBe('v2');
    expect(updated.updatedAt).not.toBe(inserted.updatedAt);
  });

  it('throws NoteVersionConflict when expectedVersion is stale', async () => {
    const activityId = await seedTradeActivity({
      connectionId: testUser.connectionId,
    });
    const inserted = await upsertNote(TEST_USER_ID, activityId, 'v1');
    await new Promise((r) => setTimeout(r, 10));
    // First update bumps the version.
    await upsertNote(TEST_USER_ID, activityId, 'v2', inserted.updatedAt);
    // Second update with the original (now-stale) version should conflict.
    await expect(
      upsertNote(TEST_USER_ID, activityId, 'v3', inserted.updatedAt),
    ).rejects.toBeInstanceOf(NoteVersionConflict);
  });
});

// ============================================================================
// Soft-delete cascade
// ============================================================================

describe('getNoteForActivity + soft delete', () => {
  it('hides the note once the parent activity is soft-deleted (Wave 8 fix B-3)', async () => {
    const { activityId, noteId } = await seedActivityWithNote({
      connectionId: testUser.connectionId,
      noteBody: 'kept text',
    });
    // Pre-condition: note is visible.
    const before = await getNoteForActivity(TEST_USER_ID, activityId);
    expect(before?.id).toBe(noteId);

    // Soft-delete the parent activity.
    const ok = await deleteActivity(TEST_USER_ID, activityId);
    expect(ok).toBe(true);

    // Now the note must look gone via the public read path even though the
    // row physically still exists (cascade is logical, not physical).
    const after = await getNoteForActivity(TEST_USER_ID, activityId);
    expect(after).toBeNull();
  });
});
