import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioRow } from "@/components/wizard/wizard-radio-row";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  return fallback;
}

const ALL_KINDS = ["spot", "perp", "dated_future", "option", "otc", "nft"] as const;
type TradeKind = (typeof ALL_KINDS)[number];

function isTradeKind(v: string): v is TradeKind {
  return (ALL_KINDS as readonly string[]).includes(v);
}

/**
 * Step 2 of the trade wizard. Forces the user to commit to a kind before the
 * picker / fields render — every downstream step uses the kind to gate
 * conditional fieldsets (perp-only leverage, OTC counterparty, NFT collection)
 * and to filter the picker query (spot trades hide perp fills, etc.).
 *
 * Routing decisions made here:
 *   - source=auto + kind in {spot, perp, dated_future, option}  → /pick
 *   - source=auto + kind in {otc, nft}                          → /fields
 *     (no exchange fill data for OTC/NFT; the user must enter manually)
 *   - source=manual + any kind                                  → /fields
 */
export default async function TradeKindPage(props: { searchParams: Search }) {
  const t = await getT();
  const sp = await props.searchParams;

  const source = getStr(sp, "source") === "auto" ? "auto" : "manual";
  const preselected = (() => {
    const raw = getStr(sp, "kind");
    return raw && isTradeKind(raw) ? raw : "spot";
  })();

  const STEP_LABELS = [
    t("wizard.trade.stepLabels.source"),
    t("wizard.trade.stepLabels.kind"),
    t("wizard.trade.stepLabels.pick"),
    t("wizard.trade.stepLabels.details"),
    t("wizard.trade.stepLabels.review"),
  ] as const;

  // OTC and NFT skip the pick step regardless of `source` — there's no
  // exchange-fill row for them in `positions`.
  const formId = "trade-kind-form";

  return (
    <WizardShell
      type="trade"
      step={2}
      totalSteps={5}
      stepLabels={STEP_LABELS}
      title={t("wizard.trade.kindStep.title")}
      subtitle={t("wizard.trade.kindStep.subtitle")}
    >
      {/*
        Two forms colocated in this page:
          1) The radio form posts to a dispatcher (this same page acts as the
             action target via plain GET + a hidden handler). To keep the page
             server-only and avoid client JS, we render two submit buttons that
             share `name="route"` and let the user's selected kind drive the
             handler routing.

        Simpler approach used here: a single GET form. The form's action is
        `/add/trade/kind` itself; the page renders no progressive form, and
        instead a Continue button submits to /add/trade/route via formaction
        attribute. We do this with a server-rendered <button formaction=...>
        per kind — but that explodes the markup. Instead we use one form with
        action="/add/trade/pick" and a tiny dispatcher in /pick that re-routes
        OTC/NFT/manual to /fields.

        Implementation chosen: every Continue lands on /pick. /pick handles the
        re-route for kinds with no fills (otc/nft) and for source=manual.
      */}
      <form
        id={formId}
        action="/add/trade/pick"
        method="get"
        className="flex flex-col gap-7"
      >
        <input type="hidden" name="source" value={source} />

        <WizardRadioRow
          name="kind"
          defaultValue={preselected}
          required
          legend={t("wizard.trade.kindStep.legend")}
          requiredCue={t("wizard.trade.fields.requiredCue")}
          options={[
            {
              value: "spot",
              title: t("wizard.trade.kind.spot.title"),
              description: t("wizard.trade.kind.spot.description"),
            },
            {
              value: "perp",
              title: t("wizard.trade.kind.perp.title"),
              description: t("wizard.trade.kind.perp.description"),
            },
            {
              value: "dated_future",
              title: t("wizard.trade.kind.datedFuture.title"),
              description: t("wizard.trade.kind.datedFuture.description"),
            },
            {
              value: "option",
              title: t("wizard.trade.kind.option.title"),
              description: t("wizard.trade.kind.option.description"),
            },
            {
              value: "otc",
              title: t("wizard.trade.kind.otc.title"),
              description: t("wizard.trade.kind.otc.description"),
            },
            {
              value: "nft",
              title: t("wizard.trade.kind.nft.title"),
              description: t("wizard.trade.kind.nft.description"),
            },
          ]}
        />

        <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
          <Link
            href="/add/trade/source"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("wizard.shell.back")}
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            {t("wizard.shell.continue")}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </form>
    </WizardShell>
  );
}
