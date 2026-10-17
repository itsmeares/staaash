import { headers } from "next/headers";

import { WorkspacePresetPageContextMenu } from "@/app/dashboard-context-menu";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { getShareBaseUrl } from "@/server/request";
import { sharingService } from "@/server/sharing/service";
import { SharedLinks } from "./shared-table";

export const dynamic = "force-dynamic";

export default async function SharedPage() {
  const [session, h] = await Promise.all([
    requireSignedInPageSession("/?next=/shared"),
    headers(),
  ]);
  const shares = await sharingService.listOwnedShares({
    actorUserId: session.user.id,
    actorRole: session.user.role,
    baseUrl: getShareBaseUrl(h),
  });

  return (
    <WorkspacePresetPageContextMenu
      className="grid content-start gap-4 max-lg:min-w-0"
      preset="shared"
    >
      <SharedLinks shares={[...shares.active, ...shares.inactive]} />
    </WorkspacePresetPageContextMenu>
  );
}
