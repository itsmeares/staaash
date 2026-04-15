"use client";

import { useRef } from "react";
import {
  Folder,
  Image,
  Film,
  Music,
  FileText,
  Archive,
  File,
  Star,
  Heart,
  Lock,
  Code,
  Briefcase,
  Download,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { formatDateTime } from "@/app/auth-ui";
import type {
  LibraryFileSummary,
  LibraryFolderSummary,
} from "@/server/library/types";
import type { ShareLinkSummary } from "@/server/sharing";
import { FOLDER_ICON_MAP } from "./library-properties-panel";

// ---------------------------------------------------------------------------
// File icon mapping
// ---------------------------------------------------------------------------

function getFileIcon(mimeType: string): LucideIcon {
  if (mimeType.startsWith("image/")) return Image;
  if (mimeType.startsWith("video/")) return Film;
  if (mimeType.startsWith("audio/")) return Music;
  if (
    mimeType.includes("pdf") ||
    mimeType.startsWith("text/") ||
    mimeType.includes("document")
  )
    return FileText;
  if (
    mimeType.includes("zip") ||
    mimeType.includes("archive") ||
    mimeType.includes("tar") ||
    mimeType.includes("gzip")
  )
    return Archive;
  return File;
}

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
};

type BaseFolderRowProps = {
  kind: "folder";
  data: LibraryFolderSummary;
  isSelected: boolean;
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
  rowRef: (el: HTMLDivElement | null) => void;
};

type BaseFileRowProps = {
  kind: "file";
  data: LibraryFileSummary;
  isSelected: boolean;
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
  rowRef: (el: HTMLDivElement | null) => void;
};

type LibraryRowProps = BaseFolderRowProps | BaseFileRowProps;

// ---------------------------------------------------------------------------

export function LibraryRow(props: LibraryRowProps) {
  const {
    isSelected,
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
  let IconComponent: LucideIcon;
  let iconColor: string;

  if (props.kind === "folder") {
    const customIcon =
      FOLDER_ICON_MAP[props.folderIconName ?? "Folder"] ?? Folder;
    IconComponent = isSelected ? FolderOpen : customIcon;
    iconColor =
      "color-mix(in oklab, var(--primary) 80%, var(--foreground) 20%)";
  } else {
    IconComponent = getFileIcon(props.data.mimeType);
    iconColor = "var(--muted-foreground)";
  }

  // ---- Name ----
  const name = props.data.name;

  // ---- Meta ----
  const date = formatDateTime(props.data.updatedAt);
  const size = props.kind === "file" ? formatBytes(props.data.sizeBytes) : "";

  // ---- Href ----
  const href =
    props.kind === "folder"
      ? props.data.isLibraryRoot
        ? "/library"
        : `/library/f/${props.data.id}`
      : props.data.viewerKind
        ? `/library/files/${props.data.id}`
        : `/api/library/files/${props.data.id}/download`;

  // ---- Share display ----
  const shareLabel = shareProps.share
    ? shareProps.share.status === "active"
      ? "Shared"
      : "Link inactive"
    : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger>
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
            <IconComponent size={16} style={{ color: iconColor }} aria-hidden />
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
              <span className="explorer-row-name" title={name}>
                {name}
              </span>
            )}
          </div>

          {/* Size */}
          <span className="explorer-row-meta">{size}</span>

          {/* Date */}
          <span className="explorer-row-meta">{date}</span>
        </div>
      </ContextMenuTrigger>

      {/* ---- Context menu ---- */}
      <ContextMenuContent>
        {/* Group 1 — primary action */}
        <ContextMenuItem onClick={onOpen}>
          {props.kind === "folder"
            ? "Open"
            : props.data.viewerKind
              ? "Open"
              : "Download"}
          <ContextMenuShortcut>↵</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator />

        {/* Group 2 — item management */}
        <ContextMenuItem onClick={onStartRename}>
          Rename
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuItem onClick={onFavorite}>
          {isFavorite ? "Remove from favourites" : "Add to favourites"}
        </ContextMenuItem>

        {shareLabel ? (
          <ContextMenuItem
            onClick={() => {
              window.location.href = `/shared#${shareProps.share!.id}`;
            }}
          >
            {shareLabel} — manage link
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            onClick={() => {
              const form = document.createElement("form");
              form.method = "POST";
              form.action = "/api/shares";
              const fields: Record<string, string> = {
                targetType: shareProps.targetType,
                redirectTo: shareProps.currentPath,
                [shareProps.targetType === "file" ? "fileId" : "folderId"]:
                  shareProps.targetId,
              };
              for (const [k, v] of Object.entries(fields)) {
                const input = document.createElement("input");
                input.type = "hidden";
                input.name = k;
                input.value = v;
                form.appendChild(input);
              }
              document.body.appendChild(form);
              form.submit();
            }}
          >
            Create public link
          </ContextMenuItem>
        )}

        {props.kind === "folder" && (
          <ContextMenuItem onClick={onProperties}>Change icon…</ContextMenuItem>
        )}

        <ContextMenuItem onClick={onProperties}>Properties</ContextMenuItem>

        <ContextMenuSeparator />

        {/* Group 3 — clipboard and destructive */}
        <ContextMenuItem onClick={onCut}>
          Cut
          <ContextMenuShortcut>⌘X</ContextMenuShortcut>
        </ContextMenuItem>

        {availableMoveTargets.length > 0 ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>Move to…</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {availableMoveTargets.map((target) => (
                <ContextMenuItem
                  key={target.id}
                  onClick={() => onMoveTo(target.id)}
                >
                  {target.pathLabel}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : (
          <ContextMenuItem disabled>Move to…</ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem variant="destructive" onClick={onTrash}>
          Move to trash
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
