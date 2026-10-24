import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { recentQuery, shellQuery } from "@/src/queries";
import { RecentView } from "@/src/workspace/recent/recent-view";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

/** Activity (what you did) by default; `?show=added` lists everything added. */
const queryFor = (show: "activity" | "added", defaultView?: string) =>
  recentQuery(show, show === "activity" && defaultView !== "grid");

function RecentPage() {
  const { show } = Route.useSearch();
  const { data: shell } = useSuspenseQuery(shellQuery);
  const { data } = useSuspenseQuery(queryFor(show, shell.person.defaultView));
  return <RecentView items={data.items} total={data.total} show={show} />;
}

export const Route = createFileRoute("/_workspace/recent")({
  validateSearch: z.object({
    show: z.enum(["activity", "added"]).catch("activity").default("activity"),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, deps: { show } }) => {
    const shell = await queryClient.ensureQueryData(shellQuery);
    await queryClient.ensureQueryData(queryFor(show, shell.person.defaultView));
  },
  pendingComponent: WorkspaceLoading,
  component: RecentPage,
});
