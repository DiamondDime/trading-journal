import { sql } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/server";

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
  const user = await getCurrentUser();
  const profile = user ? await loadProfile(user.id) : null;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-serif text-[24px] font-medium leading-tight text-text">
          Profile
        </h2>
        <p className="mt-1 font-serif text-[13px] italic text-text-secondary">
          The single-user identity attached to this journal. Editable UI lands
          in a later release; values are sourced from your local Postgres
          today.
        </p>
      </div>

      <dl className="grid grid-cols-1 divide-y divide-border rounded-md border border-border bg-surface text-[13px]">
        <FieldRow
          label="Display name"
          value={profile?.displayName ?? "—"}
        />
        <FieldRow label="Email" value={user?.email ?? profile?.email ?? "—"} />
        <FieldRow label="Timezone" value={profile?.timezone ?? "—"} />
        <FieldRow
          label="Base currency"
          value={profile?.baseCurrency ?? "—"}
        />
      </dl>

      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
        Read-only · v1
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
