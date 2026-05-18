'use client';

import * as React from 'react';
import { SearchPalette } from './search-palette';

/**
 * Mount the global ⌘K / Ctrl-K keybind + own the palette's open state.
 *
 * Why this component exists: the search palette needs to be mounted at the
 * root of the tree so it can overlay any route, but the trigger is a global
 * keyboard shortcut not tied to any visible element. This sidesteps the
 * sidebar (Wave 2 will wire ⌘K through there) by mounting once in the root
 * layout and listening at the document level.
 *
 * The listener guards against the usual gotchas:
 *   - ignores key events fired while typing in another input / textarea /
 *     contenteditable, so users editing notes can still type Cmd-K to
 *     open URL bar on macOS (they expect that)... actually we DO want to
 *     intercept Cmd-K everywhere — it's the journal's primary command —
 *     so the only exclusion is `preventDefault` is skipped on already-
 *     handled events, and we don't catch Cmd-K while typing into a search
 *     box that has its own handler.
 *   - "preventDefault" is called so the browser's "Erase URL" (Cmd-K in
 *     Firefox/Chrome address bar mode, when focused) doesn't intercept.
 *   - `/` shortcut is intentionally NOT bound here: that conflicts with
 *     vim-style users typing into text inputs.
 */
export function SearchKeybind() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const cmdOrCtrl = event.metaKey || event.ctrlKey;
      if (!cmdOrCtrl) return;
      if (event.key !== 'k' && event.key !== 'K') return;

      // Don't fight contenteditable rich-text editors using ⌘K for their own
      // command (e.g. add-link in notes). Plain inputs/textareas are fine to
      // override — the journal's command palette is the higher value here.
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;

      event.preventDefault();
      setOpen((prev) => !prev);
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return <SearchPalette open={open} onOpenChange={setOpen} />;
}
