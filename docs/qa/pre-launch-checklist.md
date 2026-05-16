# Pre-launch QA checklist

A manual + automated pass to run before tagging v1.0. Take screenshots
along the way and keep them with the release notes.

Owner: whoever's cutting the release.

---

## 1. Local install sanity

- [ ] Fresh clone on a clean machine (`git clone …`) installs in <2 minutes.
- [ ] `pnpm install` exits 0 with no peer-dep warnings worth chasing.
- [ ] `cp .env.example .env.local` + filling the three required vars
      (`DATABASE_URL`, `APP_USER_ID`, `CREDENTIALS_MASTER_KEY`) is enough
      to boot.
- [ ] `pnpm db:reset && pnpm db:seed` succeeds and prints
      "Seeded 12 spreads, 5 trades, 5 sales, 5 airdrops" (or current count).
- [ ] `pnpm dev` boots to <http://localhost:3000> in <10s.
- [ ] First page load `/spreads` renders <1s and shows non-empty KPIs.

## 2. Smoke pass (browser)

- [ ] `/spreads` — KPIs are real numbers; recent closes shows ≥1 card;
      clicking a card opens its detail page.
- [ ] `/spreads/archive` — table renders, filter chips toggle, the
      Reset link clears all params from the URL.
- [ ] Direct deep-link `/spreads/archive?activity=trade&outcome=winners`
      restores both filters on reload.
- [ ] `/spreads/<uuid>` for a seeded spread — renders.
- [ ] `/trades/<uuid>` for a seeded trade — renders.
- [ ] `/sales/<uuid>` for a seeded sale — renders.
- [ ] `/airdrops/<uuid>` for a seeded airdrop — renders.
- [ ] `/spreads/bad-id` returns 404 (not 500).
- [ ] `/trades/sa-001` (legacy non-UUID id) returns 404 (not 500).

## 3. Wizard happy paths

All four wizards must take a fresh user from `/add` to a persisted row
and a "Just saved" banner.

- [ ] **Trade** — `/add` → Trade card → Manual entry → fill all fields
      → Review → Log trade → lands on `/trades/<uuid>?from=wizard` with
      banner; reload shows row still there.
- [ ] **Sale** — `/add` → Sale card → fill all fields → Review →
      Log sale → lands on `/sales/<uuid>?from=wizard`.
- [ ] **Airdrop** — `/add` → Airdrop card → fill all fields → Review
      → Log airdrop → lands on `/airdrops/<uuid>?from=wizard`.
- [ ] **Spread** — `/add` → Spread → Source → pick imported fills →
      pick type → fill → Review → land on `/spreads/<uuid>?from=wizard`.

## 4. Edit & delete (Wave 6)

E2E coverage: three flows in `e2e/edit-delete.spec.ts` exercise the trade
edit / trade delete / edit-cancel paths automatically. Sale, Airdrop, and
Spread edit/delete are smoke-checked manually below.

- [ ] `pnpm e2e --project chromium e2e/edit-delete.spec.ts` — all 3 specs
      green.
- [ ] Manually: Trade detail Edit button → wizard pre-fills → save →
      "Updated" banner on the same trade URL. (Automated.)
- [ ] Manually: Trade detail Delete button → confirm modal → row gone
      from list, direct deep-link returns 404. (Automated.)
- [ ] Manually: Repeat Edit + Delete for Sale, Airdrop, Spread.
- [ ] After delete, `pnpm db:psql` shows `deleted_at IS NOT NULL` on the
      activity row (soft delete, not hard).

## 5. Settings — exchanges

- [ ] `/settings/exchanges` loads.
- [ ] When no connections exist, the empty-state CTA renders.
- [ ] Click "Connect your first exchange" / "Add exchange" opens the
      dialog. Esc closes without writing.
- [ ] Pick an exchange (Binance), reach Step 2 (credentials).
- [ ] Submit fake credentials with `withdraw` permission in the API key
      → connect rejects + UI shows the error message.
- [ ] Submit a valid read-only key → row appears in the table with the
      correct masked hint.
- [ ] Click Sync now on a connection — status transitions through
      `syncing` → `active` (or `error` with a clear message).
- [ ] Delete a connection → confirm modal → row gone from table.

