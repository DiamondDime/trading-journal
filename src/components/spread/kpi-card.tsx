import { cn } from "@/lib/utils";

type KpiCardProps = {
  label: string;
  value: string;
  delta?: string;
  /** "hero" variant uses serif + signature amber. Use it exactly ONCE per screen. */
  variant?: "default" | "hero";
  /** Sign-color the value: "up" green, "down" red, default text color. */
  tone?: "up" | "down" | "neutral";
};

export function KpiCard({
  label,
  value,
  delta,
  variant = "default",
  tone = "neutral",
}: KpiCardProps) {
  const isHero = variant === "hero";

  const toneClass =
    tone === "up"
      ? "text-up"
      : tone === "down"
      ? "text-down"
      : isHero
      ? "text-signature"
      : "text-text";

  return (
    <div className="rounded-md border border-border bg-surface px-5 py-4 transition-colors hover:border-border-strong">
      <p className="font-serif text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
        {label}
      </p>
      <p
        className={cn(
          "mt-2 tabular-nums leading-none",
          isHero
            ? "font-serif text-[34px] font-normal"
            : "font-mono text-[26px] font-medium",
          toneClass
        )}
      >
        {value}
      </p>
      {delta && (
        <p className="mt-2 font-mono text-[11px] tracking-wide text-text-tertiary">
          {delta}
        </p>
      )}
    </div>
  );
}
