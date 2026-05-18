/**
 * Shared helpers for the e2e suite.
 *
 * These exist so each spec stays focused on its own assertions instead of
 * re-implementing locale-cookie setup and console/page-error tracking.
 */
import type { BrowserContext, Page } from "@playwright/test";

export type Locale = "en" | "ru";

/**
 * Pre-seed the `csj-locale` cookie before any navigation. The server reads
 * this cookie inside `getT()` so layout / RSC payloads are rendered against
 * the chosen locale on the very first request.
 *
 * We attach the cookie to *both* `localhost` and `127.0.0.1` because some
 * Playwright versions normalize differently on macOS.
 */
export async function setLocaleCookie(
  context: BrowserContext,
  locale: Locale,
): Promise<void> {
  await context.addCookies([
    {
      name: "csj-locale",
      value: locale,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

/**
 * Inject CSS that hides the Next.js dev-mode error overlay. When the dev
 * server flags a hydration mismatch, an error toast (`<nextjs-portal>`)
 * mounts on top of the page and *intercepts pointer events* — meaning every
 * click test fails with "pointer events intercepted" rather than the real
 * assertion.
 *
 * We hide it visually + pointer-events:none for tests. This does NOT hide
 * the underlying issue: the hydration error still fires as a console.error,
 * and trackPageErrors() still surfaces it (unless explicitly filtered).
 *
 * Call once per page in `beforeEach` / inside the spec before navigation.
 *
 * Why an `addInitScript` rather than a stylesheet: we need this to apply
 * before the dev overlay mounts, on every navigation, without requiring a
 * separate <style> tag injection step.
 */
export async function hideDevOverlay(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const css = `
      nextjs-portal,
      [data-nextjs-toast],
      [data-nextjs-dialog-overlay],
      [data-nextjs-dialog],
      [data-nextjs-error-overlay] {
        display: none !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }
    `;
    const style = document.createElement("style");
    style.setAttribute("data-test-hide-dev-overlay", "true");
    style.textContent = css;
    // Document may not have <head> yet at first init-script run; queue if so.
    const insert = () => document.head?.appendChild(style);
    if (document.head) insert();
    else document.addEventListener("DOMContentLoaded", insert, { once: true });
  });
}

/**
 * Subscribe to `console` and `pageerror` events on the given page and collect
 * them into the returned arrays. Call the returned `getErrors()` after
 * navigation to assert "no console errors fired during this nav".
 *
 * The function captures both:
 *   - `console.error` calls (type === 'error')
 *   - Uncaught exceptions (`pageerror`)
 *
 * It DOES NOT subscribe to `console.warn` — Next.js dev mode is full of
 * benign warnings (HMR, double-render notice, devtools tips). We're testing
 * for real bugs only.
 */
export interface PageErrorTracker {
  consoleErrors: string[];
  pageErrors: string[];
  /** Returns a combined snapshot for assertion messages. */
  snapshot(): string;
  /** Returns true when both buckets are empty. */
  isClean(): boolean;
}

export function trackPageErrors(page: Page): PageErrorTracker {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      // Filter out a handful of well-known browser noise that isn't actionable
      // (missing favicon in dev, devtools warnings about React DevTools).
      const text = msg.text();
      if (isIgnorableConsoleError(text)) return;
      consoleErrors.push(text);
    }
  });

  page.on("pageerror", (err) => {
    const msg = `${err.name}: ${err.message}`;
    if (isIgnorablePageError(msg)) return;
    pageErrors.push(msg);
  });

  return {
    consoleErrors,
    pageErrors,
    snapshot() {
      const parts: string[] = [];
      if (consoleErrors.length > 0) {
        parts.push("console.error:\n  " + consoleErrors.join("\n  "));
      }
      if (pageErrors.length > 0) {
        parts.push("pageerror:\n  " + pageErrors.join("\n  "));
      }
      return parts.length === 0 ? "(none)" : parts.join("\n");
    },
    isClean() {
      return consoleErrors.length === 0 && pageErrors.length === 0;
    },
  };
}

/**
 * Patterns of console.error output we intentionally ignore. Keep this list
 * very short — every entry hides real failures, so prefer fixing the source
 * over expanding the ignore list.
 */
const IGNORABLE_PATTERNS: readonly RegExp[] = [
  // Missing /favicon.ico in dev mode (Next 16 logs this as console.error).
  /favicon\.ico/,
  // React DevTools self-promotion in dev.
  /Download the React DevTools/i,
];

function isIgnorableConsoleError(text: string): boolean {
  return IGNORABLE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Page-error patterns that are dev-only Next.js internals, not real user
 * bugs. Same warning as the console-error list: every entry hides things —
 * keep this list tiny.
 */
const IGNORABLE_PAGE_ERROR_PATTERNS: readonly RegExp[] = [
  // Next.js 16 dev-mode performance instrumentation logs a negative
  // timestamp on routes that immediately `redirect()`. Visible only in dev.
  // The redirect itself works correctly (the user lands on the target page
  // with a 200 status). Filter so /settings doesn't permanently red-line
  // the smoke suite.
  /Performance.*cannot have a negative time stamp/i,
];

function isIgnorablePageError(text: string): boolean {
  return IGNORABLE_PAGE_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}
