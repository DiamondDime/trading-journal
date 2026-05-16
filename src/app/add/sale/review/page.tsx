import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardSummaryRow } from "@/components/wizard/wizard-summary-row";
import { WizardErrorBanner } from "@/components/wizard/wizard-error-banner";
import { logSale } from "../actions";

const STEP_LABELS = ["Details", "Review"] as const;

const SALE_FIELDS = [
  "saleKind",
  "venue",
  "asset",
  "usdPaid",
  "tokensAllocated",
  "tgeDate",
  "tgeUnlockPct",
  "vestingCliffMonths",
  "vestingDurationMonths",
  "currentPriceUsd",
  "openedAt",
  "note",
  "regimeTags",
] as const;

const SALE_KIND_LABELS: Record<string, string> = {
  ido: "IDO",
  launchpad: "Launchpad",
  premarket: "Premarket",
  otc: "OTC",
};

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

// ── Pure helpers ────────────────────────────────────────────────────────────

function fmtUsd(n: number, signed = false): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  return `${sign}$${abs}`;
}

function parseNum(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtMultiplier(m: number): string {
  // Sale headlines use a ×N format. Show 2 decimals up to 9.99×, then 1 dp.
  const formatted = m >= 10 ? m.toFixed(1) : m.toFixed(2);
  return `${formatted}×`;
}

function fmtTokens(n: number): string {
  if (n === 0) return "—";
  return n.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

export default async function SaleReviewPage(props: { searchParams: Search }) {
  const sp = await props.searchParams;

  const v = {
    saleKind: getStr(sp, "saleKind"),
    venue: getStr(sp, "venue"),
    asset: getStr(sp, "asset"),
    usdPaid: getStr(sp, "usdPaid"),
    tokensAllocated: getStr(sp, "tokensAllocated"),
    tgeDate: getStr(sp, "tgeDate"),
    tgeUnlockPct: getStr(sp, "tgeUnlockPct", "0"),
    vestingCliffMonths: getStr(sp, "vestingCliffMonths", "0"),
    vestingDurationMonths: getStr(sp, "vestingDurationMonths", "0"),
    currentPriceUsd: getStr(sp, "currentPriceUsd"),
    openedAt: getStr(sp, "openedAt"),
    note: getStr(sp, "note"),
    regimeTags: getStr(sp, "regimeTags"),
  };

  const usdPaid = parseNum(v.usdPaid);
  const tokens = parseNum(v.tokensAllocated);
  const currentPrice = parseNum(v.currentPriceUsd);
  const tgeUnlock = parseNum(v.tgeUnlockPct);
  const cliffMonths = parseNum(v.vestingCliffMonths);
  const durationMonths = parseNum(v.vestingDurationMonths);

  const currentValue = tokens * currentPrice;
  // MTM × = current_value / usd_paid. Guard against div-by-zero — a
  // missing usd_paid renders as "—" instead of Infinity.
  const multiplier = usdPaid > 0 ? currentValue / usdPaid : 0;
  const netPnl = currentValue - usdPaid;
  const headlineTone = multiplier >= 1 ? "up" : "down";

  const editAllHref = `/add/sale/fields?${new URLSearchParams(
    Object.fromEntries(
      SALE_FIELDS.map((k) => [k, getStr(sp, k)] as const).filter(
        ([, val]) => val !== ""
      )
    )
  ).toString()}`;

  return (
    <WizardShell
      type="sale"
      step={2}
      totalSteps={2}
      stepLabels={STEP_LABELS}
      title="Look it over"
      subtitle="One last pass before this hits your journal. Edit any row to bounce back to the form."
    >
      <WizardErrorBanner error={getStr(sp, "error") || undefined} />
      {/* ── Hero preview ─────────────────────────────────────────────── */}
      <section className="border-y border-border py-10">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            Mark-to-market · preview
          </p>
          <div className="flex items-baseline gap-3">
            <span
              className="font-serif font-normal leading-none text-signature"
              style={{ fontSize: "clamp(48px, 7vw, 72px)" }}
            >
              {usdPaid > 0 ? fmtMultiplier(multiplier) : "—"}
            </span>
            <span className="font-serif text-xl font-normal text-text-tertiary">
              MTM
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
            on {fmtUsd(usdPaid)} paid
            {tokens > 0 && (
              <>
                {" · "}
                {fmtTokens(tokens)} {v.asset || "tokens"}
              </>
            )}
          </p>
        </div>
      </section>

      {/* ── Field summary ─────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="mb-2 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Sale
        </h2>
        <div>
          <WizardSummaryRow
            label="Kind"
            value={SALE_KIND_LABELS[v.saleKind] ?? v.saleKind ?? "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Venue"
            value={v.venue || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Token"
            value={v.asset || "—"}
            editHref={editAllHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Allocation
        </h2>
        <div>
          <WizardSummaryRow
            label="USD paid"
            value={usdPaid > 0 ? fmtUsd(usdPaid) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Tokens allocated"
            value={fmtTokens(tokens)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Current price"
            value={currentPrice > 0 ? fmtUsd(currentPrice) : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Current value"
            value={currentValue > 0 ? fmtUsd(currentValue) : "—"}
          />
          <WizardSummaryRow
            label="MTM ×"
            value={usdPaid > 0 ? fmtMultiplier(multiplier) : "—"}
            tone={multiplier >= 1 ? "up" : "down"}
          />
          <WizardSummaryRow
            label="Net P&L"
            value={fmtUsd(netPnl, true)}
            tone={netPnl >= 0 ? "up" : "down"}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Vesting
        </h2>
        <div>
          <WizardSummaryRow
            label="TGE date"
            value={fmtDate(v.tgeDate)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="TGE unlock %"
            value={tgeUnlock > 0 ? `${tgeUnlock}%` : "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Vesting cliff"
            value={cliffMonths > 0 ? `${cliffMonths}mo` : "none"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Vesting duration"
            value={durationMonths > 0 ? `${durationMonths}mo` : "none"}
            editHref={editAllHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Thesis &amp; tags
        </h2>
        <div>
          <WizardSummaryRow
            label="Opened"
            value={fmtDate(v.openedAt)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Regime tags"
            value={v.regimeTags || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Note"
            value={v.note || "—"}
            editHref={editAllHref}
            mono={false}
          />
        </div>
      </section>

      {/* ── Submit ────────────────────────────────────────────────────── */}
      <form action={logSale} className="mt-10">
        {SALE_FIELDS.map((k) => (
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
            Log sale
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </form>
    </WizardShell>
  );
}
