import { requireOwnerPageSession } from "@/server/auth/guards";
import { getSystemSettings } from "@/server/settings";

import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requireOwnerPageSession();
  const settings = await getSystemSettings();

  return (
    <main className="settings-page admin-settings-page">
      <section className="settings-page-head">
        <h1>Instance settings</h1>
        <p className="muted">
          Configure operational settings. Changes take effect immediately.
        </p>
      </section>
      <SettingsForm settings={settings} />
    </main>
  );
}
