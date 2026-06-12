import { headers } from "next/headers";
import { KeyRound } from "lucide-react";

import {
  FlashMessage,
  formatDateTime,
  getSingleSearchParam,
} from "@/app/auth-ui";
import { WorkspacePresetPageContextMenu } from "@/app/dashboard-context-menu";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { getShareBaseUrl } from "@/server/request";
import { sharingService } from "@/server/sharing/service";
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
  const userTimeZone = session.user.preferences?.timeZone;

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
    <WorkspacePresetPageContextMenu className="workspace-page" preset="shared">
      <div className="stack">
        {/* Page header */}
        <div className="shared-header">
          <div className="shared-title-row">
            <h1>Shared</h1>
            {allShares.length > 0 && (
              <span className="section-count">{allShares.length}</span>
            )}
          </div>
        </div>

        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

        {/* Empty state */}
        {allShares.length === 0 ? (
          <div className="shared-empty-state">
            <span className="shared-empty-icon">
              <KeyRound size={22} aria-hidden />
            </span>
            <p>No shared links yet</p>
            <span>Create a link from any file or folder.</span>
          </div>
        ) : (
          <div className="sl-page">
            <SharedTable items={tableItems} />
          </div>
        )}
      </div>
    </WorkspacePresetPageContextMenu>
  );
}
