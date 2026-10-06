import { headers } from "next/headers";
import { Share2 } from "lucide-react";

import { FlashMessage, getSingleSearchParam } from "@/app/auth-ui";
import { WorkspacePresetPageContextMenu } from "@/app/dashboard-context-menu";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/time";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { getShareBaseUrl } from "@/server/request";
import { sharingService } from "@/server/sharing/service";
import { resolveDisplayTimeZone } from "@/server/time-zone";
import { CollectionEmpty } from "../collection-parts";
import { SharedTable, type SharedTableItem } from "./shared-table";

export const dynamic = "force-dynamic";

const shareStatusLabel = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
  "target-unavailable": "Unavailable",
} as const;

function getRelativeExpiry(expiresAt: Date | string): string {
  const d = new Date(expiresAt);
  const diffMs = d.getTime() - Date.now();
  const diffSeconds = Math.ceil(diffMs / 1000);
  if (diffSeconds <= 0) return "expired";
  if (diffSeconds < 60)
    return `${diffSeconds} second${diffSeconds === 1 ? "" : "s"}`;

  const diffMinutes = Math.ceil(diffSeconds / 60);
  if (diffMinutes < 60)
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"}`;

  const diffHours = Math.ceil(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"}`;

  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 1) return "1 day";
  if (diffDays < 7) return `${diffDays} days`;
  if (diffDays < 60)
    return `${Math.ceil(diffDays / 7)} week${Math.ceil(diffDays / 7) === 1 ? "" : "s"}`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months`;
  return `${Math.floor(diffDays / 365)}y`;
}

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

type SharedPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SharedPage({ searchParams }: SharedPageProps) {
  const [resolvedSearchParams, session, h] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/?next=/shared"),
    headers(),
  ]);
  const baseUrl = getShareBaseUrl(h);
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");
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
        ? getRelativeExpiry(share.expiresAt)
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
        <PageHeader
          meta={allShares.length > 0 ? <Badge>{allShares.length}</Badge> : null}
          title="Shared"
        />

        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

        {allShares.length === 0 ? (
          <CollectionEmpty
            description="Create a link from any file or folder."
            icon={<Share2 aria-hidden />}
            title="No shared links yet"
          />
        ) : (
          <div className="grid gap-4 max-lg:min-w-0">
            <SharedTable items={tableItems} />
          </div>
        )}
      </div>
    </WorkspacePresetPageContextMenu>
  );
}
