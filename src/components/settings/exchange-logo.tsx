/**
 * ExchangeLogo — 40px square (configurable) tile with a serif-initial
 * fallback when no logo has been backfilled yet.
 *
 * Design rationale
 *  - Most exchanges will have `logoUrl === null` in v1 (the user backfills
 *    later by either dropping SVGs into `/public/exchanges/<code>.svg` or
 *    pasting base64 SVG into the DB column). The fallback has to feel
 *    intentional, not broken — a generic "?" icon would scream "TODO".
 *  - We use the same serif typeface that drives the rest of the editorial
 *    voice, so a "B" for Binance, "K" for Kraken etc. reads as a publication
 *    drop-cap rather than placeholder text.
 *  - The neutral `bg-subtle` box + `border-border` ring matches the dialog
 *    cards' resting state, so the tile blends with surrounding panel
 *    chrome instead of fighting it.
 *
 * Privacy note
 *  - We pass `logoUrl` straight to <img src>. The contract in
 *    `lib/db/exchanges.ts` guarantees this is either `null`, a local path,
 *    or a `data:` URL — never a remote host. If a future migration
 *    accidentally seeds a remote URL, the request still works but the user's
 *    IP leaks to the exchange. Treat that as a P0 bug.
 */
import { cn } from "@/lib/utils";

interface Props {
  code: string;
  displayName: string;
  logoUrl: string | null;
  size?: "sm" | "md";
  className?: string;
}

const SIZE_BOX = {
  sm: "h-7 w-7 text-[14px]",
  md: "h-10 w-10 text-[20px]",
} as const;

const SIZE_IMG = {
  sm: 28,
  md: 40,
} as const;

export function ExchangeLogo({
  code,
  displayName,
  logoUrl,
  size = "md",
  className,
}: Props) {
  const initial = pickInitial(displayName);

  if (logoUrl) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 overflow-hidden rounded-md border border-border bg-surface",
          SIZE_BOX[size],
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- logos
            are local files or data: URLs; next/image's pipeline assumes a
            CDN-able remote source. See header note for the privacy contract. */}
        <img
          src={logoUrl}
          alt={`${displayName} logo`}
          width={SIZE_IMG[size]}
          height={SIZE_IMG[size]}
          className="h-full w-full object-contain"
          draggable={false}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      data-exchange-code={code}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-md border border-border bg-subtle font-serif font-medium leading-none text-text-secondary",
        SIZE_BOX[size],
        className,
      )}
    >
      {initial}
    </span>
  );
}

/**
 * Pick a single drop-cap character from the display name. Strips leading
 * whitespace and falls back to "·" if the name is somehow empty, so we never
 * render a literal empty box.
 */
function pickInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "·";
  // codePointAt → handles unicode names like "Δerivit" gracefully without
  // splitting a surrogate pair into a mojibake square.
  const cp = trimmed.codePointAt(0);
  if (cp == null) return "·";
  return String.fromCodePoint(cp).toUpperCase();
}
