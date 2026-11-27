import { useSuspenseQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/page-header";
import { adminSettingsQuery } from "@/src/queries";

import { AdminPage } from "../admin-panel";
import { SettingsForm } from "./settings-form";

export function AdminSettingsPage({ section }: { section?: string }) {
  const { settings, updateState, textReading } =
    useSuspenseQuery(adminSettingsQuery).data;
  return (
    <AdminPage>
      <PageHeader title="Settings" />
      <SettingsForm
        section={section}
        settings={settings}
        textReading={textReading}
        updateState={updateState}
      />
    </AdminPage>
  );
}
