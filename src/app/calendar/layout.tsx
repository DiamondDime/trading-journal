import { Sidebar } from "@/components/sidebar";

/**
 * Calendar route layout — same chrome as /spreads (sidebar + scrollable main).
 * Kept as a separate layout file so the route can evolve independently of the
 * book / archive shells without leaking layout concerns into them.
 */
export default function CalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-full bg-app">
      <Sidebar />
      <main id="main-content" className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
