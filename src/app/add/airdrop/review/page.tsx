import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardSummaryRow } from "@/components/wizard/wizard-summary-row";
import { logAirdrop } from "../actions";

const STEP_LABELS = ["Details", "Review"] as const;

const AIRDROP_FIELDS = [
  "protocol",
  "asset",
  "tokensClaimed",
  "claimDate",
  "usdValueAtClaim",
  "currentPriceUsd",
  "note",
  "regimeTags",
] as const;

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
  const formatted = m >= 10 ? m.toFixed(1) : m.toFixed(2);
  return `${formatted}×`;
}

function fmtTokens(n: number): string {
  if (n === 0) return "—";
  return n.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

export default async function AirdropReviewPage(props: {
  searchParams: Search;
}) {
  const sp = await props.searchParams;

  const v = {
    protocol: getStr(sp, "protocol"),
    asset: getStr(sp, "asset"),
    tokensClaimed: getStr(sp, "tokensClaimed"),
    claimDate: getStr(sp, "claimDate"),
    usdValueAtClaim: getStr(sp, "usdValueAtClaim", "0"),
    currentPriceUsd: getStr(sp, "currentPriceUsd"),
    note: getStr(sp, "note"),
    regimeTags: getStr(sp, "regimeTags"),
  };

  const tokens = parseNum(v.tokensClaimed);
  const valueAtClaim = parseNum(v.usdValueAtClaim);
  const currentPrice = parseNum(v.currentPriceUsd);

  const currentValue = tokens * currentPrice;
  // Cost basis is $0 for airdrops; the multiplier compares current value
  // to the value at the moment of claim. If we never captured that
  // baseline, default to 1.0× so the headline stays meaningful.
  const multiplier = valueAtClaim > 0 ? currentValue / valueAtClaim : 1.0;
  // Net P&L for an airdrop is the full current value — there's no cost
  // basis to subtract.
  const netPnl = currentValue;
  const headlineTone = multiplier >= 1 ? "up" : "down";

  const editAllHref = `/add/airdrop/fields?${new URLSearchParams(
    Object.fromEntries(
      AIRDROP_FIELDS.map((k) => [k, getStr(sp, k)] as const).filter(
        ([, val]) => val !== ""
      )
    )
  ).toString()}`;

  return (
    <WizardShell
      type="airdrop"
      step={2}
      totalSteps={2}
      stepLabels={STEP_LABELS}
      title="Look it over"
      subtitle="One last pass before this hits your journal. Edit any row to bounce back to the form."
    >
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
              {tokens > 0 && currentPrice > 0 ? fmtMultiplier(multiplier) : "—"}
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
            realized · cost basis $0
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
          Airdrop
        </h2>
        <div>
          <WizardSummaryRow
            label="Protocol"
            value={v.protocol || "—"}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Token"
            value={v.asset || "—"}
            editHref={editAllHref}
          />
        </div>

        <h2 className="mb-2 mt-8 font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Claim
        </h2>
        <div>
          <WizardSummaryRow
            label="Tokens claimed"
            value={fmtTokens(tokens)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Claim date"
            value={fmtDate(v.claimDate)}
            editHref={editAllHref}
          />
          <WizardSummaryRow
            label="Value at claim"
            value={valueAtClaim > 0 ? fmtUsd(valueAtClaim) : "—"}
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
            value={tokens > 0 && currentPrice > 0 ? fmtMultiplier(multiplier) : "—"}
            tone={multiplier >= 1 ? "up" : "down"}
          />
          <WizardSummaryRow
            label="Net P&L"
            value={fmtUsd(netPnl, true)}
            tone={netPnl >= 0 ? "up" : "down"}
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
            label="Note"
            value={v.note || "—"}
            editHref={editAllHref}
            mono={false}
          />
        </div>
      </section>

      {/* ── Submit ────────────────────────────────────────────────────── */}
      <form action={logAirdrop} className="mt-10">
        {AIRDROP_FIELDS.map((k) => (
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
            Log airdrop
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </form>
    </WizardShell>
  );
}
