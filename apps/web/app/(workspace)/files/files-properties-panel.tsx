"use client";

import { useEffect, useState } from "react";
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

import { useTime } from "@/components/time-provider";
import { formatDateTime } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerPopup, DrawerTitle } from "@/components/ui/drawer";
import { useMediaQuery } from "@/app/(workspace)/use-media-query";
import { SectionLabel } from "@/components/section-label";
import { cn } from "@/lib/utils";
import type { FileSummary, FolderSummary } from "@/server/files/types";
import type { ShareLinkSummary } from "@/server/sharing";

// ---------------------------------------------------------------------------
// Icon catalog for folder customisation
// ---------------------------------------------------------------------------

const FOLDER_ICON_OPTIONS: Array<{
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

function PropertiesSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3.5 border-b border-hairline px-5 py-4.5 last:border-b-0">
      <SectionLabel className="text-xs">{title}</SectionLabel>
      {children}
    </div>
  );
}

function PropertiesRow({
  label,
  children,
  valueClassName,
}: {
  label: string;
  children: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex justify-between gap-3 text-label">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("truncate text-right font-medium", valueClassName)}>
        {children}
      </span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ---------------------------------------------------------------------------
// Media preview section
// ---------------------------------------------------------------------------

type DerivativeStatus =
  "none" | "queued" | "processing" | "ready" | "failed" | "stale";

type DerivativeState = {
  status: DerivativeStatus;
  generatedAt: string | null;
};

function MediaPreviewSection({ fileId }: { fileId: string }) {
  const [state, setState] = useState<DerivativeState | null>(null);
  const [queuing, setQueuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/files/files/${fileId}/derivative`)
      .then((r) => r.json())
      .then((data: DerivativeState) => {
        if (!cancelled) setState(data);
      })
      .catch(() => {
        if (!cancelled) setState({ status: "none", generatedAt: null });
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const handleGenerate = async () => {
    setQueuing(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/files/${fileId}/derivative`, {
        method: "POST",
      });
      const data = (await res.json()) as { status?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to queue preview.");
      } else {
        setState({ status: "queued", generatedAt: null });
      }
    } catch {
      setError("Failed to queue preview.");
    } finally {
      setQueuing(false);
    }
  };

  const STATUS_LABEL: Record<DerivativeStatus, string> = {
    none: "Not generated",
    queued: "Queued…",
    processing: "Generating…",
    ready: "Ready",
    failed: "Failed",
    stale: "Stale",
  };

  const isActive = state?.status === "queued" || state?.status === "processing";
  const buttonLabel =
    state?.status === "ready" || state?.status === "stale"
      ? "Regenerate"
      : "Generate preview";

  return (
    <PropertiesSection title="Media preview">
      {state ? (
        <PropertiesRow label="Status">
          {STATUS_LABEL[state.status]}
        </PropertiesRow>
      ) : (
        <PropertiesRow label="Status" valueClassName="text-muted-foreground">
          Loading…
        </PropertiesRow>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={queuing || isActive || state === null}
        onClick={() => void handleGenerate()}
      >
        {queuing ? "Queuing…" : buttonLabel}
      </Button>
      {error && (
        <p className="mt-1 text-xs text-destructive-foreground">{error}</p>
      )}
    </PropertiesSection>
  );
}

// ---------------------------------------------------------------------------

type PropertiesItem =
  { kind: "folder"; data: FolderSummary } | { kind: "file"; data: FileSummary };

type FilesPropertiesPanelProps = {
  /** The single selected item, or null when nothing or several items are selected. */
  item: PropertiesItem | null;
  folderIcons: Record<string, string>;
  onSetFolderIcon: (folderId: string, iconName: string) => void;
  onClose: () => void;
  share?: ShareLinkSummary | null;
  onShare?: () => void;
};

function PropertiesHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="sticky top-0 z-1 flex items-center justify-between border-b border-hairline bg-inherit px-5 pt-5 pb-4">
      <SectionLabel className="text-xs">Properties</SectionLabel>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        aria-label="Close properties"
      >
        <X />
      </Button>
    </div>
  );
}

