import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { getT } from "@/lib/i18n/server";
import { McpTokenDisplay } from "@/components/settings/mcp-token-display";

export const dynamic = "force-dynamic";

const TOKEN_PATH = join(homedir(), ".journal", "mcp.json");
const NPM_INSTALL_CMD = "npm i -g trading-journal-mcp";
const CLIENT_CONFIG_SNIPPET = `{
  "mcpServers": {
    "trading-journal": {
      "command": "trading-journal-mcp"
    }
  }
}`;
const CLAUDE_CONFIG_PATH_MACOS =
  "~/Library/Application Support/Claude/claude_desktop_config.json";
const CLAUDE_CONFIG_PATH_WINDOWS =
  "%APPDATA%\\Claude\\claude_desktop_config.json";

interface TokenStatus {
  token: string | null;
  active: boolean;
}

/**
 * Read the MCP token from disk. The electron main process writes it on first
 * launch — when running outside Electron (e.g. `pnpm dev` from the web app
 * shell), the file won't exist and we render the "not yet provisioned" state.
 *
 * We never expose this read via an API route; only this server component (and
 * the electron main process) touch the file. Failure modes are all benign:
 *   - ENOENT → display the unprovisioned state.
 *   - Anything else → log and display unprovisioned.
 */
async function loadTokenStatus(): Promise<TokenStatus> {
  try {
    const raw = await fs.readFile(TOKEN_PATH, "utf8");
    const parsed = JSON.parse(raw) as { token?: unknown };
    if (typeof parsed.token === "string" && /^[0-9a-f]{64}$/.test(parsed.token.trim())) {
      return { token: parsed.token.trim(), active: true };
    }
    return { token: null, active: false };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      // Permission/parse issues are rare but interesting. Log without the
      // payload — we have no business showing token-file errors in the UI.
      console.error("[settings/mcp] token file unreadable:", code);
    }
    return { token: null, active: false };
  }
}

