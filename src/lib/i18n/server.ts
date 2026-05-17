/**
 * Server-side i18n entrypoint. Server Components and Route Handlers call
 * `await getLocale()` and `await getT()` to resolve the active locale
 * from the `csj-locale` cookie. The `setLocale` Server Action below is
 * imported by the LocaleSwitcher client component.
 */

import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from './types';
import { en } from './messages/en';
import { ru } from './messages/ru';
import { makeT } from './resolve';

function coerce(value: string | undefined): Locale {
  return value === 'ru' || value === 'en' ? value : DEFAULT_LOCALE;
}

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return coerce(store.get(LOCALE_COOKIE)?.value);
}

export async function getMessages(locale?: Locale) {
  const l = locale ?? (await getLocale());
  return l === 'ru' ? ru : en;
}

export async function getT() {
  const locale = await getLocale();
  const messages = locale === 'ru' ? ru : en;
  return makeT(locale, messages);
}
