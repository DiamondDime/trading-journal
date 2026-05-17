import { getLocale, getT } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/types";
import type { MessageKey } from "@/lib/i18n/resolve";

/**
 * "Last updated" mono caption rendered in the bottom-right of every analytics
 * page. Since the pages are `dynamic = 'force-dynamic'` and recompute on
 * every request, the timestamp is `now()` formatted in the server's local TZ.
 *
 * Server component — value is captured at render time.
 */
function fmtNow(locale: Locale): string {
  const d = new Date();
  return d.toLocaleString(locale === "ru" ? "ru-RU" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export async function LastUpdatedFooter() {
  const t = await getT();
  const locale = await getLocale();
  return (
    <footer className="mt-10 flex items-center justify-between border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
      <span>{t("analytics.footer.tagline" as MessageKey)}</span>
      <span>
        {t("analytics.footer.lastUpdated" as MessageKey, { date: fmtNow(locale) })}
      </span>
    </footer>
  );
}
