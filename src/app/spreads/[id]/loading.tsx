import { Loader2 } from "lucide-react";
import { getT } from "@/lib/i18n/server";

export default async function SpreadDetailLoading() {
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