## 6. Worker (CLI)

- [ ] `cd worker && uv run pytest` — all green.
- [ ] `pnpm worker:once` with no live connections exits 0 in <2s.
- [ ] `pnpm worker:once` with one valid Binance read-only connection
      ingests at least one page of fills, then runs the matcher.
- [ ] Worker logs are valid JSON lines (one object per line) and contain
      NO plaintext credentials (`grep -i "secret\|api[_-]key" logs/*` is empty).
- [ ] Daemon mode (`pnpm worker:dev`) survives a SIGTERM cleanly
      (`pkill -TERM -f csj_worker` then watch the log; should write
      `daemon.stopped` then exit).

## 7. Automated suites

- [ ] `pnpm typecheck` — exit 0, zero errors.
- [ ] `pnpm test:db:setup && pnpm test:run` — all Vitest tests green
      (3 unit files + 2 integration files; 1 expected `.fails()` flagging
      a known UUID-validation bug — see "Known bugs" below).
- [ ] `pnpm e2e` — all 8 E2E specs green; ~6s total wall time.
- [ ] `cd worker && uv run pytest` — all green.
- [ ] Run all three suites three times in a row — no flake.

## 8. Build + deploy rehearsal

- [ ] `pnpm build` — exit 0; bundle <3MB JS.
- [ ] `docker compose config` — exit 0, no warnings.
- [ ] `docker compose up -d` then `docker compose down --volumes` round-trips
      without leaving orphans.
- [ ] Rollback rehearsal: revert the last release commit on a copy of the
      DB, restart the worker, dashboard still renders.

## 9. Security smoke

- [ ] No `console.log` in the React tree on production build
      (`pnpm build && grep "console\." .next/static/chunks/*.js` returns
      nothing more interesting than expected library logs).
- [ ] `Set-Cookie: …Secure; HttpOnly` on auth cookies once auth lands
      (single-user mode in v1 has no cookies — skip).
- [ ] localStorage / sessionStorage are empty on first load
      (DevTools → Application → Storage).
- [ ] Network panel shows no plaintext API keys flying between the
      browser and the server (credentials must go in encrypted server-side).
- [ ] `pnpm audit --prod` — no high/critical vulnerabilities. Document any
      moderate ones we accept.

## 10. Accessibility smoke

- [ ] Tab through `/spreads` end-to-end — every interactive element is
      reachable and has a visible focus ring.
- [ ] Tab through the trade wizard — every input is reachable in DOM order.
- [ ] Color contrast spot-check via DevTools on signature amber + on the
      down-tone red — both AA against background.
- [ ] Screen-reader smoke (VoiceOver on macOS) — read the dashboard top
      to bottom; KPIs are announced with their numeric value.

## 11. Editorial design tokens

- [ ] Dashboard hero uses the signature amber ONCE (the net-P&L row).
      Other secondary metrics use the neutral palette.
- [ ] Detail page hero uses the signature amber ONCE for the headline metric.
- [ ] No `href="#"` anywhere outside of intentional dev placeholders.
- [ ] No "Coming soon" placeholders in launchable surfaces.

## 12. Documentation

- [ ] `README.md` install steps work on a fresh clone (verified in §1).
- [ ] `CLAUDE.md` and `AGENTS.md` reflect the current architecture.
- [ ] `docs/specs/2026-05-16-multi-activity-journal-design.md` is up to date.
- [ ] Known bugs section below is current.

---

## Known bugs (carried into post-launch)

The Vitest suite contains tests marked `.fails()` that document bugs we
ship around rather than block on. As of Wave 7:

1. **`DELETE /api/activities/[id]` returns 500 on non-UUID input** — the
   GET handler short-circuits to 404 via `UUID_RE.test(id)`, but DELETE
   and PATCH skip that guard and hit Postgres directly, raising
   `invalid input syntax for type uuid`. Mirror the guard into
   `deleteActivity` and `updateActivity` in src/lib/db/activity.ts.
   Test: tests/integration/api-activities.test.ts → "returns 404 for a
   non-UUID string (BUG: currently 500)".

2. **PATCH same sibling bug** — see (1).

When a `.fails()` test starts failing in CI it means the bug is fixed;
remove the `.fails` marker and the test becomes a regression guard.
