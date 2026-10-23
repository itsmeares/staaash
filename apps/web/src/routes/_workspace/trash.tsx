import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { WorkspacePresetPageContextMenu } from "@/src/dashboard-context-menu";
import { trashQuery } from "@/src/queries";
import { TrashView } from "@/src/workspace/trash/trash-view";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

function TrashPage() {
  const { data } = useSuspenseQuery(trashQuery);
  return (
    <WorkspacePresetPageContextMenu
      className="flex min-h-0 flex-col gap-4.5 max-lg:min-w-0"
      isTrashEmpty={data.total === 0}
      preset="trash"
    >
      <TrashView
        items={data.items}
        retentionDays={data.retentionDays}
        total={data.total}
      />
    </WorkspacePresetPageContextMenu>
  );
}

export const Route = createFileRoute("/_workspace/trash")({
  loader: ({ context }) => context.queryClient.ensureQueryData(trashQuery),
  pendingComponent: WorkspaceLoading,
  component: TrashPage,
});
