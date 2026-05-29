import { getSingleSearchParam } from "@/app/auth-ui";
import { WorkspacePresetPageContextMenu } from "@/app/dashboard-context-menu";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { filesService } from "@/server/files/service";

import { toTrashClientItems } from "./trash-helpers";
import { TrashView } from "./trash-view";

export const dynamic = "force-dynamic";

type TrashPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TrashPage({ searchParams }: TrashPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/?next=/trash"),
  ]);
  const listing = await filesService.listTrashFolders({
    actorUserId: session.user.id,
    actorRole: session.user.role,
  });
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");

  const totalCount = listing.items.length + listing.files.length;
  const isEmpty = totalCount === 0;
  const items = toTrashClientItems(listing);

  return (
    <WorkspacePresetPageContextMenu
      className="workspace-page recent-page trash-page"
      isTrashEmpty={isEmpty}
      preset="trash"
    >
      <TrashView error={error} items={items} success={success} />
    </WorkspacePresetPageContextMenu>
  );
}
