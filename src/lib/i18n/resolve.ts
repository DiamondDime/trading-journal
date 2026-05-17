import type { Locale, PluralLeaf } from './types';
import type { MessageDict } from './messages/en';

/**
 * Pure resolver — given a dictionary, a dotted-path key and optional
 * params, returns the resolved string. Shared by server-side `getT()`
 * and client-side `useT()` so both paths produce identical output.
 *
 * Keys must exist in the dictionary; missing keys return the key itself
 * as a debug-friendly fallback (rather than throwing, which would break
 * Server Component renders).
 */

type DottedPaths<T, Prefix extends string = ''> = {
  [K in keyof T]: K extends string
    ? T[K] extends PluralLeaf
      ? `${Prefix}${K}`
      : T[K] extends object
        ? DottedPaths<T[K], `${Prefix}${K}.`>
        : `${Prefix}${K}`
    : never;
}[keyof T];

export type MessageKey = DottedPaths<MessageDict>;

type Params = Record<string, string | number>;

function substitute(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name) => {
    const v = params[name];
    return v === undefined ? `{${name}}` : String(v);
  });
}

function getAt(messages: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = messages;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function isPluralLeaf(v: unknown): v is PluralLeaf {
  return (
    !!v &&
    typeof v === 'object' &&
    'one' in (v as object) &&
    'other' in (v as object) &&
    typeof (v as PluralLeaf).one === 'string' &&
    typeof (v as PluralLeaf).other === 'string'
  );
}

/**
 * Returns a `t` function bound to the given locale/messages. Supports:
 *   t('common.save')                    → simple lookup
 *   t('settings.exchanges.dialog.title', { exchange: 'Binance' })
 *   t.plural('plurals.trades', n)       → Intl.PluralRules-aware
 */
export function makeT(locale: Locale, messages: MessageDict) {
  const pluralRules = new Intl.PluralRules(locale === 'ru' ? 'ru-RU' : 'en-US');

  function t(key: MessageKey, params?: Params): string {
    const value = getAt(messages, key);
    if (typeof value === 'string') return substitute(value, params);
    return key;
  }

  t.plural = (key: MessageKey, count: number, params?: Params): string => {
    const value = getAt(messages, key);
    if (!isPluralLeaf(value)) return `${key}.${count}`;
    const bucket = pluralRules.select(count);
    const template =
      (value as PluralLeaf)[bucket as keyof PluralLeaf] ?? value.other;
    return substitute(template, { count, ...(params ?? {}) });
  };

  t.locale = locale;
  t.messages = messages;

  return t;
}

export type TFunction = ReturnType<typeof makeT>;
