import Link from "next/link";
import { ArrowUpRight, Heart } from "lucide-react";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

const APP_VERSION = "0.1.0";
const LICENSE = "AGPL-3.0";
const REPO_URL = "https://github.com/DiamondDime/trading-journal";

export default async function AboutSettingsPage() {
  const t = await getT();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-serif text-[24px] font-medium leading-tight text-text">
          {t("common.about")}
        </h2>
        <p className="mt-1 font-serif text-[13px] italic text-text-secondary">
          {t("settings.about.subtitle")}
        </p>
      </div>

      <dl className="grid grid-cols-1 divide-y divide-border rounded-md border border-border bg-surface text-[13px]">
        <FieldRow label={t("settings.about.version")} value={APP_VERSION} />
        <FieldRow label={t("settings.about.license")} value={LICENSE} />
        <FieldRow
          label={t("settings.about.repository")}
          value={
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-text underline decoration-text-tertiary decoration-1 underline-offset-2 hover:decoration-text"
            >
              github.com/DiamondDime/trading-journal
              <ArrowUpRight className="h-3 w-3" />
            </a>
          }
        />
        <FieldRow label={t("settings.about.build")} value={`Next.js 16 · React 19`} />
      </dl>

      {/* ─── Support the project ─────────────────────────────────────────
          The referral rail proper lives on /settings/exchanges so users
          discover it where they're already adding accounts. This block is
          a soft signpost — no duplicated logo grid. */}
      <section
        aria-labelledby="support-heading"
        className="rounded-md border border-border bg-surface px-5 py-5"
      >
        <div className="flex items-start gap-4">
          <span
            aria-hidden
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-subtle"
          >
            <Heart className="h-3.5 w-3.5 text-text-secondary" />
          </span>

          <div className="flex-1">
            <h3
              id="support-heading"
              className="font-serif text-[16px] font-medium leading-tight text-text"
            >
              {t("settings.about.supportTitle")}
            </h3>
            <p className="mt-1.5 font-serif text-[13px] italic leading-snug text-text-secondary">
              {t("settings.about.supportBody")}
            </p>

            <Link
              href="/settings/exchanges"
              className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-text underline decoration-text-tertiary decoration-1 underline-offset-2 transition-colors hover:decoration-text"
            >
              {t("settings.about.supportCta")}
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </section>

      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        {t("settings.about.footer")}
      </p>
    </div>
  );
}

function FieldRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3.5">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        {label}
      </dt>
      <dd className="font-mono text-[12px] text-text">{value}</dd>
    </div>
  );
}
