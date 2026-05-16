"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface SubnavItem {
  label: string;
  href: string;
  caption: string;
}

const items: SubnavItem[] = [
  {
    label: "Exchanges",
    href: "/settings/exchanges",
    caption: "Connections & API keys",
  },
  {
    label: "Profile",
    href: "/settings/profile",
    caption: "Identity & locale",
  },
  {
    label: "About",
    href: "/settings/about",
    caption: "Build & license",
  },
];

export function SettingsSubnav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections">
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group flex flex-col gap-0.5 rounded-md border px-3 py-2.5 transition-colors",
                  isActive
                    ? "border-border-strong bg-subtle"
                    : "border-transparent hover:bg-subtle"
                )}
              >
                <span
                  className={cn(
                    "font-serif text-[14px] font-medium leading-tight",
                    isActive ? "text-text" : "text-text-secondary"
                  )}
                >
                  {item.label}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
                  {item.caption}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
