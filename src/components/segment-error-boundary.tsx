"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n/client";

interface SegmentErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
  label: string;
}

export function SegmentErrorBoundary({
  error,
  reset,
  label,
}: SegmentErrorBoundaryProps) {
  const t = useT();

  React.useEffect(() => {
    console.error(`[csj] ${label} boundary error`, error);
  }, [error, label]);

  return (
    <div className="flex min-h-[70vh] w-full items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <AlertTriangle className="h-7 w-7 text-down" />
        <h1 className="font-serif text-[28px] font-medium leading-tight text-text">
          {t("boundary.error.title")}
        </h1>
        <p className="font-serif text-[14px] italic text-text-tertiary">
          {t("boundary.error.body")}
        </p>
        {error.digest && (
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {t("boundary.error.digest")}: {error.digest}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-md bg-text px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-opacity hover:opacity-90"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("boundary.error.retry")}
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-app px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-text hover:border-border-strong"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("boundary.error.home")}
          </Link>
        </div>
      </div>
    </div>
  );
}
