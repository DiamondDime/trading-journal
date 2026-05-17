import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/resolve";

/**
 * Page-level empty state shown when the user has too few closed activities
 * to make the analytics meaningful (< MIN_FOR_ANALYTICS). Each page passes
 * its own `headline` so the message stays relevant.
 */

export const MIN_FOR_ANALYTICS = 5;

interface Props {
  headline: string;
  /** Optional body line below the headline. */
  body?: string;
  /** Current count to surface — "Log at least N activities (you have M)". */
  current: number;
}

export async function AnalyticsEmptyState({ headline, body, current }: Props) {
  const t = await getT();
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-md border border-dashed border-border bg-surface px-8 py-16 text-center">
      <p className="font-serif text-[18px] italic leading-snug text-text">
        {headline}
      </p>
      {body && (
        <p className="max-w-xl font-serif text-[14px] italic leading-snug text-text-tertiary">
          {body}
        </p>
      )}
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
        {t("analytics.empty.progress" as MessageKey, {
          current,
          total: MIN_FOR_ANALYTICS,
        })}
      </p>
      <Link
        href="/add"
        className="font-mono text-[11px] uppercase tracking-[0.16em] text-text underline-offset-4 hover:underline"
      >
        {t("analytics.empty.logActivity" as MessageKey)}
      </Link>
    </div>
  );
}
