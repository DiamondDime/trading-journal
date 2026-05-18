"use client";

import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

interface McpTokenDisplayProps {
  /**
   * The full 64-char hex token, or null when the desktop app hasn't yet
   * provisioned the file. The server component reads this from disk so the
   * value is fresh on every render — we receive it as a prop rather than
   * fetching it ourselves (no API surface = no extra place to leak it).
   */
  token: string | null;
  /** Absolute path to ~/.journal/mcp.json, shown next to the token. */
  tokenPath: string;
}

/**
 * Renders the MCP token in a monospace block with a copy-to-clipboard button.
 *
 * Why a client component: we need useState for the "copied" badge timeout and
 * `navigator.clipboard.writeText`. The token itself crosses the server→client
 * boundary as a prop, which is fine — the page is `force-dynamic` and the
 * file read happens server-side; the prop is just plumbing.
 */
export function McpTokenDisplay({ token, tokenPath }: McpTokenDisplayProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();

  if (!token) {
    return (
      <p className="font-serif text-[13px] italic leading-snug text-text-secondary">
        {t("settings.mcp.token.none")}
      </p>
    );
  }

  async function handleCopy(): Promise<void> {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      startTransition(() => {
        setCopied(true);
      });
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in non-secure contexts (rare for localhost,
      // but Electron may report file:// for some webviews). Silent failure
      // is the right call — the token is still visible in the <code> block
      // and the user can hand-select it.
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <code
          aria-label={t("settings.mcp.token.title")}
          className="flex-1 break-all rounded-md border border-border bg-app px-3 py-2 font-mono text-[12px] text-text"
        >
          {token}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? t("settings.mcp.token.copied") : t("settings.mcp.token.copy")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary transition-colors hover:bg-subtle hover:text-text",
            copied && "border-border-strong text-text",
          )}
        >
          {copied ? (
            <Check className="h-3 w-3" aria-hidden />
          ) : (
            <Copy className="h-3 w-3" aria-hidden />
          )}
          <span>
            {copied ? t("settings.mcp.token.copied") : t("settings.mcp.token.copy")}
          </span>
        </button>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        {t("settings.mcp.token.path")}
        <span className="ml-2 normal-case tracking-normal text-text-secondary">
          {tokenPath}
        </span>
      </p>
    </div>
  );
}
