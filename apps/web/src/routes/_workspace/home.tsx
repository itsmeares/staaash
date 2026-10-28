import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { WorkspacePresetPageContextMenu } from "@/src/dashboard-context-menu";
import { homeQuery } from "@/src/queries";
import { HomePrimaryActions } from "@/src/workspace/home/home-actions";
import { HomeSections } from "@/src/workspace/home/home-sections";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@staaash/ui/components/empty";

function HomePage() {
  const { data } = useSuspenseQuery(homeQuery);
  const isEmpty =
    !data.hasFavorites && data.recent.length === 0 && data.shares.length === 0;

  return (
    <WorkspacePresetPageContextMenu
      className="grid w-full content-start gap-6"
      preset="home"
    >
      <PageHeader
        actions={isEmpty ? null : <HomePrimaryActions />}
        title="Home"
      />

      {isEmpty ? (
        <Empty className="min-h-[min(52vh,520px)]">
          <EmptyHeader>
            <EmptyTitle>Add your first file</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <HomePrimaryActions className="justify-center" />
          </EmptyContent>
        </Empty>
      ) : (
        <HomeSections
          pickUp={data.pickUp}
          pinned={data.pinned}
          recent={data.recent}
          shares={data.shares}
        />
      )}
    </WorkspacePresetPageContextMenu>
  );
}

export const Route = createFileRoute("/_workspace/home")({
  loader: ({ context }) => context.queryClient.ensureQueryData(homeQuery),
  pendingComponent: WorkspaceLoading,
  component: HomePage,
});
