import { WizardStepper } from "./wizard-stepper";
import { getT } from "@/lib/i18n/server";

// Activity types that the wizard supports. Subset of ActivityType — the entry
// step (/add) renders a chooser, so it doesn't pass a `type`.
export type WizardType = "spread" | "trade" | "sale" | "airdrop";

export interface WizardShellProps {
  /** Activity type being added. Omit on the type-picker step. */
  type?: WizardType;
  /** 1-indexed current step. Omit on the type-picker step. */
  step?: number;
  /** Total steps for this flow. Omit on the type-picker step. */
  totalSteps?: number;
  /** Per-step step labels for the stepper, in order. Length === totalSteps. */
  stepLabels?: readonly string[];
  /** Page title — serif, large. */
  title: string;
  /** One-line italic subtitle under the title. Optional. */
  subtitle?: string;
  children: React.ReactNode;
}

/**
 * Top frame for every wizard step. Renders the breadcrumb, the step
 * indicator, and a serif title block — then yields a narrow content slot for
 * the step's form fields.
 *
 * State-free by design. Each step page owns its own form state (or URL
 * params); the shell is layout only.
 */
export async function WizardShell({
  type,
  step,
  totalSteps,
  stepLabels,
  title,
  subtitle,
  children,
}: WizardShellProps) {
  const t = await getT();
  const typeLabel = type ? t(`wizard.shell.types.${type}` as const) : null;

  return (
    <div className="w-full">
      {/* ── breadcrumb / step counter ─────────────────────────────────── */}
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        <span className="flex items-center gap-1.5">
          <span>{t("wizard.shell.newActivity")}</span>
          {typeLabel && (
            <>
              <span className="text-text-tertiary/60">·</span>
              <span className="text-text-secondary">{typeLabel}</span>
            </>
          )}
          {step !== undefined && totalSteps !== undefined && (
            <>
              <span className="text-text-tertiary/60">·</span>
              <span>
                {t("wizard.shell.stepCounter", { step, total: totalSteps })}
              </span>
            </>
          )}
        </span>
      </div>

      {/* ── stepper ───────────────────────────────────────────────────── */}
      {step !== undefined && totalSteps !== undefined && stepLabels && (
        <div className="mt-5">
          <WizardStepper
            current={step}
            total={totalSteps}
            labels={stepLabels}
          />
        </div>
      )}

      {/* ── title block ───────────────────────────────────────────────── */}
      <header className="mt-8">
        <h1 className="font-serif text-[34px] font-medium leading-tight tracking-tight text-text md:text-[40px]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 font-serif text-base italic text-text-tertiary">
            {subtitle}
          </p>
        )}
      </header>

      <div className="mt-10">{children}</div>
    </div>
  );
}
