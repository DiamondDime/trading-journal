"use client";

import * as React from "react";
import { Link2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

/**
 * Sticky bottom bar that surfaces how many rows the user has ticked and
 * lets them submit the parent form (which `action="/add/spread/type"`s with
 * the selected position ids as `legs=` params).
 *
 * Why no state library / context:
 *   - This component is rendered inside the same `<form>` as the table. To
 *     stay loose-coupled from the table markup (no shared selection store),
 *     we listen for `change` events on the form via event delegation and
 *     count the ticked `input[name="legs"]:checked` ourselves.
 *   - That keeps the table 100% server-rendered (cheap to re-render on
 *     filter changes) and isolates client-only behaviour to this island.
 *
 * The component finds the nearest `<form>` ancestor on mount and watches
 * its `change` events. Disabled-state for <2 ticked + the "Clear" reset
 * are the only mutations of form state.
 */
export function FeedSelectionBar() {
  const t = useT();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const [count, setCount] = React.useState(0);

  // Locate the parent form once, then subscribe to its change events. We
  // explicitly walk up the DOM rather than relying on `event.target.form`
  // so the listener doesn't fire on unrelated forms elsewhere in the layout.
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const form = root.closest("form");
    if (!(form instanceof HTMLFormElement)) return;
    formRef.current = form;

    function recount() {
      const f = formRef.current;
      if (!f) return;
      const checked = f.querySelectorAll<HTMLInputElement>(
        'input[name="legs"]:checked',
      );
      setCount(checked.length);
    }
    recount();
    function onReset() {
      // Reset runs before the inputs actually update — defer one frame.
      window.requestAnimationFrame(recount);
    }
    form.addEventListener("change", recount);
    form.addEventListener("reset", onReset);
    return () => {
      form.removeEventListener("change", recount);
      form.removeEventListener("reset", onReset);
    };
  }, []);

  function clearAll() {
    const f = formRef.current;
    if (!f) return;
    const inputs = f.querySelectorAll<HTMLInputElement>(
      'input[name="legs"]:checked',
    );
    inputs.forEach((el) => {
      el.checked = false;
    });
    setCount(0);
  }

  // Hidden when nothing is ticked. The wrapping div is always rendered so
  // we don't have to remount on first selection — just opacity-toggle.
  const visible = count >= 1;
  const canSubmit = count >= 2;

  return (
    <div
      ref={rootRef}
      aria-hidden={!visible}
      className={cn(
        "pointer-events-none sticky bottom-0 left-0 right-0 z-30 flex justify-center px-4 pb-4 transition-opacity duration-150",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-4 rounded-md border border-border-strong bg-surface px-4 py-2 shadow-lg",
        )}
        role="region"
        aria-live="polite"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text">
          {t.plural("trades.feed.bulk.selectN", count)}
        </span>

        <button
          type="button"
          onClick={clearAll}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary transition-colors hover:bg-subtle"
        >
          <X className="h-3 w-3" />
          {t("trades.feed.bulk.clear")}
        </button>

        <button
          type="submit"
          disabled={!canSubmit}
          title={!canSubmit ? t("trades.feed.bulk.selectMin") : undefined}
          aria-disabled={!canSubmit}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-text bg-text px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-app transition-colors",
            canSubmit
              ? "hover:bg-text-secondary"
              : "cursor-not-allowed opacity-50",
          )}
        >
          <Link2 className="h-3 w-3" />
          {t("trades.feed.bulk.linkAsSpread")}
        </button>
      </div>
    </div>
  );
}
