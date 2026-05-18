"use client";

/**
 * CSV-import preview table.
 *
 * Renders the first N normalised rows so the user can sanity-check
 * column-to-field mapping BEFORE committing the import. Warnings (unknown
 * quote currency, missing fee, etc.) show inline so each suspicious row is
 * easy to spot.
 *
 * The component is intentionally dumb — no fetching, no submit. Parent owns
 * the data lifecycle.
 */
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export interface CsvPreviewRow {
  rawExchangeId: string;
  rawSymbol: string;
  instrument: string;
  instrumentType: string;
  side: string;
  qty: string;
  price: string;
  fee: string;
  feeCurrency: string;
  executedAt: string;
  warnings: Array<{ message: string; lineNumber: number }>;
}

export interface CsvImportPreviewProps {
  rows: CsvPreviewRow[];
  /** Total normalized fills found in the source file. May exceed `rows.length`. */
  total: number;
  /** File-level / row-level parse errors. */
  errors: Array<{ lineNumber: number; message: string }>;
}

export function CsvImportPreview({ rows, total, errors }: CsvImportPreviewProps) {
  const t = useT();

  if (rows.length === 0 && errors.length === 0) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
        {t("settings.import.preview.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          {t("settings.import.preview.header", { shown: rows.length, total })}
        </p>
        {errors.length > 0 && (
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-down">
            {t("settings.import.preview.errorCount", { count: errors.length })}
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                <Th>{t("settings.import.preview.col.executedAt")}</Th>
                <Th>{t("settings.import.preview.col.side")}</Th>
                <Th>{t("settings.import.preview.col.instrument")}</Th>
                <Th>{t("settings.import.preview.col.qty")}</Th>
                <Th>{t("settings.import.preview.col.price")}</Th>
                <Th>{t("settings.import.preview.col.fee")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.rawExchangeId}
                  className={cn(
                    "border-b border-border/60",
                    r.warnings.length > 0 ? "bg-subtle" : "",
                  )}
                >
                  <Td mono>{formatDate(r.executedAt)}</Td>
                  <Td>
                    <span
                      className={cn(
                        "font-mono text-[11px] uppercase tracking-[0.14em]",
                        r.side === "buy" ? "text-up" : "text-down",
                      )}
                    >
                      {r.side}
                    </span>
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                      {r.instrumentType}
                    </span>
                  </Td>
                  <Td mono>{r.instrument}</Td>
                  <Td mono numeric>
                    {r.qty}
                  </Td>
                  <Td mono numeric>
                    {r.price}
                  </Td>
                  <Td mono numeric>
                    {r.fee} {r.feeCurrency}
                    {r.warnings.length > 0 && (
                      <ul className="mt-1 list-none space-y-0.5">
                        {r.warnings.map((w, i) => (
                          <li
                            key={i}
                            className="font-mono text-[10px] text-text-tertiary"
                            title={`Line ${w.lineNumber}`}
                          >
                            ! {w.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {errors.length > 0 && (
        <details className="rounded-md border border-border bg-surface px-3 py-2">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.18em] text-down">
            {t("settings.import.preview.errorsTitle", { count: errors.length })}
          </summary>
          <ul className="mt-2 list-none space-y-1">
            {errors.slice(0, 50).map((e, i) => (
              <li
                key={i}
                className="font-mono text-[11px] text-text-secondary"
              >
                <span className="text-text-tertiary">L{e.lineNumber}:</span>{" "}
                {e.message}
              </li>
            ))}
            {errors.length > 50 && (
              <li className="font-mono text-[10px] italic text-text-tertiary">
                {t("settings.import.preview.errorsTruncated", { count: errors.length - 50 })}
              </li>
            )}
          </ul>
        </details>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-2 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-text-tertiary">
      {children}
    </th>
  );
}

function Td({
  children,
  mono,
  numeric,
}: {
  children: React.ReactNode;
  mono?: boolean;
  numeric?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-2 py-2 align-top text-[12.5px] text-text",
        mono ? "font-mono" : "font-serif",
        numeric ? "tabular-nums" : "",
      )}
    >
      {children}
    </td>
  );
}

function formatDate(iso: string): string {
  // Render in UTC without seconds: 2024-09-01 12:34. Locale-aware formatting
  // would shift between user devices and make audit trails harder to compare.
  try {
    const d = new Date(iso);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mi = String(d.getUTCMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return iso;
  }
}
