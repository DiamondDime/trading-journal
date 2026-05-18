import Link from "next/link";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { WizardField, WizardInput, WizardSelect } from "./wizard-field";
import type { OptionLegInput } from "@/lib/db/zod-schemas";
import { getT } from "@/lib/i18n/server";

const MAX_LEGS = 8;
const MIN_LEGS = 1;

export interface WizardLegListProps {
  /** Form field name prefix. Each leg emits `${name}[i].field`. Default
   *  "legs" matches the option wizard's expected CreateOptionBody shape. */
  name?: string;
  /** Number of leg rows to render. Pulled from searchParams.legs on the
   *  caller side. Clamped to [MIN_LEGS, MAX_LEGS]. */
  count: number;
  /** Pre-existing leg values (from /review back-nav). Indexed by leg_index. */
  defaults?: Partial<OptionLegInput>[];
  /** Base href for the add/remove buttons. The component round-trips a new
   *  `legs=N` query parameter through this URL so the server re-renders
   *  with the updated count. */
  baseHref: string;
  /** Pass-through query parameters that should be preserved on add/remove. */
  preserveParams?: Record<string, string | undefined>;
  /** When true, hides the headings + counter (used for single_leg option). */
  hideHeader?: boolean;
}

/**
 * Repeatable leg block for option spreads. Server-rendered so back-nav
 * preserves every typed value. Add/remove rebuild the URL with a fresh
 * `legs=N` parameter; the page re-renders with the new row count.
 *
 * Each leg's fields are namespaced `legs[i].<field>` so the server action
 * can rehydrate the legs array via simple FormData iteration (see
 * Wave 2F's /add/option/actions.ts).
 */
