"use client";

import { useEffect, useRef, useState } from "react";
import {
  Folder,
  Star,
  Heart,
  Lock,
  Code,
  Briefcase,
  Download,
  FolderOpen,
  Share2,
  type LucideIcon,
} from "lucide-react";

import { getItemVisual } from "@/app/item-visuals";
import { ItemTypeIcon } from "@/app/item-type-icon";
import { DashboardItemContextMenu } from "@/app/dashboard-context-menu";
import { formatDateTime } from "@/app/auth-ui";
import type { FileSummary, FolderSummary } from "@/server/files/types";
import type { ShareLinkSummary } from "@/server/sharing";
import { FOLDER_ICON_MAP } from "./files-properties-panel";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MoveTarget = { id: string; pathLabel: string };

type RowShareProps = {
  share: ShareLinkSummary | null;
  targetId: string;
  targetType: "file" | "folder";
  currentPath: string;
  onShare: () => void;
};

type BaseFolderRowProps = {
  kind: "folder";
  data: FolderSummary;
  isSelected: boolean;
  selectedCount: number;
  isCut: boolean;
  isJustMoved: boolean;
  isRenaming: boolean;
  renameValue: string;
  isFavorite: boolean;
  folderIconName: string;
  availableMoveTargets: MoveTarget[];
  shareProps: RowShareProps;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onClick: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onStartRename: () => void;
  onFavorite: () => void;
  onTrash: () => void;
  onProperties: () => void;
  onCut: () => void;
  onMoveTo: (destinationId: string) => void;
  onDownload: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
};

type BaseFileRowProps = {
  kind: "file";
  data: FileSummary;
  isSelected: boolean;
  selectedCount: number;
  isCut: boolean;
  isJustMoved: boolean;
  isRenaming: boolean;
  renameValue: string;
  isFavorite: boolean;
  availableMoveTargets: MoveTarget[];
  shareProps: RowShareProps;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onClick: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onStartRename: () => void;
  onFavorite: () => void;
  onTrash: () => void;
  onProperties: () => void;
  onCut: () => void;
  onMoveTo: (destinationId: string) => void;
  onDownload: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
};

type FilesRowProps = BaseFolderRowProps | BaseFileRowProps;

// ---------------------------------------------------------------------------

