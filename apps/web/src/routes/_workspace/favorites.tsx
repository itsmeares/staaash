import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { favoritesQuery } from "@/src/queries";
import { FavoritesView } from "@/src/workspace/favorites/favorites-view";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

function FavoritesPage() {
  const { data } = useSuspenseQuery(favoritesQuery);
  return <FavoritesView items={data.items} total={data.total} />;
}

export const Route = createFileRoute("/_workspace/favorites")({
  loader: ({ context }) => context.queryClient.ensureQueryData(favoritesQuery),
  pendingComponent: WorkspaceLoading,
  component: FavoritesPage,
});
