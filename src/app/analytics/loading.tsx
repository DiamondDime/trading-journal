/**
 * Analytics suite /loading boundary — shown while any analytics page server
 * component is suspending. Mirrors the root loading.tsx style (spinner +
 * editorial mono caption) so navigation within the analytics sub-nav feels
 * consistent with the rest of the app.
 */
import { Loader2 } from "lucide-react";
import { getT } from "@/lib/i18n/server";

export default async function AnalyticsLoading() {
  const t = await getT();
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          {t("boundary.loading.title")}
        </p>
        <p className="max-w-xs font-serif text-[13px] italic text-text-tertiary">
          {t("boundary.loading.body")}
        </p>
      </div>
    </div>
  );
}
