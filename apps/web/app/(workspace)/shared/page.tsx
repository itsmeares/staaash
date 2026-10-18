import { headers } from "next/headers";

import { WorkspacePresetPageContextMenu } from "@/app/dashboard-context-menu";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { getShareBaseUrl } from "@/server/request";
import { getSharesPage } from "@/server/sharing/page";
import { SharedLinks } from "./shared-table";

export const dynamic = "force-dynamic";

export default async function SharedPage() {
  const [session, h] = await Promise.all([
    requireSignedInPageSession("/?next=/shared"),
    headers(),
  ]);
  const actor = { actorUserId: session.user.id, actorRole: session.user.role };
  const [live, off] = await Promise.all([
    getSharesPage(actor, getShareBaseUrl(h), true),
    getSharesPage(actor, getShareBaseUrl(h), false),
  ]);

  return (
    <WorkspacePresetPageContextMenu
      className="grid content-start gap-4 max-lg:min-w-0"
      preset="shared"
    >
      <SharedLinks livePage={live} offPage={off} />
    </WorkspacePresetPageContextMenu>
  );
}
