"use client";

import * as React from "react";
import { WizardField, WizardInput } from "@/components/wizard/wizard-field";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type TradeStatus = "open" | "closed" | "liquidated";

interface TradeStatusFieldsProps {
  defaultStatus: TradeStatus;
  defaultOpenedAt: string;
  defaultClosedAt: string;
  defaultExitPrice: string;
}

/**
 * Status + lifecycle dates for the trade wizard.
 *
 * A trade is `open`, `closed`, or `liquidated`. Only a closed or liquidated
 * trade has an exit price and a close date; an open position has neither and
 * no realized P&L. This is a client component so the exit fields appear and
 * disappear with the status — and because, when the trade is open, those
 * inputs are simply not rendered, the GET form never submits them and
 * `CreateTradeBody` sees them as absent (its superRefine only demands an exit
 * price + close date when the status is not open).
 */
export function TradeStatusFields({
  defaultStatus,
  defaultOpenedAt,
  defaultClosedAt,
  defaultExitPrice,
}: TradeStatusFieldsProps) {
  const t = useT();
  const [status, setStatus] = React.useState<TradeStatus>(defaultStatus);
  const isOpen = status === "open";

  const options: { value: TradeStatus; tone?: "down" }[] = [
    { value: "open" },
    { value: "closed" },
    { value: "liquidated", tone: "down" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
          {t("wizard.trade.fields.labels.status")}
        </legend>
        <div role="radiogroup" className="grid grid-cols-3 gap-2">
          {options.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                "flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
                "has-[input:checked]:border-text has-[input:checked]:bg-subtle has-[input:checked]:text-text",
                opt.tone === "down" &&
                  "has-[input:checked]:border-down has-[input:checked]:bg-down/10 has-[input:checked]:text-down",
              )}
            >
              <input
                type="radio"
                name="status"
                value={opt.value}
                checked={status === opt.value}
                onChange={() => setStatus(opt.value)}
                className="sr-only"
              />
              {t(`status.${opt.value}` as const)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <WizardField
          label={t("wizard.trade.fields.labels.openedAt")}
          htmlFor="openedAt"
          required
        >
          <WizardInput
            id="openedAt"
            name="openedAt"
            type="datetime-local"
            defaultValue={defaultOpenedAt}
            required
          />
        </WizardField>
        {!isOpen && (
          <WizardField
            label={t("wizard.trade.fields.labels.closedAt")}
            htmlFor="closedAt"
            required
          >
            <WizardInput
              id="closedAt"
              name="closedAt"
              type="datetime-local"
              defaultValue={defaultClosedAt}
              required
            />
          </WizardField>
        )}
      </div>

      {isOpen ? (
        <p className="font-serif text-[12px] italic leading-snug text-text-tertiary">
          {t("wizard.trade.fields.statusOpenHint")}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <WizardField
            label={t("wizard.trade.fields.labels.exitPrice")}
            htmlFor="exitPrice"
            helper={t("wizard.trade.fields.helpers.usd")}
            required
          >
            <WizardInput
              id="exitPrice"
              name="exitPrice"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={defaultExitPrice}
              placeholder="66380.00"
              required
            />
          </WizardField>
        </div>
      )}
    </div>
  );
}
