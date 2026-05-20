import { Sidebar } from "@/components/sidebar";

export default function NotesLayout({
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
