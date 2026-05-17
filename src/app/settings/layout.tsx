import { Sidebar } from "@/components/sidebar";
import { SettingsSubnav } from "@/components/settings/settings-subnav";
import { getT } from "@/lib/i18n/server";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getT();
  return (
    <div className="flex h-screen w-full bg-app">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1240px] px-8 pb-16 pt-10">
          {/* Page chrome */}
          <header className="mb-8 flex flex-col gap-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
              {t("settings.eyebrow")}
            </p>
            <h1 className="font-serif text-[38px] font-medium leading-tight tracking-tight text-text">
              {t("settings.title")}
            </h1>
            <p className="font-serif text-[14px] italic leading-snug text-text-secondary">
              {t("settings.subtitle")}
            </p>
          </header>

          <div className="grid grid-cols-1 gap-10 md:grid-cols-[180px_1fr]">
            <SettingsSubnav />
            <section className="min-w-0">{children}</section>
          </div>
        </div>
      </main>
    </div>
  );
}
