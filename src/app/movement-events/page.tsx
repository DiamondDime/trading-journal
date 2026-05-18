import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { listEvents, countEventsByKind } from "@/lib/db/events";
import { EventCard } from "@/components/event/event-card";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import type { MovementEventKind } from "@/types/canonical";

/**
 * /movement-events — the accounting feed.
 *
 * Lists every row from `event_log` for the user, with kind filters across
 * the top, sorted newest-first by `occurred_at`. event_log lives outside
 * the activity supertype, so this page is a peer of /spreads /trades
 * /sales /airdrops rather than another archive view.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  // Cookie read inside getT keeps this per-request.
  return {
    title: "Movement events · Crypto Journal",
    description: "Losses, write-offs, and manual book adjustments — things that touch P&L but aren't a trade.",
  };
}

const VALID_KINDS: MovementEventKind[] = [
  "bridge",
  "convert",
  "transfer",
  "deposit",
  "withdrawal",
  "nft_trade",
  "loss",
  "other",
];

function parseKindFilter(raw: string | string[] | undefined): MovementEventKind | null {
  if (typeof raw !== "string") return null;
  return (VALID_KINDS as string[]).includes(raw) ? (raw as MovementEventKind) : null;
}

function buildTitle(
  e: Pick<
    Awaited<ReturnType<typeof listEvents>>[number],
    "kind" | "asset" | "fromVenue" | "toVenue"
  >,
  kindLabel: string,
): string {
  if (e.asset && e.fromVenue && e.toVenue) {
    return `${e.asset} · ${e.fromVenue} → ${e.toVenue}`;
  }
  if (e.asset && e.toVenue) return `${e.asset} → ${e.toVenue}`;
  if (e.asset) return `${e.asset} · ${kindLabel}`;
  return kindLabel;
}

interface MovementEventsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function MovementEventsPage({ searchParams }: MovementEventsPageProps) {
  const { id: userId } = await requireUser();
  const t = await getT();
  const sp = await searchParams;

  const kindFilter = parseKindFilter(sp.kind);

  const [rows, byKind] = await Promise.all([
    listEvents(userId, {
      kind: kindFilter ? [kindFilter] : undefined,
      limit: 200,
    }),
    countEventsByKind(userId),
  ]);

  const total = Object.values(byKind).reduce((a, b) => a + b, 0);

  const kindLabel = (k: MovementEventKind): string => {
    const key = k === "nft_trade" ? "nftTrade" : k;
    return t(`wizard.movement.kinds.${key}.title` as const);
  };

  return (
    <article className="mx-auto max-w-[1100px] px-8 pb-16 pt-10">
      {/* Header */}
      <header className="mb-8 flex flex-col gap-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
          {t("movementEvents.eyebrow")}
        </p>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="font-serif text-[38px] font-medium leading-tight tracking-tight text-text">
              {t("movementEvents.title")}
            </h1>
            <p className="font-serif text-[14px] italic leading-snug text-text-secondary">
              {t("movementEvents.subtitle")}
            </p>
          </div>
          <Link
            href="/add/movement/kind"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            <Plus className="h-3 w-3" />
            {t("movementEvents.logMovement")}
          </Link>
        </div>
      </header>

      {/* Kind filter chips */}
      <nav
        aria-label={t("movementEvents.filterAria")}
        className="mb-8 flex flex-wrap items-center gap-1.5"
      >
        <FilterChip href="/movement-events" active={!kindFilter} label={t("movementEvents.all")} count={total} />
        {VALID_KINDS.map((k) => {
          const count = byKind[k] ?? 0;
          if (count === 0 && k !== kindFilter) return null;
          return (
            <FilterChip
              key={k}
              href={`/movement-events?kind=${k}`}
              active={k === kindFilter}
              label={kindLabel(k)}
              count={count}
            />
          );
        })}
      </nav>

      {/* Feed */}
      {rows.length === 0 ? (
        <EmptyState
          title={kindFilter ? t("movementEvents.empty.filteredTitle") : t("movementEvents.empty.title")}
          body={kindFilter ? t("movementEvents.empty.filteredBody") : t("movementEvents.empty.body")}
          ctaHref="/add/movement/kind"
          ctaLabel={t("movementEvents.logMovement")}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((e) => (
            <EventCard
              key={e.id}
              item={{
                id:         e.id,
                kind:       e.kind,
                title:      buildTitle(e, kindLabel(e.kind)),
                subtitle:   e.fromVenue && e.toVenue
                  ? `${e.fromVenue} → ${e.toVenue}`
                  : e.chain ?? null,
                asset:      e.asset,
                amount:     e.amount,
                usdValue:   e.usdValue,
                feeUsd:     e.feeUsd,
                occurredAt: e.occurredAt,
              }}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function FilterChip({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
        active
          ? "border-text bg-subtle text-text"
          : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
      )}
    >
      <span>{label}</span>
      <span className="text-text-tertiary">{count}</span>
    </Link>
  );
}

function EmptyState({
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  body: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <section className="rounded-md border border-dashed border-border bg-surface px-8 py-12 text-center">
      <h2 className="font-serif text-[20px] font-medium text-text">{title}</h2>
      <p className="mt-2 font-serif text-[14px] italic text-text-tertiary">{body}</p>
      <Link
        href={ctaHref}
        className="mt-6 inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
      >
        <Plus className="h-3 w-3" />
        {ctaLabel}
      </Link>
    </section>
  );
}
