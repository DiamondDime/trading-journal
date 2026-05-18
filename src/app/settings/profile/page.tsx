import { sql } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

interface ProfileRow {
  id: string;
  displayName: string | null;
  timezone: string;
}

async function loadProfile(userId: string): Promise<ProfileRow | null> {
  const rows = await sql<ProfileRow[]>`
    SELECT id, display_name, timezone
    FROM public.profiles
    WHERE id = ${userId}::uuid
  `;
  return rows[0] ?? null;
}

export default async function ProfileSettingsPage() {
  const t = await getT();
  const { id: userId } = await requireUser();
  const profile = await loadProfile(userId);

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
        initialDisplayName={profile?.displayName ?? null}
        initialTimezone={profile?.timezone ?? "Etc/UTC"}
      />

      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        {t("settings.profile.footer")}
      </p>
    </div>
  );
}