export default async function McpSettingsPage() {
  const t = await getT();
  const { token, active } = await loadTokenStatus();

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-2 border-b border-border pb-5">
        <h2 className="font-serif text-[24px] font-medium leading-tight text-text">
          {t("settings.mcp.sectionHeading")}
        </h2>
        <p className="font-serif text-[13px] italic text-text-secondary">
          {t("settings.mcp.sectionSubtitle")}
        </p>
      </div>

      {/* Status card */}
      <section
        aria-labelledby="mcp-status-heading"
        className="flex items-center gap-3 rounded-md border border-border bg-surface px-5 py-4"
      >
        <span
          aria-hidden
          className={
            active
              ? "inline-block h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]"
              : "inline-block h-2 w-2 rounded-full bg-text-tertiary"
          }
        />
        <div className="flex-1">
          <p
            id="mcp-status-heading"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary"
          >
            {t("settings.mcp.status.label")}
          </p>
          <p className="mt-0.5 font-serif text-[14px] leading-snug text-text">
            {active
              ? t("settings.mcp.status.active")
              : t("settings.mcp.status.inactive")}
          </p>
        </div>
      </section>

      {/* Token card */}
      <section
        aria-labelledby="mcp-token-heading"
        className="space-y-4 rounded-md border border-border bg-surface px-5 py-5"
      >
        <div>
          <h3
            id="mcp-token-heading"
            className="font-serif text-[16px] font-medium leading-tight text-text"
          >
            {t("settings.mcp.token.title")}
          </h3>
          <p className="mt-1.5 font-serif text-[13px] leading-snug text-text-secondary">
            {t("settings.mcp.token.body")}
          </p>
        </div>

        <McpTokenDisplay token={token} tokenPath={TOKEN_PATH} />

        <p className="font-serif text-[12.5px] italic leading-snug text-text-tertiary">
          {t("settings.mcp.token.warning")}
        </p>
      </section>

      {/* Install instructions */}
      <section
        aria-labelledby="mcp-install-heading"
        className="space-y-4"
      >
        <div>
          <h3
            id="mcp-install-heading"
            className="font-serif text-[18px] font-medium leading-tight text-text"
          >
            {t("settings.mcp.install.sectionTitle")}
          </h3>
          <p className="mt-1 font-serif text-[13px] italic leading-snug text-text-secondary">
            {t("settings.mcp.install.sectionBody")}
          </p>
        </div>

        <CodeBlock label={t("settings.mcp.install.npmHeading")} body={NPM_INSTALL_CMD} />

        <div className="space-y-2">
          <ClientConfigDetails
            summary={t("settings.mcp.install.clients.claudeDesktop")}
            pathLabel={t("settings.mcp.install.paths.macos")}
            pathBody={CLAUDE_CONFIG_PATH_MACOS}
            pathLabelAlt={t("settings.mcp.install.paths.windows")}
            pathBodyAlt={CLAUDE_CONFIG_PATH_WINDOWS}
            configHeading={t("settings.mcp.install.configHeading")}
            configSnippet={CLIENT_CONFIG_SNIPPET}
            tokenNote={t("settings.mcp.install.tokenNote")}
          />
          <ClientConfigDetails
            summary={t("settings.mcp.install.clients.cursor")}
            pathLabel={t("settings.mcp.install.paths.macos")}
            pathBody={t("settings.mcp.install.paths.cursorBody")}
            configHeading={t("settings.mcp.install.configHeading")}
            configSnippet={CLIENT_CONFIG_SNIPPET}
            tokenNote={t("settings.mcp.install.tokenNote")}
          />
          <ClientConfigDetails
            summary={t("settings.mcp.install.clients.zed")}
            pathLabel={t("settings.mcp.install.paths.macos")}
            pathBody={t("settings.mcp.install.paths.zedBody")}
            configHeading={t("settings.mcp.install.configHeading")}
            configSnippet={CLIENT_CONFIG_SNIPPET}
            tokenNote={t("settings.mcp.install.tokenNote")}
          />
        </div>
      </section>

      {/* What can / can't be seen */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <section
          aria-labelledby="mcp-can-see-heading"
          className="space-y-3 rounded-md border border-border bg-surface px-5 py-5"
        >
          <h3
            id="mcp-can-see-heading"
            className="font-serif text-[15px] font-medium leading-tight text-text"
          >
            {t("settings.mcp.canSee.title")}
          </h3>
          <ul className="space-y-2 font-serif text-[13px] leading-snug text-text-secondary">
            <BulletItem>{t("settings.mcp.canSee.items.activities")}</BulletItem>
            <BulletItem>{t("settings.mcp.canSee.items.notes")}</BulletItem>
            <BulletItem>{t("settings.mcp.canSee.items.tags")}</BulletItem>
            <BulletItem>{t("settings.mcp.canSee.items.exchanges")}</BulletItem>
          </ul>
        </section>

        <section
          aria-labelledby="mcp-cannot-see-heading"
          className="space-y-3 rounded-md border border-border bg-surface px-5 py-5"
        >
          <h3
            id="mcp-cannot-see-heading"
            className="font-serif text-[15px] font-medium leading-tight text-text"
          >
            {t("settings.mcp.cannotSee.title")}
          </h3>
          <ul className="space-y-2 font-serif text-[13px] leading-snug text-text-secondary">
            <BulletItem>{t("settings.mcp.cannotSee.items.apiKeys")}</BulletItem>
            <BulletItem>{t("settings.mcp.cannotSee.items.masterKey")}</BulletItem>
            <BulletItem>{t("settings.mcp.cannotSee.items.credentials")}</BulletItem>
          </ul>
        </section>
      </div>

      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        {t("settings.mcp.footer")}
      </p>
    </div>
  );
}

function BulletItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-text-tertiary"
      />
      <span>{children}</span>
    </li>
  );
}

function CodeBlock({ label, body }: { label: string; body: string }) {
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        {label}
      </p>
      <pre className="overflow-x-auto rounded-md border border-border bg-app px-3 py-2 font-mono text-[12px] text-text">
        {body}
      </pre>
    </div>
  );
}

interface ClientConfigDetailsProps {
  summary: string;
  pathLabel: string;
  pathBody: string;
  pathLabelAlt?: string;
  pathBodyAlt?: string;
  configHeading: string;
  configSnippet: string;
  tokenNote: string;
}

function ClientConfigDetails({
  summary,
  pathLabel,
  pathBody,
  pathLabelAlt,
  pathBodyAlt,
  configHeading,
  configSnippet,
  tokenNote,
}: ClientConfigDetailsProps) {
  return (
    <details className="group rounded-md border border-border bg-surface px-5 py-4">
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary [&::-webkit-details-marker]:hidden">
        <span className="font-serif text-[14px] font-medium normal-case tracking-normal text-text">
          {summary}
        </span>
      </summary>
      <div className="mt-4 space-y-4">
        <PathRow label={pathLabel} body={pathBody} />
        {pathLabelAlt && pathBodyAlt && (
          <PathRow label={pathLabelAlt} body={pathBodyAlt} />
        )}
        <CodeBlock label={configHeading} body={configSnippet} />
        <p className="font-serif text-[12.5px] italic leading-snug text-text-tertiary">
          {tokenNote}
        </p>
      </div>
    </details>
  );
}

function PathRow({ label, body }: { label: string; body: string }) {
  return (
    <div className="space-y-1">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        {label}
      </p>
      <p className="font-mono text-[12px] leading-snug text-text">{body}</p>
    </div>
  );
}
