'use client';

import * as React from 'react';
import type { Locale } from './types';
import type { MessageDict } from './messages/en';
import { makeT, type TFunction } from './resolve';

interface LocaleContextValue {
  locale: Locale;
  messages: MessageDict;
  t: TFunction;
}

const LocaleContext = React.createContext<LocaleContextValue | null>(null);

interface LocaleProviderProps {
  locale: Locale;
  messages: MessageDict;
  children: React.ReactNode;
}

export function LocaleProvider({ locale, messages, children }: LocaleProviderProps) {
  const value = React.useMemo<LocaleContextValue>(
    () => ({ locale, messages, t: makeT(locale, messages) }),
    [locale, messages],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocaleContext(): LocaleContextValue {
  const v = React.useContext(LocaleContext);
  if (!v) {
    throw new Error('useLocaleContext must be used inside <LocaleProvider>');
  }
  return v;
}
