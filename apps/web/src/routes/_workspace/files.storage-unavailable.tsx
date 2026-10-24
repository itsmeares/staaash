import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { storageUnavailableQuery } from "@/src/queries";
import { StorageUnavailableView } from "@/src/workspace/files/storage-unavailable-view";

export const Route = createFileRoute("/_workspace/files/storage-unavailable")({
  validateSearch: z.object({ folderId: z.string().optional() }),
  loaderDeps: ({ search }) => search,
  // Checks again on every visit and refresh; a ready folder opens by itself.
  loader: async ({ context, deps: { folderId } }) => {
    if (!folderId) throw redirect({ to: "/files" });
    const state = await context.queryClient.fetchQuery(
      storageUnavailableQuery(folderId),
    );
    if (state.available) {
      throw state.isFilesRoot
        ? redirect({ to: "/files" })
        : redirect({ to: "/files/f/$folderId", params: { folderId } });
    }
    return state;
  },
  component: () => (
    <StorageUnavailableView
      recoveryRequired={Route.useLoaderData().recoveryRequired}
    />
  ),
});
