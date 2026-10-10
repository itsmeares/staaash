"use client";

import {
  Archive,
  Briefcase,
  Code,
  Download,
  FileText,
  Film,
  Folder,
  Heart,
  Image,
  Lock,
  Music,
  Star,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useMediaQuery } from "@/app/(workspace)/use-media-query";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerPopup, DrawerTitle } from "@/components/ui/drawer";
import {
  generateMediaPreview,
  MEDIA_PREVIEW_LABELS,
  watchMediaPreviewStatus,
  type MediaPreviewState,
} from "@/lib/media-preview-status";
import { cn } from "@/lib/utils";

import { ItemIcon, type FileListItem } from "./file-list";

const DETAILS_KEY = "staaash:details-open";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable);

/** Open state for the details panel: `i` toggles it, remembered per device. */
export function useDetailsPanel() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(window.localStorage.getItem(DETAILS_KEY) === "1");
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "i" || event.ctrlKey || event.metaKey || event.altKey)
        return;
      if (isTyping(event.target)) return;
      setOpen((current) => {
        window.localStorage.setItem(DETAILS_KEY, current ? "0" : "1");
        return !current;
      });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const set = (next: boolean) => {
    window.localStorage.setItem(DETAILS_KEY, next ? "1" : "0");
    setOpen(next);
  };

  return { open, setOpen: set, toggle: () => set(!open) };
}

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

export function DetailsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2 border-t border-border px-4 py-3.5">
      <h3 className="m-0 font-sans text-meta font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function DetailsRows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="m-0 grid gap-1.5 text-meta">
      {rows.map(([label, value]) => (
        <div className="flex justify-between gap-3" key={label}>
          <dt className="shrink-0 text-muted-foreground">{label}</dt>
          <dd className="m-0 min-w-0 truncate text-right">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function previewStatusLabel(
  state: MediaPreviewState | null,
  error: string | null,
) {
  if (state) return MEDIA_PREVIEW_LABELS[state.status];
  return error ? "Unavailable" : "Loading…";
}

/** Preview status for videos, with generate and regenerate. */
export function MediaPreviewSection({ fileId }: { fileId: string }) {
  const [state, setState] = useState<MediaPreviewState | null>(null);
  const [queuing, setQueuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const generateRequest = useRef<AbortController | null>(null);

  useEffect(() => () => generateRequest.current?.abort(), []);

  useEffect(() => {
    if (queuing) return;
    return watchMediaPreviewStatus(fileId, setState, setStatusError);
  }, [fileId, queuing]);

  const handleGenerate = async () => {
    if (generateRequest.current) return;
    const controller = new AbortController();
    generateRequest.current = controller;
    setQueuing(true);
    setError(null);
    try {
      const data = await generateMediaPreview(fileId, controller.signal);
      controller.signal.throwIfAborted();
      setState(data);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(
          caught instanceof Error ? caught.message : "Failed to queue preview.",
        );
      }
    } finally {
      generateRequest.current = null;
      if (!controller.signal.aborted) setQueuing(false);
    }
  };

  const status = state?.status ?? "none";
  const disabled =
    queuing ||
    status === "queued" ||
    status === "processing" ||
    state === null ||
    statusError !== null;

  return (
    <DetailsSection title="Preview">
      <div className="flex items-center justify-between gap-3 text-meta">
        <span className="flex items-center gap-2" aria-live="polite">
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full bg-muted-foreground",
              status === "ready" && "bg-success",
              (status === "failed" || statusError) && "bg-destructive",
            )}
          />
          {previewStatusLabel(state, statusError)}
        </span>
        <Button
          disabled={disabled}
          size="xs"
          variant="outline"
          onClick={() => void handleGenerate()}
        >
          {queuing
            ? "Queuing…"
            : status === "ready" || status === "stale"
              ? "Regenerate"
              : "Generate"}
        </Button>
      </div>
      {error || statusError ? (
        <p className="m-0 text-label text-destructive-foreground" role="status">
          {error ?? statusError}
        </p>
      ) : null}
    </DetailsSection>
  );
}

export function FolderIconPicker({
  active,
  onPick,
}: {
  active: string;
  onPick: (name: string) => void;
}) {
  return (
    <DetailsSection title="Folder icon">
      <div
        aria-label="Choose folder icon"
        className="grid grid-cols-6 gap-1"
        role="radiogroup"
      >
        {FOLDER_ICON_OPTIONS.map(({ name, icon: Icon, label }) => (
          <button
            aria-checked={active === name}
            aria-label={label}
            className={cn(
              "flex aspect-square cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              active === name && "bg-selected text-primary-ink",
            )}
            key={name}
            role="radio"
            title={label}
            type="button"
            onClick={() => onPick(name)}
          >
            <Icon className="size-4.5" />
          </button>
        ))}
      </div>
    </DetailsSection>
  );
}

export type DetailsContent = {
  item: FileListItem;
  /** Large preview; defaults to the thumbnail or the type icon. */
  preview?: ReactNode;
  actions?: ReactNode;
  rows: Array<[string, ReactNode]>;
  sections?: ReactNode;
};

function DetailsBody({
  content,
  emptyText,
}: {
  content: DetailsContent | null;
  emptyText: string;
}) {
  if (!content) {
    return (
      <p className="m-0 px-4 py-6 text-meta text-muted-foreground">
        {emptyText}
      </p>
    );
  }
  const { item } = content;
  return (
    <div className="grid">
      <div className="grid gap-3 px-4 pb-3.5">
        {content.preview ?? (
          <span className="flex aspect-4/3 items-center justify-center overflow-hidden rounded-xl bg-muted">
            {item.thumbnailUrl ? (
              <img
                alt=""
                className="size-full object-cover"
                src={item.thumbnailUrl}
              />
            ) : (
              <ItemIcon className="size-14 [&_svg]:size-12" item={item} />
            )}
          </span>
        )}
        {content.actions ? (
          <div className="grid grid-cols-2 gap-2">{content.actions}</div>
        ) : null}
      </div>
      <DetailsSection title="Info">
        <DetailsRows rows={content.rows} />
      </DetailsSection>
      {content.sections}
    </div>
  );
}

/**
 * Details for the selected item, docked beside the list on wide screens and
 * a side sheet below that. It never traps focus.
 */
export function DetailsPanel({
  content,
  emptyText = "Select a file or folder to see its details.",
  onClose,
}: {
  content: DetailsContent | null;
  emptyText?: string;
  onClose: () => void;
}) {
  const docked = useMediaQuery("(min-width: 64rem)");
  const header = (
    <div className="flex items-center gap-2 px-4 pt-3.5 pb-3">
      <h2 className="m-0 min-w-0 flex-1 truncate font-sans text-body font-semibold">
        {content?.item.name ?? "Details"}
      </h2>
      <Button
        aria-label="Close details"
        size="icon-sm"
        variant="ghost-muted"
        onClick={onClose}
      >
        <X aria-hidden />
      </Button>
    </div>
  );

  if (docked) {
    return (
      <aside
        aria-label="Details"
        className="sticky top-0 max-h-[calc(100dvh-7rem)] w-76 shrink-0 self-start overflow-y-auto rounded-xl border border-border bg-card"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        {header}
        <DetailsBody content={content} emptyText={emptyText} />
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
        <DrawerTitle className="sr-only">Details</DrawerTitle>
        <div className="overflow-y-auto">
          {header}
          <DetailsBody content={content} emptyText={emptyText} />
        </div>
      </DrawerPopup>
    </Drawer>
  );
}
