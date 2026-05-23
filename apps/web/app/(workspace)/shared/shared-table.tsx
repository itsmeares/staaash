"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { ShareDialog } from "@/app/(workspace)/files/share-dialog";
import type { ShareLinkSummary } from "@/server/sharing";

export type SharedTableItem = {
  share: ShareLinkSummary;
  canManage: boolean;
  expiresLabel: string;
  expiryTone: "critical" | "default" | "warning";
  statusLabel: string;
};

type SharedTableProps = {
  items: SharedTableItem[];
};

type SharedFilterType =
  | "all"
  | "archive"
  | "audio"
  | "folder"
  | "image"
  | "pdf"
  | "text"
  | "video";

const FILTERS: { id: SharedFilterType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "folder", label: "Folders" },
  { id: "image", label: "Images" },
  { id: "pdf", label: "PDFs" },
  { id: "video", label: "Videos" },
  { id: "audio", label: "Audio" },
  { id: "text", label: "Docs" },
  { id: "archive", label: "Archives" },
];

const getStatusClass = (status: ShareLinkSummary["status"]) => {
  if (status === "target-unavailable") return "unavailable";
  return status;
};

function getShareType(share: ShareLinkSummary): SharedFilterType {
  if (share.target.targetType === "folder") return "folder";

  const mime = share.target.mimeType ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("pdf")) return "pdf";
  if (
    mime.startsWith("text/") ||
    mime.includes("typescript") ||
    mime.includes("json") ||
    mime.includes("document")
  ) {
    return "text";
  }
  if (
    mime.includes("zip") ||
    mime.includes("archive") ||
    mime.includes("tar") ||
    mime.includes("gzip")
  ) {
    return "archive";
  }

  return "all";
}

function getShareTypeLabel(share: ShareLinkSummary): string {
  const type = getShareType(share);
  if (type === "all")
    return share.target.targetType === "file" ? "File" : "Folder";
  if (type === "pdf") return "PDF";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function splitPathLabel(pathLabel: string): string[] {
  return pathLabel
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function getShareLocationLabel(share: ShareLinkSummary): string {
  const parts = splitPathLabel(share.target.pathLabel);
  const pathWithoutSelf =
    parts.at(-1) === share.target.name ? parts.slice(0, -1) : parts;
  const withoutRoot =
    pathWithoutSelf.length > 1 ? pathWithoutSelf.slice(1) : [];
  return withoutRoot.length > 0 ? `/ ${withoutRoot.join(" / ")} /` : "/";
}

export function SharedTable({ items }: SharedTableProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filterType, setFilterType] = useState<SharedFilterType>("all");
  const [shareDialogTarget, setShareDialogTarget] = useState<{
    targetType: "file" | "folder";
    targetId: string;
    share: ShareLinkSummary;
  } | null>(null);
  const visibleItems = useMemo(() => {
    if (filterType === "all") return items;
    return items.filter(({ share }) => getShareType(share) === filterType);
  }, [filterType, items]);

  return (
    <>
      <div className="shared-toolbar" aria-label="Shared display controls">
        <label className="favorites-filter-control">
          <span>Type</span>
          <select
            value={filterType}
            onChange={(event) =>
              setFilterType(event.target.value as SharedFilterType)
            }
          >
            {FILTERS.map((filter) => (
              <option key={filter.id} value={filter.id}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
        <Link className="shared-new-link" href="/files">
          + New share link
        </Link>
      </div>

      {visibleItems.length === 0 ? (
        <div className="workspace-empty-state">
          <h2>No shared links match that filter</h2>
          <p className="muted">Try a different type.</p>
        </div>
      ) : (
        <div className="st-wrap">
          <table className="st-table">
            <colgroup>
              <col className="st-col-name" />
              <col className="st-col-location" />
              <col className="st-col-type" />
              <col className="st-col-expires" />
              <col className="st-col-status" />
              <col className="st-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th className="st-th" scope="col">
                  Name
                </th>
                <th className="st-th" scope="col">
                  Location
                </th>
                <th className="st-th" scope="col">
                  Type
                </th>
                <th className="st-th" scope="col">
                  Expires
                </th>
                <th className="st-th" scope="col">
                  Status
                </th>
                <th className="st-th" scope="col">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map(
                ({
                  share,
                  canManage,
                  expiresLabel,
                  expiryTone,
                  statusLabel,
                }) => {
                  const locationLabel = getShareLocationLabel(share);

                  return (
                    <tr
                      className={`st-tr${share.status === "active" ? "" : " st-tr--inactive"}`}
                      id={share.id}
                      key={share.id}
                    >
                      <td className="st-td st-name-cell">
                        <span className="st-name">
                          <span
                            className="st-name-text"
                            title={share.target.name}
                          >
                            {share.target.name}
                          </span>
                        </span>
                      </td>
                      <td className="st-td st-muted">
                        <span className="st-location" title={locationLabel}>
                          {locationLabel}
                        </span>
                      </td>
                      <td className="st-td st-muted">
                        {getShareTypeLabel(share)}
                      </td>
                      <td className={`st-td st-mono st-expires--${expiryTone}`}>
                        {expiresLabel}
                      </td>
                      <td className="st-td">
                        <span
                          className={`sl-badge sl-badge--${getStatusClass(share.status)}`}
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td className="st-td">
                        <div className="st-actions">
                          <button
                            className="st-action"
                            disabled={!canManage}
                            onClick={() =>
                              setShareDialogTarget({
                                targetType: share.target.targetType,
                                targetId: share.target.id,
                                share,
                              })
                            }
                            type="button"
                          >
                            Manage
                          </button>
                          <span
                            aria-hidden={!share.hasPassword}
                            className="st-password-hint"
                            title={
                              share.hasPassword
                                ? "Password protected"
                                : undefined
                            }
                          >
                            {share.hasPassword ? (
                              <KeyRound
                                aria-label="Password protected"
                                size={13}
                              />
                            ) : null}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      )}

      {shareDialogTarget ? (
        <ShareDialog
          targetType={shareDialogTarget.targetType}
          targetId={shareDialogTarget.targetId}
          initialShare={shareDialogTarget.share}
          onClose={() => {
            setShareDialogTarget(null);
            startTransition(() => router.refresh());
          }}
        />
      ) : null}
    </>
  );
}
