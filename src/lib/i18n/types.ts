/**
 * Locale system — typed dictionary, no i18n library.
 *
 * Why roll our own: single-user self-hosted journal, no SEO concerns, no
 * locale routing, no plural-form edge cases beyond what Intl.PluralRules
 * already gives us. next-intl would add middleware + URL-prefix routing
 * we don't need.
 *
 * The English dictionary in messages/en.ts is the structural source of
 * truth — `ru.ts` must match the shape exactly. TypeScript enforces this
 * via `MessageDict = typeof en`.
 */

export type Locale = 'en' | 'ru';

export const LOCALES: readonly Locale[] = ['en', 'ru'] as const;
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'csj-locale';

export type PluralBucket = 'one' | 'few' | 'many' | 'other';

/**
 * Plural-aware leaf — Russian has 3 forms, English has 2. Always include
 * `one` + `other`; `few`/`many` are optional (Russian-only forms).
 */
export type PluralLeaf = {
  one: string;
  few?: string;
  many?: string;
  other: string;
};
