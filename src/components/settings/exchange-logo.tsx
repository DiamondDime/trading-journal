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

/**
 * Map of well-known exchange display names / codes → catalog code (the
 * key used in `/public/exchanges/{code}.svg`). Used by `<ExchangeChip>` when
 * the surrounding surface only has a free-form venue string and can't easily
 * thread the full catalog row through props.
 *
 * Keys are lower-cased on lookup. We accept both the catalog code
 * ("binance") and the wizard's title-cased label ("Binance"). Venues that
 * aren't in the catalog ("Coinbase", "Bitmex", "Manual") resolve to `null`
 * and the chip falls back to the serif-initial box — same as
 * <ExchangeLogo logoUrl={null} />.
 *
 * Keep this map in sync with the OVERLAY in `src/lib/db/exchanges.ts` and
 * the SVG files in `/public/exchanges/`.
 */
const NAME_TO_CODE: Record<string, string> = {
  binance: "binance",
  bybit: "bybit",
  okx: "okx",
  okx_dex: "okx",
  bitget: "bitget",
  kucoin: "kucoin",
  phemex: "phemex",
  bingx: "bingx",
  mexc: "mexc",
  gate: "gate",
  "gate.io": "gate",
  htx: "htx",
  huobi: "htx",
  kraken: "kraken",
  deribit: "deribit",
  hyperliquid: "hyperliquid",
  aster: "aster",
};

/**
 * Extension per exchange code. Mirrors the actual files in
 * `/public/exchanges/`. Defaults to png — only the SVG-natively-distributed
 * brand assets (Kraken, Deribit) get .svg.
 */
const CODE_TO_EXT: Record<string, "svg" | "png"> = {
  kraken: "svg",
  deribit: "svg",
};
function logoUrlFor(code: string): string {
  const ext = CODE_TO_EXT[code] ?? "png";
  return `/exchanges/${code}.${ext}`;
}

/**
 * Public helper for surfaces (balance rows, drilldowns, anywhere else that
 * builds an `<img>` URL directly without going through ExchangeChip) to
 * resolve the right file extension. Returns the .png path by default,
 * .svg for the few exchanges that ship SVG brand assets.
 */
export function exchangeLogoUrl(code: string): string {
  return logoUrlFor(code);
}

/**
 * Resolve a free-form venue string into a known catalog code, or null if
 * we don't have a logo for it. Lower-cases + strips whitespace before
 * lookup so "Binance", "BINANCE", " binance " all match.
 */
export function resolveExchangeCode(venue: string | null | undefined): string | null {
  if (!venue) return null;
  const key = venue.trim().toLowerCase();
  if (!key) return null;
  return NAME_TO_CODE[key] ?? null;
}

interface ChipProps {
  /** Free-form venue string — exchange display name ("Binance") or catalog
   *  code ("binance"). Anything not in the catalog falls back to the
   *  serif-initial box. */
  venue: string;
  /** Optional explicit override. When set, takes precedence over the
   *  venue-string resolver — use this when you have a full catalog row in
   *  scope and want to skip the string match. */
  code?: string;
  /** Display label override (defaults to `venue`). */
  displayName?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Inline logo + name chip for surfaces that show a venue but don't have
 * direct access to the catalog row (most leaf components — they receive a
 * pre-formatted `exchange: string` or `venues: string` field from the
 * Activity adapter). Resolves the catalog code via the lookup map above and
 * delegates to <ExchangeLogo> for the actual render.
 *
 * Usage:
 *   <ExchangeChip venue="Binance" size="sm" />
 *   <ExchangeChip venue={trade.exchange} />
 *
 * The chip renders just the logo (or initial fallback) — the surrounding
 * markup keeps its own typography. This is deliberately a leaf so it can
 * slot into table cells, subtitles, and inline runs without disturbing the
 * existing copy.
 */
export function ExchangeChip({
  venue,
  code,
  displayName,
  size = "sm",
  className,
}: ChipProps) {
  const resolved = code ?? resolveExchangeCode(venue) ?? "";
  const logoUrl = resolved ? logoUrlFor(resolved) : null;
  return (
    <ExchangeLogo
      code={resolved || venue}
      displayName={displayName ?? venue}
      logoUrl={logoUrl}
      size={size}
      className={className}
    />
  );
}

/**
 * Helper for multi-venue strings like "Binance + Coinbase" or
 * "Bybit / OKX". Splits on `+` / `/` / `,` / `·` separators, resolves each
 * piece, and renders the logos as a tiny stack-row beside the original
 * text. Falls back to a single chip when only one venue is present, and
 * renders nothing when the input string has no recognisable venues
 * (callers should keep the textual label in their own markup either way).
 */
export function ExchangeVenuesChips({
  venues,
  size = "sm",
  className,
}: {
  venues: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const parts = venues
    .split(/\s*[+/,·]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center -space-x-1",
        className,
      )}
      aria-hidden
    >
      {parts.map((p, i) => (
        <ExchangeChip
          key={`${p}-${i}`}
          venue={p}
          size={size}
          className="ring-1 ring-surface"
        />
      ))}
    </span>
  );
}
