"use client";

import { useEffect, useRef } from "react";
import {
  X,
  Folder,
  Image,
  Film,
  Music,
  FileText,
  Archive,
  Star,
  Heart,
  Lock,
  Code,
  Briefcase,
  Download,
  File,
  FolderHeart,
  type LucideIcon,
} from "lucide-react";

import { formatDateTime } from "@/app/auth-ui";
import { Button } from "@/components/ui/button";
import type {
  LibraryFileSummary,
  LibraryFolderSummary,
} from "@/server/library/types";
import type { ShareLinkSummary } from "@/server/sharing";

// ---------------------------------------------------------------------------
// Icon catalog for folder customisation
// ---------------------------------------------------------------------------

export type FolderIconName = (typeof FOLDER_ICON_OPTIONS)[number]["name"];

export const FOLDER_ICON_OPTIONS: Array<{
  name: string;
  icon: LucideIcon;
  label: string;
}> = [
  { name: "Folder", icon: Folder, label: "Default" },
  { name: "Image", icon: Image, label: "Images" },
  { name: "Film", icon: Film, label: "Video" },
  { name: "Music", icon: Music, label: "Music" },
  { name: "FileText", icon: FileText, label: "Documents" },
  { name: "Archive", icon: Archive, label: "Archive" },
  { name: "Star", icon: Star, label: "Starred" },
  { name: "Heart", icon: Heart, label: "Favourites" },
  { name: "Lock", icon: Lock, label: "Private" },
  { name: "Code", icon: Code, label: "Code" },
  { name: "Briefcase", icon: Briefcase, label: "Work" },
  { name: "Download", icon: Download, label: "Downloads" },
];

export const FOLDER_ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  FOLDER_ICON_OPTIONS.map(({ name, icon }) => [name, icon]),
);

// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ---------------------------------------------------------------------------

type PropertiesItem =
  | { kind: "folder"; data: LibraryFolderSummary }
  | { kind: "file"; data: LibraryFileSummary };

type LibraryPropertiesPanelProps = {
  item: PropertiesItem | null;
  folderIcons: Record<string, string>;
  onSetFolderIcon: (folderId: string, iconName: string) => void;
  onClose: () => void;
  share?: ShareLinkSummary | null;
  onShare?: () => void;
};

export function LibraryPropertiesPanel({
  item,
  folderIcons,
  onSetFolderIcon,
  onClose,
  share,
  onShare,
}: LibraryPropertiesPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const isOpen = item !== null;

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  return (
    <>
      {/* Transparent overlay to catch outside clicks */}
      {isOpen && (
        <div className="properties-overlay" onClick={onClose} aria-hidden />
      )}

      <div
        ref={panelRef}
        className={`properties-panel${isOpen ? " is-open" : ""}`}
        role="complementary"
        aria-label="Item properties"
      >
        <div className="properties-panel-header">
          <span className="properties-panel-title">Properties</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close properties"
          >
            <X />
          </Button>
        </div>

        {item && (
          <div className="properties-panel-body">
            {/* Info section */}
            <div className="properties-section">
              <p className="properties-section-title">Info</p>

              <div className="properties-row">
                <span className="properties-row-label">Name</span>
                <span className="properties-row-value">{item.data.name}</span>
              </div>

              <div className="properties-row">
                <span className="properties-row-label">Kind</span>
                <span className="properties-row-value">
                  {item.kind === "folder" ? "Folder" : item.data.mimeType}
                </span>
              </div>

              {item.kind === "file" && (
                <div className="properties-row">
                  <span className="properties-row-label">Size</span>
                  <span className="properties-row-value">
                    {formatBytes(item.data.sizeBytes)}
                  </span>
                </div>
              )}

              <div className="properties-row">
                <span className="properties-row-label">Created</span>
                <span className="properties-row-value">
                  {formatDateTime(item.data.createdAt)}
                </span>
              </div>

              <div className="properties-row">
                <span className="properties-row-label">Modified</span>
                <span className="properties-row-value">
                  {formatDateTime(item.data.updatedAt)}
                </span>
              </div>

              <div className="properties-row">
                <span className="properties-row-label">ID</span>
                <span
                  className="properties-row-value"
                  style={{
                    fontFamily: "monospace",
                    fontSize: 11,
                    opacity: 0.65,
                  }}
                >
                  {item.data.id.slice(0, 8)}…
                </span>
              </div>
            </div>

            {/* Sharing section */}
            {onShare && (
              <div className="properties-section">
                <p className="properties-section-title">Sharing</p>
                {share?.status === "active" ? (
                  <>
                    <div className="properties-row">
                      <span className="properties-row-label">Status</span>
                      <span className="properties-row-value">Active</span>
                    </div>
                    <Button size="sm" variant="outline" onClick={onShare}>
                      Manage link
                    </Button>
                  </>
                ) : share ? (
                  <>
                    <div className="properties-row">
                      <span className="properties-row-label">Status</span>
                      <span className="properties-row-value">
                        {share.status.charAt(0).toUpperCase() +
                          share.status.slice(1)}
                      </span>
                    </div>
                    <Button size="sm" variant="outline" onClick={onShare}>
                      Manage link
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={onShare}>
                    Create public link
                  </Button>
                )}
              </div>
            )}

            {/* Icon picker — folders only */}
            {item.kind === "folder" && (
              <div className="properties-section">
                <p className="properties-section-title">Folder icon</p>
                <div
                  className="icon-picker-grid"
                  role="radiogroup"
                  aria-label="Choose folder icon"
                >
                  {FOLDER_ICON_OPTIONS.map(({ name, icon: Icon, label }) => {
                    const active =
                      (folderIcons[item.data.id] ?? "Folder") === name;
                    return (
                      <button
                        key={name}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={label}
                        title={label}
                        className={`icon-picker-option${active ? " is-active" : ""}`}
                        onClick={() => onSetFolderIcon(item.data.id, name)}
                      >
                        <Icon size={18} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