export async function WizardLegList({
  name = "legs",
  count,
  defaults = [],
  baseHref,
  preserveParams = {},
  hideHeader = false,
}: WizardLegListProps) {
  const t = await getT();
  const clamped = Math.min(MAX_LEGS, Math.max(MIN_LEGS, count));
  const buildHref = (n: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(preserveParams)) {
      if (v !== undefined) params.set(k, v);
    }
    params.set("legs", String(n));
    return `${baseHref}?${params.toString()}`;
  };

  const removeHref = clamped > MIN_LEGS ? buildHref(clamped - 1) : null;
  const addHref = clamped < MAX_LEGS ? buildHref(clamped + 1) : null;

  return (
    <section className="flex flex-col gap-4">
      {!hideHeader && (
        <header className="flex items-center justify-between">
          <h3 className="font-serif text-[14px] font-medium uppercase tracking-[0.16em] text-text-tertiary">
            {t("wizard.legList.heading")}
          </h3>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {t("wizard.legList.count", { current: clamped, max: MAX_LEGS })}
          </span>
        </header>
      )}

      <ol className="flex flex-col gap-4">
        {Array.from({ length: clamped }).map((_, i) => {
          const d = defaults[i] ?? {};
          const prefix = `${name}[${i}]`;
          return (
            <li
              key={i}
              className="rounded-md border border-border bg-surface p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                  {t("wizard.legList.legIndex", { i: i + 1 })}
                </span>
                <input
                  type="hidden"
                  name={`${prefix}.leg_index`}
                  value={i}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <WizardField label={t("wizard.legList.exchange")} htmlFor={`${prefix}-exchange`}>
                  <WizardSelect
                    name={`${prefix}.exchange`}
                    id={`${prefix}-exchange`}
                    defaultValue={(d.exchange as string | undefined) ?? "deribit"}
                    required
                  >
                    {["deribit", "binance", "bybit", "okx", "kraken"].map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </WizardSelect>
                </WizardField>
                <WizardField label={t("wizard.legList.underlying")} htmlFor={`${prefix}-underlying`}>
                  <WizardInput
                    id={`${prefix}-underlying`}
                    name={`${prefix}.underlying`}
                    defaultValue={(d.underlying as string | undefined) ?? ""}
                    placeholder="BTC"
                    required
                  />
                </WizardField>
                <WizardField label={t("wizard.legList.expiry")} htmlFor={`${prefix}-expiry`}>
                  <WizardInput
                    id={`${prefix}-expiry`}
                    type="date"
                    name={`${prefix}.expiry`}
                    defaultValue={(d.expiry as string | undefined) ?? ""}
                    required
                  />
                </WizardField>
                <WizardField label={t("wizard.legList.strike")} htmlFor={`${prefix}-strike`}>
                  <WizardInput
                    id={`${prefix}-strike`}
                    type="number"
                    step="any"
                    name={`${prefix}.strike`}
                    defaultValue={(d.strike as string | undefined) ?? ""}
                    placeholder="65000"
                    required
                  />
                </WizardField>
                <WizardField label={t("wizard.legList.callPut")} htmlFor={`${prefix}-option_kind`}>
                  <WizardSelect
                    id={`${prefix}-option_kind`}
                    name={`${prefix}.option_kind`}
                    defaultValue={(d.option_kind as string | undefined) ?? "call"}
                    required
                  >
                    <option value="call">{t("wizard.legList.call")}</option>
                    <option value="put">{t("wizard.legList.put")}</option>
                  </WizardSelect>
                </WizardField>
                <WizardField label={t("wizard.legList.side")} htmlFor={`${prefix}-side`}>
                  <WizardSelect
                    id={`${prefix}-side`}
                    name={`${prefix}.side`}
                    defaultValue={(d.side as string | undefined) ?? "long"}
                    required
                  >
                    <option value="long">{t("side.long")}</option>
                    <option value="short">{t("side.short")}</option>
                  </WizardSelect>
                </WizardField>
                <WizardField label={t("wizard.legList.contracts")} htmlFor={`${prefix}-contracts`}>
                  <WizardInput
                    id={`${prefix}-contracts`}
                    type="number"
                    step="any"
                    name={`${prefix}.contracts`}
                    defaultValue={(d.contracts as string | undefined) ?? "1"}
                    placeholder="1"
                    required
                  />
                </WizardField>
                <WizardField
                  label={t("wizard.legList.premiumPerContract")}
                  htmlFor={`${prefix}-premium`}
                >
                  <WizardInput
                    id={`${prefix}-premium`}
                    type="number"
                    step="any"
                    name={`${prefix}.premium_per_contract`}
                    defaultValue={
                      (d.premium_per_contract as string | undefined) ?? ""
                    }
                    placeholder="1250"
                    required
                  />
                </WizardField>
                <WizardField label={t("wizard.legList.iv")} htmlFor={`${prefix}-iv`}>
                  <WizardInput
                    id={`${prefix}-iv`}
                    type="number"
                    step="any"
                    name={`${prefix}.iv`}
                    defaultValue={(d.iv as string | undefined) ?? ""}
                    placeholder="0.62"
                  />
                </WizardField>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary hover:text-text">
                  {t("wizard.legList.greeks")}
                </summary>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
                  {(["delta", "gamma", "theta", "vega", "rho"] as const).map((g) => (
                    <WizardField key={g} label={g} htmlFor={`${prefix}-${g}`}>
                      <WizardInput
                        id={`${prefix}-${g}`}
                        type="number"
                        step="any"
                        name={`${prefix}.${g}`}
                        defaultValue={(d[g] as string | undefined) ?? ""}
                      />
                    </WizardField>
                  ))}
                </div>
              </details>
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-2">
        {addHref && (
          <Link
            href={addHref}
            scroll={false}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-dashed border-border-strong px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary",
              "hover:bg-subtle hover:text-text",
            )}
          >
            <Plus className="h-3 w-3" />
            {t("wizard.legList.addLeg")}
          </Link>
        )}
        {removeHref && (
          <Link
            href={removeHref}
            scroll={false}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary",
              "hover:border-border-strong hover:text-text",
            )}
          >
            <X className="h-3 w-3" />
            {t("wizard.legList.removeLastLeg")}
          </Link>
        )}
      </div>
    </section>
  );
}
