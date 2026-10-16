import { headers } from "next/headers";

import { WorkspacePresetPageContextMenu } from "@/app/dashboard-context-menu";
import { PageHeader } from "@/components/page-header";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { formatDateTime, formatTimeUntil } from "@/lib/time";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { getShareBaseUrl } from "@/server/request";
import { sharingService } from "@/server/sharing/service";
import { resolveDisplayTimeZone } from "@/server/time-zone";
import { SharedTable, type SharedTableItem } from "./shared-table";

export const dynamic = "force-dynamic";

const shareStatusLabel = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
  "target-unavailable": "Unavailable",
} as const;

function getExpiryTone(
  expiresAt: Date | string,
): SharedTableItem["expiryTone"] {
  const d = new Date(expiresAt);
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return "default";
  if (diffMs < 1000 * 60 * 60 * 24) return "critical";
  if (diffMs < 1000 * 60 * 60 * 24 * 7) return "warning";
  return "default";
}

export default async function SharedPage() {
  const [session, h] = await Promise.all([
    requireSignedInPageSession("/?next=/shared"),
    headers(),
  ]);
  const baseUrl = getShareBaseUrl(h);
  const shares = await sharingService.listOwnedShares({
    actorUserId: session.user.id,
    actorRole: session.user.role,
    baseUrl,
  });

  const allShares = [...shares.active, ...shares.inactive];
  const { timeZone: userTimeZone } = await resolveDisplayTimeZone(session.user);

  const tableItems: SharedTableItem[] = allShares.map((share) => ({
    share,
    canManage: share.status !== "target-unavailable",
    expiresLabel:
      share.status === "active"
        ? formatTimeUntil(share.expiresAt, new Date())
        : formatDateTime(share.expiresAt, userTimeZone),
    expiryTone:
      share.status === "active" ? getExpiryTone(share.expiresAt) : "default",
    statusLabel: shareStatusLabel[share.status],
  }));

  return (
    <WorkspacePresetPageContextMenu
      className="grid gap-5.5 max-lg:min-w-0"
      preset="shared"
    >
      <div className="grid gap-4">
        <PageHeader title="Shared" />

        {allShares.length === 0 ? (
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyTitle>Nothing shared yet</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <SharedTable items={tableItems} />
        )}
      </div>
    </WorkspacePresetPageContextMenu>
  );
}
