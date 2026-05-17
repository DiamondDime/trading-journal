import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: `${t("partners.title")} · ${t("app.name")}`,
    description: t("partners.subtitle"),
  };
}

export default function PartnersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-full bg-app">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
