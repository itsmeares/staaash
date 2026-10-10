import { headers } from "next/headers";
import { FolderPlus } from "lucide-react";

import { WorkspacePresetPageContextMenu } from "@/app/dashboard-context-menu";
import { PageHeader } from "@/components/page-header";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { getShareBaseUrl } from "@/server/request";
import { retrievalService } from "@/server/retrieval/service";
import { sharingService } from "@/server/sharing/service";

import { toRecentClientItem } from "../recent/recent-helpers";
import { HomePrimaryActions } from "./home-actions";
import { HomeSections } from "./home-sections";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [session, h] = await Promise.all([
    requireSignedInPageSession("/?next=/home"),
    headers(),
  ]);
  const actor = { actorUserId: session.user.id, actorRole: session.user.role };
  const [favorites, recent, shares] = await Promise.all([
    retrievalService.listFavorites(actor),
    retrievalService.listRecent(actor),
    sharingService.listOwnedShares({ ...actor, baseUrl: getShareBaseUrl(h) }),
  ]);

  const recentItems = recent.map(toRecentClientItem);
  // Pinned first, then the newest favorites.
  const pinned = [...favorites]
    .sort(
      (left, right) =>
        (right.quickAccessPinnedAt?.getTime() ?? 0) -
          (left.quickAccessPinnedAt?.getTime() ?? 0) ||
        right.favoritedAt.getTime() - left.favoritedAt.getTime(),
    )
    .slice(0, 8)
    .map(toRecentClientItem);
  const isEmpty =
    favorites.length === 0 && recent.length === 0 && shares.active.length === 0;

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
            <EmptyMedia variant="icon">
              <FolderPlus aria-hidden />
            </EmptyMedia>
            <EmptyTitle>Add your first file</EmptyTitle>
            <EmptyDescription>
              Upload something now, or start with a folder.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <HomePrimaryActions className="justify-center" />
          </EmptyContent>
        </Empty>
      ) : (
        <HomeSections
          pickUp={recentItems
            .filter((item) => item.kind === "file")
            .slice(0, 4)}
          pinned={pinned}
          recent={recentItems.slice(0, 8)}
          shares={shares.active.slice(0, 5).map((share) => ({
            id: share.id,
            name: share.target.name,
            kind: share.target.targetType,
            mimeType:
              share.target.targetType === "file"
                ? share.target.mimeType
                : undefined,
            downloadDisabled: share.downloadDisabled,
            hasPassword: share.hasPassword,
            expiresAt: share.expiresAt.toISOString(),
          }))}
        />
      )}
    </WorkspacePresetPageContextMenu>
  );
}
