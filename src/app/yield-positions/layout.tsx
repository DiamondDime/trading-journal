import { Sidebar } from "@/components/sidebar";

/**
 * Layout for /yield-positions. Adds the global sidebar so this page matches the chrome
 * of every other journal surface.
 */
export default function YieldPositionsLayout({
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
