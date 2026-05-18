import { Sidebar } from "@/components/sidebar";

/**
 * Layout for /balances + /balances/[exchange]. Mirrors the /spreads chrome so
 * the balances surface gets the same sidebar/main column as every other page
 * of the journal (without this, the page rendered full-width with no nav).
 */
export default function BalancesLayout({
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
