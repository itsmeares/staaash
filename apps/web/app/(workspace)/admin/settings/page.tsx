import { PageHeader } from "@/components/page-header";
import { requireOwnerPageSession } from "@/server/auth/guards";
import { getUpdateState } from "@/server/admin/updates";
import { getSystemSettings } from "@/server/settings";

import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section } = await searchParams;
  await requireOwnerPageSession();
  const [settings, updateState] = await Promise.all([
    getSystemSettings(),
    getUpdateState(),
  ]);

  return (
    <div className="grid w-full content-start gap-6">
      <PageHeader title="Settings" />
      <SettingsForm
        section={section}
        settings={settings}
        updateState={updateState}
      />
    </div>
  );
}
