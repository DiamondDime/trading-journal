import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WizardRadioCardLinkProps {
  /** Card title — serif, medium weight. */
  title: string;
  /** Short prose under the title. */
  description: string;
  /** Small mono caption above the title (e.g. "Mode" or "Type"). */
  caption?: string;
  /** Optional right-aligned mono badge (e.g. "AUTO" / "MANUAL"). */
  badge?: string;
  /** Navigates to this href on click. */
  href: string;
}

/**
 * Large editorial radio-card option, rendered as a link. Used for branch
 * points where each option has its own destination route (Spread/Trade/
 * Sale/Airdrop on /add, "From exchange / Manual" on /add/trade/source).
 *
 * Same visual treatment as a true radio card but cheaper — no JS state, no
 * hidden inputs. Server component.
 */
export function WizardRadioCardLink({
  title,
  description,
  caption,
  badge,
  href,
}: WizardRadioCardLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col gap-3 rounded-md border border-border bg-surface p-6 transition-all",
        "hover:border-border-strong hover:bg-subtle"
      )}
    >
      <div className="flex items-start justify-between">
        {caption ? (
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-tertiary">
            {caption}
          </p>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {badge && (
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
              {badge}
            </span>
          )}
          <ArrowUpRight className="h-3.5 w-3.5 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>
      <h2 className="font-serif text-[22px] font-medium leading-tight text-text">
        {title}
      </h2>
      <p className="font-serif text-[14px] italic leading-snug text-text-secondary">
        {description}
      </p>
    </Link>
  );
}

export interface WizardRadioCardInputProps {
  /** name= of the underlying radio input. */
  name: string;
  /** value= of the underlying radio input. */
  value: string;
  /** Card title. */
  title: string;
  /** Short prose under the title. */
  description: string;
  /** Default-selected when true. */
  defaultChecked?: boolean;
  /** Required (HTML constraint). */
  required?: boolean;
}

/**
 * Form-field variant of the radio card — wraps a real <input type="radio">
 * inside a styled <label>. Use when the choice should be part of a FormData
 * submission rather than triggering navigation. Selection state is driven
 * by the :has() variant against the hidden input.
 */
export function WizardRadioCardInput({
  name,
  value,
  title,
  description,
  defaultChecked,
  required,
}: WizardRadioCardInputProps) {
  return (
    <label
      className={cn(
        "group flex cursor-pointer flex-col gap-2 rounded-md border border-border bg-surface p-5 transition-all",
        "hover:border-border-strong hover:bg-subtle",
        "has-[input:checked]:border-text has-[input:checked]:bg-subtle"
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        required={required}
        className="sr-only"
      />
      <h3 className="font-serif text-[16px] font-medium leading-tight text-text">
        {title}
      </h3>
      <p className="font-serif text-[13px] italic text-text-secondary">
        {description}
      </p>
    </label>
  );
}
