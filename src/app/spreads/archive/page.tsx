import { Suspense } from "react";
import { ArchiveBrowser } from "@/components/spread/archive-browser";
import { ARCHIVE_DATA } from "@/lib/data/archive-data";

export const dynamic = "force-static";

export default function ArchivePage() {
  return (
    <Suspense fallback={null}>
      <ArchiveBrowser data={ARCHIVE_DATA} />
    </Suspense>
  );
}
