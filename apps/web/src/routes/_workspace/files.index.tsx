import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { filesQuery } from "@/src/queries";
import { FilesView } from "@/src/workspace/files/files-view";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

function FilesPage() {
  const { data } = useSuspenseQuery(filesQuery());
  return <FilesView {...data} currentPath="/files" />;
}

export const Route = createFileRoute("/_workspace/files/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(filesQuery()),
  pendingComponent: WorkspaceLoading,
  component: FilesPage,
});
