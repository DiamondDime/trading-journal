"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

interface SubnavItem {
  label: string;
  href: string;
  caption: string;
}

export function SettingsSubnav() {
  const pathname = usePathname();
  const t = useT();

  const items: SubnavItem[] = [
    {
      label: t("settings.sections.exchanges"),
      href: "/settings/exchanges",
      caption: t("subnav.settings.exchangesCaption"),
    },
    {
      label: t("settings.sections.profile"),
      href: "/settings/profile",
      caption: t("subnav.settings.profileCaption"),
    },
    {
      label: t("settings.sections.about"),
      href: "/settings/about",
      caption: t("subnav.settings.aboutCaption"),
    },
  ];

  return (
    <nav aria-label={t("subnav.settings.aria")}>
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
