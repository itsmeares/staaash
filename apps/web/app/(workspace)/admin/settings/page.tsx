import { requireOwnerPageSession } from "@/server/auth/guards";
import {
  getAdminUpdateStatus,
  toJsonAdminUpdateStatus,
} from "@/server/admin/updates";
import { getSystemSettings } from "@/server/settings";

import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requireOwnerPageSession();
  const [settings, updateStatus] = await Promise.all([
    getSystemSettings(),
    getAdminUpdateStatus(),
  ]);

  return (
    <main className="mx-auto grid w-full max-w-settings content-start gap-4.5 p-0">
      <SettingsForm
        settings={settings}
        updateStatus={toJsonAdminUpdateStatus(updateStatus)}
      />
    </main>
  );
}
