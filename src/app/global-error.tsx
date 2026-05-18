"use client";

/**
 * Last-resort boundary. Kicks in only when the root layout itself
 * throws (e.g. failed font load, missing locale messages, etc) — at
 * which point we have no chrome, no theme provider, and no i18n
 * context. So we render plain HTML in inline-styled English. The chance
 * of seeing this in normal operation is near zero; this is the "the
 * app is on fire" screen.
 */
import * as React from "react";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RootCatastrophicError({ error, reset }: Props) {
  React.useEffect(() => {
    console.error("[csj] global-error", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#f8f8f7",
          color: "#1a1a1a",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, margin: 0, marginBottom: 12 }}>
            The app crashed
          </h1>
          <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
            A critical error stopped the app from rendering. Refresh the
            page or restart the app.
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                fontSize: 11,
                color: "#999",
                marginBottom: 16,
              }}
            >
              Error ID: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "10px 20px",
              fontSize: 12,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              background: "#1a1a1a",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>
      </body>
    </html>
  );
}
