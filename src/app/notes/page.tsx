/**
 * /notes — second-brain feed: every postmortem the user has written across
 *           every activity, searchable / filterable / sortable.
 *
 * Server component: server-side renders the initial filter + sort state from
 * the URL search params, fetches the first page, and hands a client component
 * the data + the full tag vocabulary for the chip rail. Pagination ("load
 * more") happens client-side via the same endpoint shape — see notes-browser.
 *
 * v1 SQL implementation note: search is ILIKE on `notes.body` (trigram-indexed
 * via `notes_body_trgm`). For scales beyond mid-five-figure note counts the
 * obvious upgrade is a generated tsvector column + tsquery — the helper's
 * call signature absorbs that change with no API breakage.
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth/server";
import { listAllNotes, countAllNotes, type NoteListFilters } from "@/lib/db/notes";
import { listAllTagsForUser } from "@/lib/db/satellite";
import { NotesBrowser } from "@/components/notes/notes-browser";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: `${t("notes.title")} · ${t("app.name")}`,
    description: t("notes.subtitle"),
  };
}

interface NotesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PAGE_SIZE = 20;

type NoteActivityType = NonNullable<NoteListFilters["activityType"]>[number];

function parseTypes(
  raw: string | string[] | undefined,
): NoteListFilters["activityType"] {
  if (typeof raw !== "string") return undefined;
  const valid = new Set<NoteActivityType>([
    "spread",
    "trade",
    "sale",
    "airdrop",
    "yield_position",
    "option",
  ]);
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is NoteActivityType => valid.has(s as NoteActivityType));
  return parts.length > 0 ? parts : undefined;
}

function parseSort(raw: string | string[] | undefined): NoteListFilters["sort"] {
  if (raw === "oldest" || raw === "longest" || raw === "edited" || raw === "newest") {
    return raw;
  }
  return "newest";
}

function stringParam(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export default async function NotesPage({ searchParams }: NotesPageProps) {
  const { id: userId } = await requireUser();
  const sp = await searchParams;

  const filters: NoteListFilters = {
    activityType: parseTypes(sp.type),
    tag: stringParam(sp.tag),
    search: stringParam(sp.q),
    sort: parseSort(sp.sort),
    limit: PAGE_SIZE,
    offset: 0,
  };

  const [notes, totalCount, tagVocab] = await Promise.all([
    listAllNotes(userId, filters),
    countAllNotes(userId, {
      activityType: filters.activityType,
      tag: filters.tag,
      search: filters.search,
    }),
    listAllTagsForUser(userId),
  ]);

  return (
    <Suspense fallback={null}>
      <NotesBrowser
        initialNotes={notes}
        totalCount={totalCount}
        tagVocab={tagVocab}
        pageSize={PAGE_SIZE}
        initialFilters={{
          type: filters.activityType ?? [],
          tag: filters.tag ?? "",
          search: filters.search ?? "",
          sort: filters.sort ?? "newest",
        }}
      />
    </Suspense>
  );
}
