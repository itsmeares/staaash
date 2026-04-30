import { requireOwnerPageSession } from "@/server/auth/guards";
import { getSystemSettings } from "@/server/settings";

import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requireOwnerPageSession();
  const settings = await getSystemSettings();

  return (
    <main className="stack" style={{ gap: "40px" }}>
      <section>
        <h1 style={{ marginBottom: "8px" }}>Instance settings</h1>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          Configure operational settings. Changes take effect immediately.
        </p>
      </section>
      <SettingsForm settings={settings} />
    </main>
  );
}
