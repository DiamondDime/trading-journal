'use client';

import { useLocaleContext } from './context';

export function useT() {
  return useLocaleContext().t;
}

export function useLocale() {
  return useLocaleContext().locale;
}
