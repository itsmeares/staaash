import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { WorkspacePresetPageContextMenu } from "@/src/dashboard-context-menu";
import { sharesQuery } from "@/src/queries";
import { SharedLinks } from "@/src/workspace/shared/shared-table";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

function SharedPage() {
  const { data: live } = useSuspenseQuery(sharesQuery("live"));
  const { data: off } = useSuspenseQuery(sharesQuery("off"));
  return (
    <WorkspacePresetPageContextMenu
      className="grid content-start gap-4 max-lg:min-w-0"
      preset="shared"
    >
      <SharedLinks livePage={live} offPage={off} />
    </WorkspacePresetPageContextMenu>
  );
}

export const Route = createFileRoute("/_workspace/shared")({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(sharesQuery("live")),
      queryClient.ensureQueryData(sharesQuery("off")),
    ]),
  pendingComponent: WorkspaceLoading,
  component: SharedPage,
});
