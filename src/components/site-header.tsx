import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-app/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="font-serif text-base italic tracking-tight text-text"
        >
          Spread Journal
          <span className="ml-2 text-xs not-italic font-sans uppercase tracking-[0.18em] text-text-tertiary align-middle">
            · csj
          </span>
        </Link>

        <nav className="hidden items-center gap-7 text-sm font-medium text-text-secondary md:flex">
          <Link href="#" className="hover:text-text transition-colors">
            Currently held
          </Link>
          <Link href="#" className="hover:text-text transition-colors">
            The archive
          </Link>
          <Link href="#" className="hover:text-text transition-colors">
            Track record
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
