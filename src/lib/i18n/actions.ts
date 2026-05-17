'use server';

/**
 * Server Action for switching locale. Writes the `csj-locale` cookie and
 * revalidates the entire app tree so Server Components re-render with
 * the new dictionary.
 */

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { LOCALE_COOKIE, type Locale } from './types';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function setLocaleAction(locale: Locale): Promise<void> {
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    maxAge: ONE_YEAR_SECONDS,
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
  });
  revalidatePath('/', 'layout');
}
