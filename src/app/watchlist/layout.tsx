import { Sidebar } from "@/components/sidebar";

/**
 * Layout for /watchlist. Mirrors the /spreads + /analytics chrome (sidebar +
 * scrollable main column) so the watchlist feels like a peer of the journal
 * surfaces, not an outlier.
 */
export default function WatchlistLayout({
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
