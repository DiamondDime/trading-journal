'use client';

import * as React from 'react';
import { useTransition } from 'react';
import { cn } from '@/lib/utils';
import { setLocaleAction } from '@/lib/i18n/actions';
import { useLocale, useT } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/types';

/**
 * EN | РУ toggle. Lives in the sidebar footer next to the theme toggle.
 *
 * The Server Action revalidates the layout so every Server Component
 * re-renders with the new dictionary, while this client component
 * updates locally on click for instant feedback during the transition.
 */
export function LocaleSwitcher() {
  const t = useT();
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = React.useState<Locale | null>(null);

  const active = optimistic ?? locale;

  const set = (next: Locale) => {
    if (next === active) return;
    setOptimistic(next);
    startTransition(async () => {
      try {
        await setLocaleAction(next);
      } finally {
        // Always clear optimistic so a rejected server action doesn't pin
        // the UI on a state the server never accepted.
        setOptimistic(null);
      }
    });
  };

  return (
    <div
      role="group"
      aria-label={t("common.language")}
      className={cn(
        'inline-flex items-center rounded-md border border-border bg-inset text-[10px] font-mono leading-none overflow-hidden',
        isPending && 'opacity-70',
      )}
    >
      <Btn active={active === 'en'} onClick={() => set('en')} label="EN" />
      <span className="w-px self-stretch bg-border" aria-hidden />
      <Btn active={active === 'ru'} onClick={() => set('ru')} label="РУ" />
    </div>
  );
}

function Btn({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'px-1.5 py-1 transition-colors',
        active
          ? 'bg-subtle text-text font-semibold'
          : 'text-text-tertiary hover:text-text',
      )}
    >
      {label}
    </button>
  );
}
