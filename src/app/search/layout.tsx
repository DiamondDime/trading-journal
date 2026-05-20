import { Sidebar } from "@/components/sidebar";

/**
 * Layout for /search. Same chrome as the rest of the journal so users can
 * navigate back without losing their nav context.
 */
export default function SearchLayout({
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
