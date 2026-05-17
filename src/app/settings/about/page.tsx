import Link from "next/link";
import { ArrowUpRight, Heart } from "lucide-react";

export const dynamic = "force-static";

const APP_VERSION = "0.1.0";
const LICENSE = "AGPL-3.0";
const REPO_URL = "https://github.com/skywalqr/crypto-spread-journal";

export default function AboutSettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-serif text-[24px] font-medium leading-tight text-text">
          About
        </h2>
        <p className="mt-1 font-serif text-[13px] italic text-text-secondary">
          A private, single-user journal for crypto spread specialists. Runs
          locally against your own Postgres — no cloud, no telemetry.
        </p>
      </div>

      <dl className="grid grid-cols-1 divide-y divide-border rounded-md border border-border bg-surface text-[13px]">
        <FieldRow label="Version" value={APP_VERSION} />
        <FieldRow label="License" value={LICENSE} />
        <FieldRow
          label="Repository"
          value={
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-text underline decoration-text-tertiary decoration-1 underline-offset-2 hover:decoration-text"
            >
              github.com/skywalqr/crypto-spread-journal
              <ArrowUpRight className="h-3 w-3" />
            </a>
          }
        />
        <FieldRow label="Build" value={`Next.js 16 · React 19`} />
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
              Support the project
            </h3>
            <p className="mt-1.5 font-serif text-[13px] italic leading-snug text-text-secondary">
              If you find the journal useful, sign up to a new exchange via one
              of our referral links — no extra cost to you, and it keeps the
              lights on for open development.
            </p>

            <Link
              href="/settings/exchanges"
              className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-text underline decoration-text-tertiary decoration-1 underline-offset-2 transition-colors hover:decoration-text"
            >
              View recommended exchanges
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </section>

      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        Made for spread traders · open source
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
