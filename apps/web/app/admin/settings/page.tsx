import { requireOwnerPageSession } from "@/server/auth/guards";
import { getSystemSettings } from "@/server/settings";

import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requireOwnerPageSession();
  const settings = await getSystemSettings();

  return (
    <main className="settings-page admin-settings-page">
      <SettingsForm settings={settings} />
    </main>
  );
}
