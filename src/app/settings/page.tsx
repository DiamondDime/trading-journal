import { redirect } from "next/navigation";

/**
 * /settings is purely a redirect to the first real section.
 * Keeps the URL clean while still letting links to /settings work.
 */
export default function SettingsIndexPage() {
  redirect("/settings/exchanges");
}
