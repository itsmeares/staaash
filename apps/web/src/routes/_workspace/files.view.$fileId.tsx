import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { ApiError } from "@/lib/api";
import { viewerQuery } from "@/src/queries";
import { StandaloneViewer } from "@/src/workspace/files/standalone-viewer";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

function ViewerPage() {
  const { fileId } = Route.useParams();
  const { data } = useSuspenseQuery(viewerQuery(fileId));
  return <StandaloneViewer {...data} />;
}

export const Route = createFileRoute("/_workspace/files/view/$fileId")({
  loader: async ({ context, params: { fileId } }) => {
    try {
      await context.queryClient.ensureQueryData(viewerQuery(fileId));
    } catch (error) {
      // Missing, someone else's, or not viewable all read as not found.
      if (error instanceof ApiError && error.status < 500) throw notFound();
      throw error;
    }
  },
  pendingComponent: WorkspaceLoading,
  component: ViewerPage,
});