function InfoSection({ item }: { item: PropertiesItem }) {
  const { timeZone } = useTime();
  return (
    <PropertiesSection title="Info">
      <PropertiesRow label="Name">{item.data.name}</PropertiesRow>
      <PropertiesRow label="Kind">
        {item.kind === "folder" ? "Folder" : item.data.mimeType}
      </PropertiesRow>
      {item.kind === "file" && (
        <PropertiesRow label="Size">
          {formatBytes(item.data.sizeBytes)}
        </PropertiesRow>
      )}
      <PropertiesRow label="Created">
        {formatDateTime(item.data.createdAt, timeZone)}
      </PropertiesRow>
      <PropertiesRow label="Modified">
        {formatDateTime(item.data.updatedAt, timeZone)}
      </PropertiesRow>
      <PropertiesRow label="ID" valueClassName="font-mono text-xs opacity-65">
        {item.data.id.slice(0, 8)}…
      </PropertiesRow>
    </PropertiesSection>
  );
}

function SharingSection({
  share,
  onShare,
}: {
  share?: ShareLinkSummary | null;
  onShare: () => void;
}) {
  return (
    <PropertiesSection title="Sharing">
      {share ? (
        <>
          <PropertiesRow label="Status">
            {share.status === "active"
              ? "Active"
              : share.status.charAt(0).toUpperCase() + share.status.slice(1)}
          </PropertiesRow>
          <Button size="sm" variant="outline" onClick={onShare}>
            Manage link
          </Button>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={onShare}>
          Create public link
        </Button>
      )}
    </PropertiesSection>
  );
}

function FolderIconSection({
  folderId,
  activeIcon,
  onSetFolderIcon,
}: {
  folderId: string;
  activeIcon: string;
  onSetFolderIcon: (folderId: string, iconName: string) => void;
}) {
  return (
    <PropertiesSection title="Folder icon">
      <div
        className="grid grid-cols-6 gap-1"
        role="radiogroup"
        aria-label="Choose folder icon"
      >
        {FOLDER_ICON_OPTIONS.map(({ name, icon: Icon, label }) => {
          const active = activeIcon === name;
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={label}
              title={label}
              className={cn(
                "flex aspect-square w-full cursor-pointer items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors outline-none hover:bg-pressed hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none",
                active &&
                  "border-primary/25 bg-selected text-primary-ink hover:bg-selected hover:text-primary-ink",
              )}
              onClick={() => onSetFolderIcon(folderId, name)}
            >
              <Icon size={18} />
            </button>
          );
        })}
      </div>
    </PropertiesSection>
  );
}

function PropertiesBody({
  item,
  folderIcons,
  onSetFolderIcon,
  share,
  onShare,
}: Omit<FilesPropertiesPanelProps, "onClose">) {
  if (!item) {
    return (
      <p className="px-5 py-4 text-sm text-muted-foreground">
        Select a single item to see its properties.
      </p>
    );
  }

  return (
    <div className="grid">
      <InfoSection item={item} />
      {item.kind === "file" && item.data.mimeType.startsWith("video/") && (
        <MediaPreviewSection fileId={item.data.id} />
      )}
      {onShare && <SharingSection share={share} onShare={onShare} />}
      {item.kind === "folder" && (
        <FolderIconSection
          folderId={item.data.id}
          activeIcon={folderIcons[item.data.id] ?? "Folder"}
          onSetFolderIcon={onSetFolderIcon}
        />
      )}
    </div>
  );
}

// Docked beside the list on wide screens, a side sheet below that. It never
// traps focus: the list stays usable while it is open and the pane follows
// the selection.
export function FilesPropertiesPanel({
  onClose,
  ...body
}: FilesPropertiesPanelProps) {
  const docked = useMediaQuery("(min-width: 64rem)");

  if (docked) {
    return (
      <aside
        aria-label="Item properties"
        className="sticky top-0 grid max-h-[calc(100dvh-8rem)] w-75 shrink-0 content-start self-start overflow-y-auto rounded-xl border border-hairline bg-card shadow-rail"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <PropertiesHeader onClose={onClose} />
        <PropertiesBody {...body} />
      </aside>
    );
  }

  return (
    <Drawer
      open
      position="right"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerPopup>
        <DrawerTitle className="sr-only">Item properties</DrawerTitle>
        <div className="overflow-y-auto">
          <PropertiesHeader onClose={onClose} />
          <PropertiesBody {...body} />
        </div>
      </DrawerPopup>
    </Drawer>
  );
}