export function FilesRow(props: FilesRowProps) {
  const {
    isSelected,
    selectedCount,
    isCut,
    isJustMoved,
    isRenaming,
    renameValue,
    isFavorite,
    availableMoveTargets,
    shareProps,
    onRenameChange,
    onRenameSubmit,
    onRenameCancel,
    onClick,
    onOpen,
    onStartRename,
    onFavorite,
    onTrash,
    onProperties,
    onCut,
    onMoveTo,
    rowRef,
  } = props;

  const isMultiSelected = isSelected && selectedCount > 1;

  const onDownload = props.onDownload;

  const renameInputRef = useRef<HTMLInputElement>(null);

  const rowClasses = [
    "explorer-row",
    isSelected ? "is-selected" : "",
    isCut ? "is-cut" : "",
    isJustMoved ? "just-moved" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // ---- Icon ----
  let IconComponent: LucideIcon | undefined;
  const visual = getItemVisual(
    props.kind,
    props.kind === "file" ? props.data.mimeType : null,
  );

  if (props.kind === "folder") {
    const customIcon =
      FOLDER_ICON_MAP[props.folderIconName ?? "Folder"] ?? Folder;
    IconComponent = isSelected ? FolderOpen : customIcon;
  } else {
    IconComponent = undefined;
  }

  // ---- Name ----
  const name = props.data.name;

  // ---- Meta ----
  // Format on the client only — server's timezone diverges from the browser's
  // so a render-time `Intl.DateTimeFormat` call mismatches at hydration
  // (React #418). Empty on first paint, populated on mount.
  const updatedAt = props.data.updatedAt;
  const [date, setDate] = useState("");
  useEffect(() => {
    setDate(formatDateTime(updatedAt));
  }, [updatedAt]);
  const size = props.kind === "file" ? formatBytes(props.data.sizeBytes) : "";

  // ---- Href ----
  const href =
    props.kind === "folder"
      ? props.data.isFilesRoot
        ? "/files"
        : `/files/f/${props.data.id}`
      : props.data.viewerKind
        ? `/files/view/${props.data.id}`
        : `/api/files/view/${props.data.id}/download`;

  // ---- Share display ----
  const shareLabel = shareProps.share
    ? shareProps.share.status === "active"
      ? "Shared"
      : "Link inactive"
    : null;

  return (
    <DashboardItemContextMenu
      groups={[
        {
          actions: [
            {
              label:
                props.kind === "folder"
                  ? "Open"
                  : props.data.viewerKind
                    ? "Open"
                    : "Download",
              shortcut: "↵",
              onSelect: onOpen,
            },
            {
              hidden: !(
                isMultiSelected ||
                props.kind === "folder" ||
                props.data.viewerKind
              ),
              label: isMultiSelected
                ? `Download ${selectedCount} items as zip`
                : props.kind === "folder"
                  ? "Download as zip"
                  : "Download",
              onSelect: onDownload,
            },
          ],
        },
        {
          actions: [
            {
              disabled: isMultiSelected,
              label: "Rename",
              shortcut: "F2",
              onSelect: onStartRename,
            },
            {
              label: isFavorite
                ? "Remove from favourites"
                : "Add to favourites",
              onSelect: onFavorite,
            },
            {
              label: shareLabel ? "Share — manage link" : "Share",
              onSelect: shareProps.onShare,
            },
            {
              hidden: props.kind !== "folder",
              label: "Change icon…",
              onSelect: onProperties,
            },
            {
              label: "Properties",
              onSelect: onProperties,
            },
          ],
        },
        {
          actions: [
            {
              label: isMultiSelected ? `Cut ${selectedCount} items` : "Cut",
              shortcut: "⌘X",
              onSelect: onCut,
            },
            availableMoveTargets.length > 0
              ? {
                  label: "Move to…",
                  subActions: availableMoveTargets.map((target) => ({
                    label: target.pathLabel,
                    onSelect: () => onMoveTo(target.id),
                  })),
                }
              : {
                  disabled: true,
                  label: "Move to…",
                },
          ],
        },
        {
          actions: [
            {
              destructive: true,
              label: isMultiSelected
                ? `Move ${selectedCount} items to trash`
                : "Move to trash",
              shortcut: "Del",
              onSelect: onTrash,
            },
          ],
        },
      ]}
    >
      <div
        ref={rowRef}
        data-file-row={props.data.id}
        className={rowClasses}
        onClick={onClick}
        onDoubleClick={onOpen}
        role="row"
        aria-selected={isSelected}
        tabIndex={isSelected ? 0 : -1}
      >
        {/* Icon */}
        <div className="explorer-row-icon">
          <ItemTypeIcon
            icon={props.kind === "folder" ? IconComponent : undefined}
            size={16}
            visual={visual}
          />
        </div>

        {/* Name */}
        <div className="explorer-row-name-cell">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              className="explorer-row-rename"
              value={renameValue}
              autoFocus
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onRenameSubmit();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  onRenameCancel();
                }
                // Stop propagation so row keyboard handlers don't fire
                e.stopPropagation();
              }}
              onBlur={onRenameSubmit}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className="explorer-row-name" title={name}>
                {name}
              </span>
              {shareProps.share?.status === "active" && (
                <Share2
                  size={10}
                  className="explorer-row-share-badge"
                  aria-label="Shared"
                />
              )}
            </>
          )}
        </div>

        {/* Size */}
        <span className="explorer-row-meta">{size}</span>

        {/* Date */}
        <span className="explorer-row-meta" suppressHydrationWarning>
          {date}
        </span>
      </div>
    </DashboardItemContextMenu>
  );
}
