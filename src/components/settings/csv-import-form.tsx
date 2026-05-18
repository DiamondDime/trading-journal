"use client";

/**
 * Client-side state machine for the CSV-import page.
 *
 * Flow:
 *   1. Select exchange + connection + (optional) date range.
 *   2. Pick a .csv/.tsv file. The client never sees fills yet — preview
 *      requires a round-trip to the server so the same parser produces
 *      both the preview and the eventual write.
 *   3. POST with dryRun=true → render preview table.
 *   4. POST with dryRun=false → render result counts.
 *
 * Why not a Server Action?
 *   Server Actions accept FormData but the page would still need client
 *   state to toggle between "preview" and "commit" without unmounting the
 *   chosen file. A plain fetch() against the API route keeps the wire
 *   contract explicit (and unit-testable as a route) and is no more code.
 *
 * The form intentionally avoids holding the file in any persistent state —
 * the <input type="file"> is the source of truth. Re-clicking Preview after
 * the underlying file changes does the right thing automatically.
 */
import * as React from "react";
import { Upload, FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import {
  WizardField,
  WizardSelect,
  WizardInput,
} from "@/components/wizard/wizard-field";
import {
  CsvImportPreview,
  type CsvPreviewRow,
} from "@/components/settings/csv-import-preview";
import { cn } from "@/lib/utils";

interface ConnectionOption {
  id: string;
  label: string;
  exchangeCode: string;
}

export interface CsvImportFormProps {
  connections: ConnectionOption[];
}

type Phase = "idle" | "previewing" | "preview-ready" | "importing" | "imported";

interface PreviewState {
  total: number;
  preview: CsvPreviewRow[];
  errors: Array<{ lineNumber: number; message: string }>;
}

interface ImportResult {
  inserted: number;
  skipped: number;
  errors: Array<{ lineNumber: number; message: string }>;
}

const EXCHANGES = [
  "binance",
  "bybit",
  "kraken",
  "coinbase",
  "backpack",
  "vertex",
  "drift",
  "generic",
] as const;

export function CsvImportForm({ connections }: CsvImportFormProps) {
  const t = useT();
  const formRef = React.useRef<HTMLFormElement>(null);

  const [exchange, setExchange] = React.useState<(typeof EXCHANGES)[number]>("binance");
  const [connectionId, setConnectionId] = React.useState<string>(
    connections[0]?.id ?? "",
  );
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<PreviewState | null>(null);
  const [result, setResult] = React.useState<ImportResult | null>(null);

  // Reset the preview/result whenever the user changes any of the
  // pre-upload knobs. The chosen file stays selected — re-running with
  // a tweaked date range is the common interaction.
  const resetDownstream = () => {
    setPreview(null);
    setResult(null);
    setPhase("idle");
    setError(null);
  };

  const buildFormData = (dryRun: boolean): FormData | null => {
    const form = formRef.current;
    if (!form) return null;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError(t("settings.import.errors.fileRequired"));
      return null;
    }
    data.set("dryRun", dryRun ? "true" : "false");
    return data;
  };

  const handlePreview = async () => {
    setError(null);
    setResult(null);
    const data = buildFormData(true);
    if (!data) return;
    setPhase("previewing");
    try {
      const res = await fetch("/api/import/csv", { method: "POST", body: data });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? t("settings.import.errors.previewFailed"));
        setPhase("idle");
        return;
      }
      setPreview({
        total: json.data.total,
        preview: json.data.preview,
        errors: json.data.errors,
      });
      setPhase("preview-ready");
    } catch {
      setError(t("settings.import.errors.network"));
      setPhase("idle");
    }
  };

  const handleImport = async () => {
    setError(null);
    if (!connectionId) {
      setError(t("settings.import.errors.connectionRequired"));
      return;
    }
    const data = buildFormData(false);
    if (!data) return;
    setPhase("importing");
    try {
      const res = await fetch("/api/import/csv", { method: "POST", body: data });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? t("settings.import.errors.importFailed"));
        setPhase("preview-ready");
        return;
      }
      setResult({
        inserted: json.data.inserted,
        skipped: json.data.skipped,
        errors: json.data.errors,
      });
      setPhase("imported");
    } catch {
      setError(t("settings.import.errors.network"));
      setPhase("preview-ready");
    }
  };

  // Generic parser is the documented escape valve for unsupported venues —
  // it would be useless if we filtered out every connection that doesn't have
  // `exchange_code === 'generic'` (no connection does). When the user picks
  // Generic, show every connection so they can pin the import to any of them.
  const matchingConnections =
    exchange === "generic"
      ? connections
      : connections.filter((c) => c.exchangeCode === exchange);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => e.preventDefault()}
      className="space-y-6"
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <WizardField
          label={t("settings.import.fields.exchange.label")}
          htmlFor="csv-exchange"
          helper={t("settings.import.fields.exchange.helper")}
        >
          <WizardSelect
            id="csv-exchange"
            name="exchange"
            value={exchange}
            onChange={(e) => {
              setExchange(e.currentTarget.value as (typeof EXCHANGES)[number]);
              resetDownstream();
            }}
          >
            {EXCHANGES.map((code) => (
              <option key={code} value={code}>
                {t(`settings.import.exchanges.${code}` as never)}
              </option>
            ))}
          </WizardSelect>
        </WizardField>

        <WizardField
          label={t("settings.import.fields.connection.label")}
          htmlFor="csv-connection"
          helper={t("settings.import.fields.connection.helper")}
        >
          <WizardSelect
            id="csv-connection"
            name="connection"
            value={connectionId}
            onChange={(e) => setConnectionId(e.currentTarget.value)}
            disabled={matchingConnections.length === 0}
          >
            {matchingConnections.length === 0 && (
              <option value="">
                {t("settings.import.fields.connection.empty")}
              </option>
            )}
            {matchingConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </WizardSelect>
        </WizardField>

        <WizardField
          label={t("settings.import.fields.dateFrom.label")}
          htmlFor="csv-date-from"
          helper={t("settings.import.fields.dateFrom.helper")}
        >
          <WizardInput
            id="csv-date-from"
            name="dateFrom"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.currentTarget.value);
              resetDownstream();
            }}
          />
        </WizardField>

        <WizardField
          label={t("settings.import.fields.dateTo.label")}
          htmlFor="csv-date-to"
        >
          <WizardInput
            id="csv-date-to"
            name="dateTo"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.currentTarget.value);
              resetDownstream();
            }}
          />
        </WizardField>
      </div>

      <div className="rounded-md border border-dashed border-border bg-surface px-5 py-6">
        <label
          htmlFor="csv-file"
          className={cn(
            "flex cursor-pointer flex-col items-center gap-3 text-center",
          )}
        >
          <Upload className="h-6 w-6 text-text-tertiary" />
          <div>
            <p className="font-serif text-[15px] font-medium text-text">
              {fileName ? fileName : t("settings.import.fields.file.label")}
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
              {t("settings.import.fields.file.helper")}
            </p>
          </div>
          <input
            id="csv-file"
            name="file"
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain"
            className="sr-only"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              setFileName(file ? file.name : null);
              resetDownstream();
            }}
          />
        </label>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-down/40 bg-down/5 px-3 py-2 font-mono text-[12px] text-down"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={handlePreview}
          disabled={phase === "previewing" || phase === "importing" || !fileName}
        >
          {phase === "previewing" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <FileText className="h-3 w-3" />
          )}
          {t("settings.import.buttons.preview")}
        </Button>
        <Button
          type="button"
          onClick={handleImport}
          disabled={
            phase === "importing" ||
            phase !== "preview-ready" ||
            !connectionId ||
            !preview ||
            preview.preview.length === 0
          }
        >
          {phase === "importing" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Upload className="h-3 w-3" />
          )}
          {t("settings.import.buttons.commit")}
        </Button>
      </div>

      {preview && phase !== "imported" && (
        <section
          className="space-y-3 border-t border-border pt-5"
          aria-label={t("settings.import.preview.aria")}
        >
          <CsvImportPreview
            rows={preview.preview}
            total={preview.total}
            errors={preview.errors}
          />
        </section>
      )}

      {result && (
        <section
          role="status"
          aria-live="polite"
          className="rounded-md border border-border bg-subtle px-5 py-4"
        >
          <p className="font-serif text-[15px] font-medium text-text">
            {t("settings.import.result.heading")}
          </p>
          <ul className="mt-2 space-y-1 font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary">
            <li>
              {t("settings.import.result.inserted", { count: result.inserted })}
            </li>
            <li>
              {t("settings.import.result.skipped", { count: result.skipped })}
            </li>
            {result.errors.length > 0 && (
              <li className="text-down">
                {t("settings.import.result.errors", {
                  count: result.errors.length,
                })}
              </li>
            )}
          </ul>
        </section>
      )}
    </form>
  );
}
