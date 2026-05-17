import { sql } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

interface ProfileRow {
  id: string;
  email: string;
  displayName: string | null;
  timezone: string;
  baseCurrency: string;
}

async function loadProfile(userId: string): Promise<ProfileRow | null> {
  const rows = await sql<ProfileRow[]>`
    SELECT id, email, display_name, timezone, base_currency
    FROM public.profiles
    WHERE id = ${userId}::uuid
  `;
  return rows[0] ?? null;
}

export default async function ProfileSettingsPage() {
  const t = await getT();
  const user = await getCurrentUser();
  const profile = user ? await loadProfile(user.id) : null;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-serif text-[24px] font-medium leading-tight text-text">
          {t("common.profile")}
        </h2>
        <p className="mt-1 font-serif text-[13px] italic text-text-secondary">
          {t("settings.profile.subtitle")}
        </p>
      </div>

      <dl className="grid grid-cols-1 divide-y divide-border rounded-md border border-border bg-surface text-[13px]">
        <FieldRow
          label={t("settings.profile.displayName")}
          value={profile?.displayName ?? "—"}
        />
        <FieldRow
          label={t("settings.profile.email")}
          value={user?.email ?? profile?.email ?? "—"}
        />
        <FieldRow
          label={t("settings.profile.timezone")}
          value={profile?.timezone ?? "—"}
        />
        <FieldRow
          label={t("settings.profile.baseCurrency")}
          value={profile?.baseCurrency ?? "—"}
        />
      </dl>

      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        {t("settings.profile.footer")}
      </p>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3.5">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        {label}
      </dt>
      <dd className="font-mono text-[12px] text-text">{value}</dd>
    </div>
  );
}
