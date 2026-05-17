"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogEyebrow,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  WizardField,
  WizardInput,
} from "@/components/wizard/wizard-field";
import { ExchangeLogo } from "@/components/settings/exchange-logo";
import type { CatalogEntry } from "@/components/settings/exchange-types";

interface Props {
  catalog: CatalogEntry[];
  /** "primary" renders a chunkier filled button for empty-state use. */
  variant?: "default" | "primary";
}

type Step = "pick" | "credentials";

const initialCreds = {
  label: "",
  apiKey: "",
  apiSecret: "",
  passphrase: "",
};

export function AddExchangeDialog({ catalog, variant = "default" }: Props) {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>("pick");
  const [exchangeCode, setExchangeCode] = React.useState<string | null>(null);
  const [creds, setCreds] = React.useState(initialCreds);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reset = React.useCallback(() => {
    // Explicitly wipe credential state on close to drop any references the
    // browser might retain. Plaintext keys are never persisted past dialog
    // close — no localStorage, no URL, no shared state.
    setStep("pick");
    setExchangeCode(null);
    setCreds(initialCreds);
    setError(null);
    setSubmitting(false);
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    setOpen(next);
  };

  const onPick = (code: string) => {
    setExchangeCode(code);
    setError(null);
    setStep("credentials");
  };

  const onBack = () => {
    setStep("pick");
    setError(null);
  };

  const selectedExchange = catalog.find((c) => c.code === exchangeCode);
  const labelFieldId = React.useId();
  const apiKeyFieldId = React.useId();
  const apiSecretFieldId = React.useId();
  const passphraseFieldId = React.useId();
  const errorId = React.useId();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!exchangeCode || !selectedExchange) return;
    setError(null);
    setSubmitting(true);

    try {
      // Only send a passphrase when the chosen venue actually expects one.
      // The API accepts `passphrase` as optional (zod schema) but bouncing
      // a stray empty string through encryptCredential would still allocate
      // a useless ciphertext row — keep the wire clean.
      const needsPassphrase = selectedExchange.requiresPassphrase;
      const trimmedPass = creds.passphrase.trim();

      const res = await fetch("/api/exchanges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange: exchangeCode,
          label: creds.label.trim(),
          credentials: {
            mode: "api_key",
            api_key: creds.apiKey,
            api_secret: creds.apiSecret,
            ...(needsPassphrase && trimmedPass.length > 0
              ? { passphrase: trimmedPass }
              : {}),
          },
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: string; message?: string } }
          | null;
        const msg =
          body?.error?.message ??
          (res.status === 409
            ? t("settings.exchanges.dialog.errors.duplicate")
            : res.status === 422
              ? t("settings.exchanges.dialog.errors.rejected")
              : t("settings.exchanges.dialog.errors.failed", { status: res.status }));
        setError(msg);
        setSubmitting(false);
        return;
      }

      // Success — wipe state and close. router.refresh() pulls the new row
      // into the server-rendered table.
      reset();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("settings.exchanges.dialog.errors.network"),
      );
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {variant === "primary" ? (
          <Button
            size="lg"
            className="font-serif text-[14px] font-medium"
            data-testid="add-exchange-trigger"
          >
            <Plus className="h-4 w-4" />
            {t("settings.exchanges.empty.primaryCta")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-[11px] uppercase tracking-[0.12em]"
            data-testid="add-exchange-trigger"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("settings.exchanges.addButton")}
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogEyebrow>
            {step === "pick"
              ? t("settings.exchanges.dialog.step1")
              : t("settings.exchanges.dialog.step2")}
          </DialogEyebrow>
          <DialogTitle>
            {step === "pick"
              ? t("settings.exchanges.dialog.titlePick")
              : selectedExchange
                ? t("settings.exchanges.dialog.title", { exchange: selectedExchange.displayName })
                : t("settings.exchanges.dialog.titlePick")}
          </DialogTitle>
          <DialogDescription>
            {step === "pick"
              ? t("settings.exchanges.dialog.descPick")
              : t("settings.exchanges.dialog.descCredentials")}
          </DialogDescription>
        </DialogHeader>

        {step === "pick" ? (
          <ExchangePickStep
            catalog={catalog}
            onPick={onPick}
            onCancel={() => handleOpenChange(false)}
          />
        ) : (
          <CredentialsStep
            exchange={selectedExchange}
            creds={creds}
            setCreds={setCreds}
            submitting={submitting}
            error={error}
            errorId={errorId}
            labelFieldId={labelFieldId}
            apiKeyFieldId={apiKeyFieldId}
            apiSecretFieldId={apiSecretFieldId}
            passphraseFieldId={passphraseFieldId}
            onBack={onBack}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ Step 1 */

function ExchangePickStep({
  catalog,
  onPick,
  onCancel,
}: {
  catalog: CatalogEntry[];
  onPick: (code: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <>
      <DialogBody>
        {/* The picker scrolls within the dialog body once the grid overflows
            — keeps the footer (Cancel) always reachable even at 20+ venues. */}
        <div
          role="radiogroup"
          aria-label={t("fields.exchange")}
          className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto pr-1"
        >
          {catalog.map((c) => (
            <button
              key={c.code}
              type="button"
              role="radio"
              aria-checked={false}
              onClick={() => onPick(c.code)}
              className={cn(
                "group flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5 text-left transition-all",
                "hover:border-border-strong hover:bg-subtle",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-text focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
              )}
              data-testid={`pick-exchange-${c.code}`}
            >
              <ExchangeLogo
                code={c.code}
                displayName={c.displayName}
                logoUrl={c.logoUrl}
                size="sm"
              />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate font-serif text-[14px] font-medium text-text">
                  {c.displayName}
                </div>
                <div className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
                  {capabilityCaption(c)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary"
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * "perps · spot" / "wallet · perps" — the mono caption beneath the venue
 * name. Order: perps first (this is a spread journal), then spot, then
 * auth-mode hint for the DEX entries.
 */
function capabilityCaption(c: CatalogEntry): string {
  const caps: string[] = [];
  if (c.supportsPerp) caps.push("perps");
  if (c.supportsSpot) caps.push("spot");
  if (c.authMode === "wallet_address") caps.push("wallet");
  return caps.length > 0 ? caps.join(" · ") : c.venueType;
}

/* ------------------------------------------------------------------ Step 2 */

interface CredentialsStepProps {
  exchange: CatalogEntry | undefined;
  creds: typeof initialCreds;
  setCreds: React.Dispatch<React.SetStateAction<typeof initialCreds>>;
  submitting: boolean;
  error: string | null;
  errorId: string;
  labelFieldId: string;
  apiKeyFieldId: string;
  apiSecretFieldId: string;
  passphraseFieldId: string;
  onBack: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}

function CredentialsStep({
  exchange,
  creds,
  setCreds,
  submitting,
  error,
  errorId,
  labelFieldId,
  apiKeyFieldId,
  apiSecretFieldId,
  passphraseFieldId,
  onBack,
  onSubmit,
}: CredentialsStepProps) {
  const t = useT();
  // Focus the first field when step 2 mounts. We query by id rather than ref
  // because the underlying WizardInput types itself with HTMLAttributes
  // (which doesn't expose `ref`).
  React.useEffect(() => {
    const el = document.getElementById(labelFieldId);
    if (el instanceof HTMLInputElement) el.focus();
  }, [labelFieldId]);

  const needsPassphrase = exchange?.requiresPassphrase ?? false;

  const canSubmit =
    creds.label.trim().length > 0 &&
    creds.apiKey.length >= 8 &&
    creds.apiSecret.length >= 8 &&
    (!needsPassphrase || creds.passphrase.length >= 1) &&
    !submitting;

  return (
    <form
      onSubmit={onSubmit}
      aria-describedby={error ? errorId : undefined}
      // autoComplete=off: never persist these credentials in browser autofill
      autoComplete="off"
    >
      <DialogBody className="space-y-5">
        <WizardField
          label={t("settings.exchanges.dialog.fields.label")}
          htmlFor={labelFieldId}
          helper={t("settings.exchanges.dialog.fields.labelHelper")}
          required
        >
          <WizardInput
            id={labelFieldId}
            value={creds.label}
            onChange={(e) =>
              setCreds((p) => ({ ...p, label: e.target.value }))
            }
            placeholder={
              exchange
                ? t("settings.exchanges.dialog.fields.labelPlaceholderNamed", {
                    exchange: exchange.displayName,
                  })
                : t("settings.exchanges.dialog.fields.labelPlaceholder")
            }
            maxLength={40}
            required
            autoComplete="off"
            disabled={submitting}
          />
        </WizardField>

        <WizardField
          label={t("fields.apiKey")}
          htmlFor={apiKeyFieldId}
          helper={t("settings.exchanges.dialog.fields.apiKeyHelper")}
          required
        >
          <WizardInput
            id={apiKeyFieldId}
            type="text"
            value={creds.apiKey}
            onChange={(e) =>
              setCreds((p) => ({ ...p, apiKey: e.target.value }))
            }
            minLength={8}
            required
            autoComplete="off"
            spellCheck={false}
            disabled={submitting}
            inputMode="text"
          />
        </WizardField>

        <WizardField
          label={t("fields.apiSecret")}
          htmlFor={apiSecretFieldId}
          helper={t("settings.exchanges.dialog.fields.apiSecretHelper")}
          required
        >
          <WizardInput
            id={apiSecretFieldId}
            type="password"
            value={creds.apiSecret}
            onChange={(e) =>
              setCreds((p) => ({ ...p, apiSecret: e.target.value }))
            }
            minLength={8}
            required
            autoComplete="new-password"
            spellCheck={false}
            disabled={submitting}
          />
        </WizardField>

        {needsPassphrase && (
          <WizardField
            label={t("fields.passphrase")}
            htmlFor={passphraseFieldId}
            helper={t("settings.exchanges.dialog.fields.passphraseHelper", {
              exchange: exchange?.displayName ?? t("settings.exchanges.dialog.fields.thisExchangeFallback"),
            })}
            required
          >
            <WizardInput
              id={passphraseFieldId}
              type="password"
              value={creds.passphrase}
              onChange={(e) =>
                setCreds((p) => ({ ...p, passphrase: e.target.value }))
              }
              required
              autoComplete="new-password"
              spellCheck={false}
              disabled={submitting}
              data-testid="passphrase-field"
            />
          </WizardField>
        )}

        <div className="rounded-md border border-border-subtle bg-inset p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {t("settings.exchanges.dialog.securityTitle")}
          </p>
          <p className="mt-1.5 font-serif text-[12px] italic leading-snug text-text-secondary">
            {t("settings.exchanges.dialog.securityBody")}
          </p>
        </div>

        {error && (
          <p
            id={errorId}
            role="alert"
            aria-live="polite"
            className="rounded-md border border-down bg-down-bg px-3 py-2 font-mono text-[12px] text-down"
          >
            {error}
          </p>
        )}
      </DialogBody>

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          disabled={submitting}
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("common.back")}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!canSubmit}
          className="font-mono text-[11px] uppercase tracking-[0.12em]"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {submitting
            ? t("settings.exchanges.dialog.adding")
            : t("settings.exchanges.dialog.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
