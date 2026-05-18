import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { listRecentNotes, type RecentNoteRow } from "@/lib/db/notes";

const FEED_LIMIT = 6;

/** Map activity type → detail-page slug. */
function hrefFor(note: RecentNoteRow): string {
  switch (note.activityType) {
    case "spread":
      return `/spreads/${note.activityId}`;
    case "trade":
      return `/trades/${note.activityId}`;
    case "sale":
      return `/sales/${note.activityId}`;
    case "airdrop":
      return `/airdrops/${note.activityId}`;
    case "yield_position":
      return `/yield-positions/${note.activityId}`;
    case "option":
      return `/options/${note.activityId}`;
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtSerial(activityId: string): string {
  return `#${activityId.slice(0, 4).toUpperCase()}`;
}

/**
 * Take the first non-empty paragraph (or first 240 chars) of the markdown body
 * so the feed reads like the previous fixture-driven preview. Body comes back
 * as raw markdown; we don't render it as HTML — line breaks and surrounding
 * quotes are preserved.
 */
function previewOf(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  const para = trimmed.split(/\n\s*\n/, 1)[0];
  return para.length > 240 ? para.slice(0, 240).trimEnd() + "…" : para;
}

/**
 * Recent-notes feed for the dashboard. Server-fetches the N latest notes
 * across all activity types. Replaces the previous fixture data with a live
 * DB query (Wave 6).
 */
export async function NotesFeed() {
  const { id: userId } = await requireUser();
  const notes = await listRecentNotes(userId, FEED_LIMIT);

  if (notes.length === 0) {
    return (
      <div className="h-full rounded-md border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
            Recent notes
          </h3>
        </div>
        <div className="px-4 py-8 text-center">
          <p className="font-serif text-[13px] italic text-text-tertiary">
            No notes yet. Open any activity to write your first postmortem.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full rounded-md border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
          Recent notes
        </h3>
        <Link
          href="/spreads/archive"
          className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary hover:text-text"
        >
          {notes.length} recent <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="divide-y divide-border-subtle">
        {notes.map((n) => (
          <Link
            key={n.id}
            href={hrefFor(n)}
            className="block px-4 py-3 transition-colors hover:bg-subtle"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                {fmtDate(n.updatedAt)}
              </span>
              <span className="font-mono text-[10px] text-text-tertiary">·</span>
              <span className="font-mono text-[10px] text-signature">
                {fmtSerial(n.activityId)}
              </span>
              <span className="font-mono text-[10px] text-text-tertiary">·</span>
              <span className="text-[11px] text-text-secondary line-clamp-1">
                {n.activityName}
              </span>
            </div>
            <p className="font-serif text-[13px] italic leading-snug text-text line-clamp-2">
              {previewOf(n.body)}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
