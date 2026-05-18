import { sql } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { ProfileForm } from "./profile-form";

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

  // Defensive defaults — shouldn't fire in single-user mode (APP_USER_ID is
  // always set) but keep the UI rendering rather than crashing the layout.
  const email = user?.email ?? profile?.email ?? "—";
  const displayName = profile?.displayName ?? null;
  const timezone = profile?.timezone ?? "Etc/UTC";
  const baseCurrency = profile?.baseCurrency ?? "USD";

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-serif text-[24px] font-medium leading-tight text-text">
          {t("settings.profile.editTitle")}
        </h2>
        <p className="mt-1 font-serif text-[13px] italic text-text-secondary">
          {t("settings.profile.editSubtitle")}
        </p>
      </div>

      <ProfileForm
        initialDisplayName={displayName}
        initialTimezone={timezone}
        initialBaseCurrency={baseCurrency}
        email={email}
      />

      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        {t("settings.profile.footer")}
      </p>
    </div>
  );
}
