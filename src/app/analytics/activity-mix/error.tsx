"use client";

import { SegmentErrorBoundary } from "@/components/segment-error-boundary";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ActivityMixError({ error, reset }: Props) {
  return (
    <SegmentErrorBoundary error={error} reset={reset} label="activity-mix" />
  );
}
