import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { getT } from "@/lib/i18n/server";

export async function SiteHeader() {
  const t = await getT();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-app/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="font-serif text-base italic tracking-tight text-text"
        >
          {t("app.name")}
          <span className="ml-2 text-xs not-italic font-sans uppercase tracking-[0.18em] text-text-tertiary align-middle">
            · csj
          </span>
        </Link>

        <nav
          className="hidden items-center gap-7 text-sm font-medium text-text-secondary md:flex"
          aria-label={t("header.primaryNavAria")}
        >
          <Link href="/spreads" className="hover:text-text transition-colors">
            {t("sidebar.nav.overview")}
          </Link>
          <Link href="/spreads/archive" className="hover:text-text transition-colors">
            {t("sidebar.nav.archive")}
          </Link>
          <Link href="/settings/exchanges" className="hover:text-text transition-colors">
            {t("sidebar.nav.exchanges")}
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
