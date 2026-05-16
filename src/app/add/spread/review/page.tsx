import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardSummaryRow } from "@/components/wizard/wizard-summary-row";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getImportedFillById,
  type ImportedTradeFill,
} from "@/lib/data/exchange-fills-mock";
import {
  SPREAD_TYPE_LABELS,
  type MatcherSpreadType,
} from "@/lib/matcher/spread-matcher";
import { cn } from "@/lib/utils";
import { logSpread } from "../actions";
import { WizardErrorBanner } from "@/components/wizard/wizard-error-banner";

const STEP_LABELS = ["Source", "Pick legs", "Type", "Fields", "Review"] as const;

// Field names round-tripped through the GET-form submit on /fields. Stays in
// sync with that page's input names.
const SPREAD_FIELDS = [
  "legs",
  "matcher",
  "spreadType",
  "name",
  "variant",
  "openedAt",
  "closedAt",
  "capital",
  "netPnl",
  "headlineUnit",
  "headlineValue",
  "thesis",
  "regimeTags",
  "edit",
] as const;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(
  sp: Awaited<Search>,
  key: string,
  fallback = ""
): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return fallback;
}

function parseNum(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmtUsd(n: number, signed = false): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  return `${sign}$${abs}`;
}

function fmtCapital(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPrice(n: number) {
  if (n < 1) return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtQty(n: number) {
  if (n >= 1_000_000) return n.toExponential(2);
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n < 1) return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb) || tb <= ta) return 0;
  return (tb - ta) / (1000 * 60 * 60 * 24);
}

function fmtDays(d: number): string {
  if (d === 0) return "—";
  if (d < 1) {
    const hours = d * 24;
    if (hours < 1) return `${Math.round(hours * 60)} min`;
    return `${hours.toFixed(1)}h`;
  }
  if (d < 30) return `${d.toFixed(1)}d`;
  return `${d.toFixed(0)}d`;
}

const SPREAD_TYPE_VALUES: readonly string[] = [
  "cash_carry",
  "funding",
  "cross_exchange",
  "calendar",
  "dex_cex",
];
function isSpreadType(v: string): v is MatcherSpreadType {
  return SPREAD_TYPE_VALUES.includes(v);
}

