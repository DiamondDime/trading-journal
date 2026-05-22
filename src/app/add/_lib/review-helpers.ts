/**
 * Shared helpers for the activity-wizard `review/page.tsx` steps.
 *
 * Every wizard review page used to copy-paste the same `getStr` / `parseNum`
 * / `fmtUsd` / `fmtDate` quartet and the spread `MATCHER_TO_DB_TYPE` map. They
 * are consolidated here so a fix lands once instead of seven times.
 *
 * Money / quantity values are STRINGS end-to-end (CLAUDE.md "Decimals as
 * strings"). The `Number()` conversions below are display-only — they format
 * a value for the human, they never feed a DB write.
 */
import type { Locale } from "@/lib/i18n/types";
import type { SpreadType } from "@/types/canonical";

/** Resolved searchParams shape every wizard review page receives. */
export type WizardSearch = { [key: string]: string | string[] | undefined };

/**
 * Read a single string value from resolved searchParams. Arrays collapse to
 * their first string element (a value can appear twice when a GET form emits
 * a hidden + visible input of the same name).
 */
export function getStr(sp: WizardSearch, key: string, fallback = ""): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return fallback;
}

/** Read every string value for a repeated searchParams key (insertion order). */
export function getAllStr(sp: WizardSearch, key: string): string[] {
  const v = sp[key];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

/** Display-only string → number coerce. Non-finite input degrades to 0. */
export function parseNum(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Map a `Locale` to the BCP-47 tag `Intl` wants. */
export function intlLocale(locale: Locale): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

/**
 * Format a USD amount. `signed` prefixes an explicit + / − (the − is a real
 * minus sign, U+2212, to match the rest of the journal's typography).
 * `locale` threads the resolved locale so digit grouping follows the user's
 * language — pass it from the page's `getLocale()` call.
 */
export function fmtUsd(n: number, locale: Locale, signed = false): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toLocaleString(intlLocale(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = signed ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : "";
  return `${sign}$${abs}`;
}

/** Format an ISO datetime as a short `MMM d, yyyy · HH:mm` stamp. */
export function fmtDateTime(iso: string, locale: Locale): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(intlLocale(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format an ISO date as a short `MMM d, yyyy` stamp (no time component). */
export function fmtDate(iso: string, locale: Locale): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(intlLocale(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Matcher-token → DB `spread_type`. The wizard's type-step encodes a short
 * matcher token in the URL; the DB column wants the canonical enum value.
 * Single source of truth — `add/spread/actions.ts` and `review/page.tsx`
 * both import this.
 */
export const MATCHER_TO_DB_TYPE = {
  cash_carry: "cash_carry",
  funding: "funding_capture",
  cross_exchange: "cross_exchange_perp_arb",
  calendar: "calendar",
  dex_cex: "dex_cex_arb",
} as const satisfies Record<string, SpreadType>;

/** Matcher tokens the wizard's type step can emit. */
export type MatcherSpreadType = keyof typeof MATCHER_TO_DB_TYPE;

/** Type-guard: is `v` a known matcher token? */
export function isMatcherSpreadType(v: string): v is MatcherSpreadType {
  return Object.prototype.hasOwnProperty.call(MATCHER_TO_DB_TYPE, v);
}

const MAX_TAG_LEN = 60;
const MAX_TAGS = 40;

/**
 * Parse the free-form `tags` round-trip param.
 *
 * The wizard review step renders a {@link WizardTagInput} whose hidden input
 * serialises the chip set as a JSON array of strings. On a failed-submit
 * round-trip that JSON lands back in the `tags` query param. This parser
 * tolerates anything: malformed JSON, non-array payloads, non-string members
 * — all degrade to `[]`. Values are trimmed, empties dropped, > 60-char
 * entries dropped (matches the DB check constraint), de-duped
 * case-insensitively, and capped at 40 (matches `WizardTagInput`).
 *
 * Use it to compute `defaultTags` for the round-trip case. Edit-mode
 * pre-fill reads the activity's existing `activity_tag` rows instead.
 */
export function parseTagsParam(raw: string | undefined | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t || t.length > MAX_TAG_LEN) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Validate + normalise a `tags` payload on the server-action side.
 *
 * The wizard action reads `formData.get("tags")` — a JSON string. This helper
 * does the `JSON.parse` inside a try/catch (malformed → `[]`), keeps only
 * string members ≤ 60 chars, trims, drops empties, de-dupes
 * case-insensitively. The result is safe to hand straight to
 * `setTagsForActivity` (which re-normalises, but failing fast here keeps the
 * DB layer's input clean).
 */
export function parseTagsFormValue(raw: FormDataEntryValue | null | undefined): string[] {
  if (typeof raw !== "string") return [];
  return parseTagsParam(raw);
}
