import type { Metadata } from "next";
import Link from "next/link";
import { X } from "lucide-react";
import { getT } from "@/lib/i18n/server";

/**
 * Wizard chrome. Narrow centered column, top bar with brand on the left and
 * Cancel link on the right (always returns to /spreads, the dashboard).
 * Each step page lays out its own breadcrumb + stepper via WizardShell.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("wizard.shell.pageTitle") };
}

export default async function AddLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getT();
  return (
    <div className="min-h-screen w-full bg-app">
      {/* ── top bar ─────────────────────────────────────────────────────── */}
      <div className="border-b border-border bg-surface/70 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link
            href="/spreads"
            className="flex items-center gap-2 transition-opacity hover:opacity-70"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-signature/15">
              <span className="font-serif text-[14px] italic font-semibold text-signature">
                J
              </span>
            </div>
            <span className="font-serif text-[13px] italic font-medium text-text">
              {t("app.name")}
            </span>
          </Link>

          <Link
            href="/spreads"
            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:text-text"
          >
            <X className="h-3 w-3" />
            {t("common.cancel")}
          </Link>
        </div>
      </div>

      {/* ── content column ──────────────────────────────────────────────── */}
      <main id="main-content" className="mx-auto max-w-3xl px-6 py-12 md:py-16">{children}</main>
    </div>
  );
}
