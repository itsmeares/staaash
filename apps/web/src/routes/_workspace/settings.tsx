import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { settingsQuery } from "@/src/queries";
import { PersonalSettings } from "@/src/workspace/settings/preferences-form";
import { WorkspacePage } from "@/src/workspace/workspace-page";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

function SettingsPage() {
  const { data } = useSuspenseQuery(settingsQuery);
  return (
    <WorkspacePage className="w-full content-start gap-6">
      <PageHeader title="Settings" />
      <PersonalSettings
        isOwner={data.isOwner}
        prefs={data.prefs}
        profile={data.profile}
        sessions={data.sessions}
        storage={data.storage}
      />
    </WorkspacePage>
  );
}

export const Route = createFileRoute("/_workspace/settings")({
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery),
  pendingComponent: WorkspaceLoading,
  component: SettingsPage,
});
