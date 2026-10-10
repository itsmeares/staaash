import { PageHeader } from "@/components/page-header";
import { requireOwnerPageSession } from "@/server/auth/guards";
import { getUpdateState } from "@/server/admin/updates";
import { getSystemSettings } from "@/server/settings";

import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requireOwnerPageSession();
  const [settings, updateState] = await Promise.all([
    getSystemSettings(),
    getUpdateState(),
  ]);

  return (
    <div className="grid w-full max-w-settings content-start gap-6">
      <PageHeader title="Settings" description="For everyone on this drive." />
      <SettingsForm settings={settings} updateState={updateState} />
    </div>
  );
}
