import Link from "next/link";
import { headers } from "next/headers";

import {
  FlashMessage,
  formatDateTime,
  getSingleSearchParam,
} from "@/app/auth-ui";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { getBaseUrl } from "@/server/request";
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
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "expired";
  if (diffDays === 1) return "1 day";
  if (diffDays < 7) return `${diffDays} days`;
  if (diffDays < 60)
    return `${Math.ceil(diffDays / 7)} week${Math.ceil(diffDays / 7) === 1 ? "" : "s"}`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months`;
  return `${Math.floor(diffDays / 365)}y`;
}

function isExpiringSoon(expiresAt: Date | string): boolean {
  const d = new Date(expiresAt);
  const diffMs = d.getTime() - Date.now();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return diffDays > 0 && diffDays < 7;
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
  const baseUrl = getBaseUrl(h);
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");
  const shares = await sharingService.listOwnedShares({
    actorUserId: session.user.id,
    actorRole: session.user.role,
    baseUrl,
  });

  const allShares = [...shares.active, ...shares.inactive];

  const tableItems: SharedTableItem[] = allShares.map((share) => ({
    share,
    canManage: share.status !== "target-unavailable",
    expiresLabel:
      share.status === "active"
        ? getRelativeExpiry(share.expiresAt)
        : formatDateTime(share.expiresAt),
    isExpiringSoon:
      share.status === "active" && isExpiringSoon(share.expiresAt),
    statusLabel: shareStatusLabel[share.status],
  }));

  return (
    <div className="workspace-page">
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
          <div className="workspace-empty-state">
            <h2>No public links yet</h2>
            <p className="muted">
              Create the first link from files on a file or folder.
            </p>
            <Link className="pill" href="/files">
              Open files
            </Link>
          </div>
        ) : (
          <div className="sl-page">
            <SharedTable items={tableItems} />
          </div>
        )}
      </div>
    </div>
  );
}
