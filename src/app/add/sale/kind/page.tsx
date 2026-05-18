import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardRadioRow } from "@/components/wizard/wizard-radio-row";
import { getT } from "@/lib/i18n/server";

// Wizard step pages read searchParams per request, which would otherwise let
// Next 16 statically prerender them with stale defaults. Master plan §0
// punch-list: every step must opt out of static rendering.
export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

// Mirrors the SaleKindSchema in src/lib/db/zod-schemas.ts — v5 enum order.
// Keep this list in sync with the migration's sale_kind values. `i18n` maps
// the snake_case enum to the camelCase key under wizard.sale.kind.* so the
// template-literal t() call below resolves to a known MessageKey at compile
// time (rather than the wider `${string}` form).
const SALE_KINDS = [
  { value: "ido",            i18n: "ido"            },
  { value: "launchpad",      i18n: "launchpad"      },
  { value: "premarket",      i18n: "premarket"      },
  { value: "otc",            i18n: "otc"            },
  { value: "ieo",            i18n: "ieo"            },
  { value: "private_round",  i18n: "privateRound"   },
  { value: "otc_allocation", i18n: "otcAllocation"  },
  { value: "vesting_claim",  i18n: "vestingClaim"   },
] as const;

// Kinds where the trader expects to receive tokens to a known wallet. The
// wallet-paste claim fetcher (v3) will read this set to decide whether to
// surface the paste hint on the fields step. For now we just show a disabled
// affordance on the kind step so users discover the upcoming UX without it
// blocking submission.
const WALLET_RELEVANT_KINDS: ReadonlySet<string> = new Set([
  "ido",
  "premarket",
  "private_round",
  "otc_allocation",
  "vesting_claim",
]);

function getStr(sp: Awaited<Search>, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string")
    return v[0];
  return fallback;
}

/**
 * Step 1 — Sale kind picker. Discriminates which fields the next step
 * surfaces and lands the chosen kind in the URL so back-nav from /fields
 * preserves it.
 *
 * v5 extends the sale_kind enum to 8 values (was 4). The UI groups them as a
 * cards grid via the shared WizardRadioRow primitive — same component the
 * yield / option wizards use, so the visual treatment stays consistent.
 *
 * Why this is a separate step (vs an inline radio on /fields):
 *   - The chosen kind controls which fields are required in step 2 (e.g.
 *     `vesting_claim` doesn't need usd_paid > 0, an OTC allocation needs a
 *     claim wallet, etc). Keeping the picker on its own page mirrors the
 *     spread + trade wizards' "type discriminator first" flow.
 */
export default async function SaleKindPage(props: { searchParams: Search }) {
  const t = await getT();
  const sp = await props.searchParams;
  const preSelected = getStr(sp, "saleKind", "ido");

  // 3-step stepper. Mirrors the master plan §3 layout: kind → fields → review.
  const STEP_LABELS = [
    t("wizard.sale.stepLabels.kind"),
    t("wizard.sale.stepLabels.details"),
    t("wizard.sale.stepLabels.review"),
  ] as const;

  const OPTIONS = SALE_KINDS.map((k) => ({
    value: k.value,
    title: t(`wizard.sale.kind.${k.i18n}.title` as const),
    description: t(`wizard.sale.kind.${k.i18n}.description` as const),
  }));

  const showWalletHint = WALLET_RELEVANT_KINDS.has(preSelected);

  return (
    <WizardShell
      type="sale"
      step={1}
      totalSteps={3}
      stepLabels={STEP_LABELS}
      title={t("wizard.sale.kindStep.title")}
      subtitle={t("wizard.sale.kindStep.subtitle")}
    >
      <form
        id="sale-kind-form"
        action="/add/sale/fields"
        method="get"
        className="flex flex-col gap-7"
      >
        <WizardRadioRow
          name="saleKind"
          defaultValue={preSelected}
          required
          variant="cards"
          options={OPTIONS}
        />

        {/* Wallet-paste affordance — disabled in v2, real implementation
            ships in v3 (Etherscan/Solscan integration per master plan §1
            "Above-and-beyond features"). We surface the disabled hint so the
            UX is discoverable but don't gate submission on it. */}
        {showWalletHint && (
          <aside
            className="rounded-md border border-dashed border-border-strong bg-subtle/60 px-4 py-3 text-[12px] text-text-tertiary"
            role="status"
            aria-live="polite"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary">
              {t("wizard.sale.kindStep.walletHintLabel")}
            </span>
            <span className="ml-2 font-serif italic">
              {t("wizard.sale.kindStep.walletHintBody")}
            </span>
          </aside>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-border pt-6">
          <Link
            href="/add"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("wizard.sale.kindStep.back")}
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-colors hover:bg-text-secondary"
          >
            {t("wizard.sale.kindStep.continue")}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </form>
    </WizardShell>
  );
}