export default async function SpreadReviewPage(props: { searchParams: Search }) {
  const sp = await props.searchParams;

  const legsStr = getStr(sp, "legs");
  const legIds = legsStr.split(",").filter(Boolean);
  const legs = legIds
    .map((id) => getImportedFillById(id))
    .filter((l): l is ImportedTradeFill => !!l);

  const v = {
    spreadType: getStr(sp, "spreadType"),
    matcher: getStr(sp, "matcher"),
    name: getStr(sp, "name"),
    variant: getStr(sp, "variant"),
    openedAt: getStr(sp, "openedAt"),
    closedAt: getStr(sp, "closedAt"),
    capital: getStr(sp, "capital"),
    netPnl: getStr(sp, "netPnl"),
    headlineUnit: getStr(sp, "headlineUnit", "APR"),
    headlineValue: getStr(sp, "headlineValue"),
    thesis: getStr(sp, "thesis"),
    regimeTags: getStr(sp, "regimeTags"),
  };

  const capital = parseNum(v.capital);
  const netPnl = parseNum(v.netPnl);
  const headlineValue = parseNum(v.headlineValue);
  const days = daysBetween(v.openedAt, v.closedAt);

  // Build the "Edit all" link with every field round-tripped back to /fields.
  const editParams = new URLSearchParams();
  for (const k of SPREAD_FIELDS) {
    const val = getStr(sp, k);
    if (val) editParams.append(k, val);
  }
  const editAllHref = `/add/spread/fields?${editParams.toString()}`;
  const isEditing = getStr(sp, "edit") !== "";

  const headlineTone = netPnl >= 0 ? "up" : "down";
  const headlineSign = headlineValue >= 0 ? "+" : "−";
  const headlineLabel = v.headlineValue
    ? `${headlineSign}${Math.abs(headlineValue).toFixed(1)}${v.headlineUnit === "APR" ? "%" : ""}`
    : "—";

  return (
    <WizardShell
      type="spread"
      step={5}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title={isEditing ? "Confirm changes" : "Look it over"}
      subtitle={
        isEditing
          ? "Saving these changes to the same record. Edit any row to bounce back to the fields step."
          : "One last pass before this hits your journal. Edit any row to bounce back to the fields step."
      }
    >
      <WizardErrorBanner error={getStr(sp, "error") || undefined} />
      {/* ── Hero preview (signature amber) ────────────────────────────────── */}
      <section className="border-y border-border py-10">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            Realized {v.headlineUnit} · preview
          </p>
          <div className="flex items-baseline gap-3">
            <span
              className="font-serif font-normal leading-none text-signature"
              style={{ fontSize: "clamp(48px, 7vw, 72px)" }}
            >
              {headlineLabel}
            </span>
            <span className="font-serif text-xl font-normal text-text-tertiary">
              {v.headlineUnit}
            </span>
          </div>
          <p className="mt-2 font-mono text-[13px] text-text-secondary">
            Net{" "}
            <span
              className={
                headlineTone === "up"
                  ? "text-up font-medium"
                  : "text-down font-medium"
              }
            >
              {fmtUsd(netPnl, true)}
            </span>{" "}
            on {fmtCapital(capital)} capital
            {days > 0 && (
              <>
                {" · "}
                {fmtDays(days)} held
              </>
            )}
          </p>
        </div>
      </section>

      {/* ── Identity ──────────────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Identity
        </h2>
        <div>
          <WizardSummaryRow
            label="Name"
            value={v.name || "—"}
            editHref={editAllHref}
            mono={false}
          />
          <WizardSummaryRow
            label="Variant"
            value={v.variant || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Type"
            value={
              isSpreadType(v.spreadType)
                ? SPREAD_TYPE_LABELS[v.spreadType]
                : "—"
            }
            editHref={editAllHref}
          />
          {v.matcher && (
            <WizardSummaryRow
              label="Source"
              value={
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                  {v.matcher === "auto" ? "Matcher suggestion" : "Manual selection"}
                </span>
              }
            />
          )}
        </div>
      </section>

      {/* ── Legs ──────────────────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Legs ({legs.length})
        </h2>
        <p className="mb-3 font-serif text-[11px] italic leading-snug text-text-tertiary">
          In v1, manual spreads store the aggregate numbers and thesis only —
          this leg breakdown is for your reference. Individual leg rows are
          auto-populated when the worker matches exchange fills (Phase 7).
        </p>
        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col" className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  Symbol
                </TableHead>
                <TableHead scope="col" className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  Venue
                </TableHead>
                <TableHead scope="col" className="font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  Side
                </TableHead>
                <TableHead scope="col" className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  Qty
                </TableHead>
                <TableHead scope="col" className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  Entry → Exit
                </TableHead>
                <TableHead scope="col" className="text-right font-serif text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  Net P&amp;L
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {legs.map((l) => (
                <TableRow key={l.id} className="hover:bg-transparent">
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-serif text-[13px] font-medium text-text">
                        {l.symbol}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
                        {l.instrument}
                        {l.expiry ? ` · ${l.expiry}` : ""}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-text-secondary">
                    {l.exchange}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "font-mono text-[10px] uppercase tracking-[0.14em]",
                        l.side === "long" ? "text-up" : "text-down"
                      )}
                    >
                      {l.side}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums text-text-secondary">
                    {fmtQty(l.qty)}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono text-[11px] tabular-nums text-text">
                      {fmtPrice(l.entryPrice)}
                    </span>
                    <span className="mx-1 text-text-tertiary">→</span>
                    <span className="font-mono text-[11px] tabular-nums text-text-secondary">
                      {fmtPrice(l.exitPrice)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={cn(
                        "font-mono text-[11px] font-medium tabular-nums",
                        l.tone === "up" ? "text-up" : "text-down"
                      )}
                    >
                      {fmtUsd(l.netPnl, true)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ── Numbers + timing ──────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Numbers
        </h2>
        <div>
          <WizardSummaryRow
            label="Capital"
            value={capital > 0 ? fmtUsd(capital) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Net P&L"
            value={fmtUsd(netPnl, true)}
            tone={netPnl >= 0 ? "up" : "down"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label={`Headline (${v.headlineUnit})`}
            value={headlineLabel}
            tone="signature"
            editHref={editAllHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Timing
        </h2>
        <div>
          <WizardSummaryRow
            label="Opened"
            value={fmtDate(v.openedAt)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Closed"
            value={fmtDate(v.closedAt)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Days held"
            value={days > 0 ? fmtDays(days) : "—"}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Thesis &amp; tags
        </h2>
        <div>
          <WizardSummaryRow
            label="Regime tags"
            value={v.regimeTags || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Thesis"
            value={v.thesis || "—"}
            editHref={editAllHref}
            mono={false}
          />
        </div>
      </section>

      {/* ── Submit ────────────────────────────────────────────────────────── */}
      <form action={logSpread} className="mt-10">
        {SPREAD_FIELDS.map((k) => (
          <input key={k} type="hidden" name={k} value={getStr(sp, k)} />
        ))}

        <div className="flex items-center justify-between border-t border-border pt-6">
          <Link
            href={editAllHref}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-5 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            {isEditing ? "Save changes" : "Log spread"}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </form>
    </WizardShell>
  );
}
