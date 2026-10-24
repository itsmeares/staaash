import { useSuspenseQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/page-header";
import { adminSettingsQuery } from "@/src/queries";

import { SettingsForm } from "./settings-form";

export function AdminSettingsPage({ section }: { section?: string }) {
  const { settings, updateState } = useSuspenseQuery(adminSettingsQuery).data;
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
