import { Sidebar } from "@/components/sidebar";

/**
 * Layout for /movement-events. Mirrors /watchlist + /analytics chrome
 * (sidebar + scrollable main column) so the movements feed feels like a
 * peer of the activity surfaces.
 */
export default function MovementEventsLayout({
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
