/**
 * Root /not-found boundary — catches any `notFound()` call from anywhere
 * below this segment, plus unknown URLs at the root. Stays inside the
 * sidebar/layout chrome so the user can still navigate elsewhere.
 */
import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";
import { getT } from "@/lib/i18n/server";

export default async function GlobalNotFound() {
  const t = await getT();
  return (
    <div className="flex min-h-[70vh] w-full items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <SearchX className="h-7 w-7 text-text-tertiary" />
        <h1 className="font-serif text-[28px] font-medium leading-tight text-text">
          {t("boundary.notFound.title")}
        </h1>
        <p className="font-serif text-[14px] italic text-text-tertiary">
          {t("boundary.notFound.body")}
        </p>
        <Link
          href="/"
          className="mt-2 inline-flex items-center gap-2 rounded-md bg-text px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-opacity hover:opacity-90"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("boundary.notFound.home")}
        </Link>
      </div>
    </div>
  );
}
