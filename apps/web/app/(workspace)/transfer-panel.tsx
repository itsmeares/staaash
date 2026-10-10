"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ChevronDown, ChevronUp, X } from "lucide-react";

import { ItemIcon, MiddleName } from "@/components/file-list/file-list";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import {
  useTransferContext,
  formatSpeed,
  formatEta,
  type UploadingFile,
  type DownloadProgressState,
} from "./transfer-context";
import { startValidatedDownload } from "@/lib/transfers/download";

const rowClass = "flex min-h-row flex-col justify-center gap-1 px-3 py-2";

// ---------------------------------------------------------------------------
// Transfer panel (portal-rendered, bottom-right)
// ---------------------------------------------------------------------------

export function TransferPanel() {
  const {
    uploadingFiles,
    activeDownload,
    dismissUpload,
    retryUpload,
    dismissDownload,
  } = useTransferContext();

  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    // The top bar's transfers indicator asks the panel to open.
    const expand = () => setCollapsed(false);
    window.addEventListener("staaash:transfers-open", expand);
    return () => window.removeEventListener("staaash:transfers-open", expand);
  }, []);

  // Auto-trigger download when archive is ready.
  useEffect(() => {
    if (activeDownload?.state.status !== "ready") return;

    let cancelled = false;
    setDownloadError(null);
    startValidatedDownload(
      `/api/files/archives/${activeDownload.archiveId}/download`,
      "Archive download failed",
    ).catch((err) => {
      if (!cancelled) {
        setDownloadError(
          err instanceof Error ? err.message : "Archive download failed",
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeDownload?.archiveId, activeDownload?.state.status]);

  // Auto-dismiss download panel 3s after it's ready
  useEffect(() => {
    if (activeDownload?.state.status === "ready" && !downloadError) {
      const timer = setTimeout(dismissDownload, 3000);
      return () => clearTimeout(timer);
    }
  }, [activeDownload?.state.status, dismissDownload, downloadError]);

  // Every upload shows here; lists pick up finished files on refresh.
  const panelUploads = uploadingFiles;

  const shouldShow = panelUploads.length > 0 || activeDownload !== null;

  if (!mounted || !shouldShow) return null;

  const totalCount = panelUploads.length + (activeDownload ? 1 : 0);
  const title = totalCount === 1 ? "1 transfer" : `${totalCount} transfers`;

  const panel = (
    <div className="fixed right-4 bottom-4 z-50 w-90 animate-in overflow-hidden rounded-xl border border-border bg-popover shadow-floating duration-300 ease-out fade-in slide-in-from-bottom-2 motion-reduce:animate-none max-lg:right-2.5 max-lg:bottom-[calc(76px+env(safe-area-inset-bottom))] max-lg:left-2.5 max-lg:w-auto max-lg:max-w-none max-lg:rounded-xl md:max-lg:landscape:bottom-3.5 md:max-lg:landscape:left-21.5">
      <div className="flex items-center justify-between gap-2 py-1.5 ps-3 pe-1.5">
        <span className="flex-1 text-body font-medium text-foreground">
          {title}
        </span>
        <Button
          aria-label={collapsed ? "Expand" : "Collapse"}
          onClick={() => setCollapsed((c) => !c)}
          size="icon-sm"
          variant="ghost-muted"
        >
          {collapsed ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
        </Button>
      </div>

      {!collapsed && (
        <div className="max-h-80 divide-y divide-border/60 overflow-y-auto border-t border-border">
          {panelUploads.map((f) => (
            <PanelUploadRow
              key={f.clientKey}
              file={f}
              onDismiss={() => dismissUpload(f.clientKey)}
              onRetry={f.fileRef ? () => retryUpload(f.clientKey) : undefined}
            />
          ))}

          {activeDownload && (
            <PanelDownloadRow
              state={activeDownload.state}
              error={downloadError}
              onClose={dismissDownload}
            />
          )}
        </div>
      )}
    </div>
  );

  return createPortal(panel, document.body);
}

// ---------------------------------------------------------------------------
// Upload row (panel variant)
// ---------------------------------------------------------------------------

function PanelUploadRow({
  file,
  onDismiss,
  onRetry,
}: {
  file: UploadingFile;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  const eta = formatEta(file.size, file.transferredBytes, file.speed);
  const statusText =
    file.status === "error"
      ? (file.error ?? "Upload failed")
      : file.status === "done"
        ? "Done"
        : file.resumeHint && file.progress === 0
          ? file.resumeHint
          : file.statusLabel
            ? file.statusLabel
            : `${file.progress}% · ${formatSpeed(file.speed)}${eta ? ` · ${eta}` : ""}`;
  const isPhaseStatus =
    file.status === "uploading" && Boolean(file.statusLabel);

  return (
    <div className={rowClass}>
      <div className="flex min-w-0 items-center gap-2">
        <ItemIcon
          item={{ kind: "file", mimeType: file.fileRef?.type ?? null }}
        />
        <MiddleName className="flex-1 text-body" name={file.name} />
        {file.status === "error" && onRetry && (
          <Button onClick={onRetry} size="xs" variant="ghost">
            Retry
          </Button>
        )}
        {file.status !== "uploading" && (
          <Button
            aria-label="Dismiss"
            onClick={onDismiss}
            size="icon-xs"
            variant="ghost-muted"
          >
            <X aria-hidden />
          </Button>
        )}
      </div>
      <div className="grid gap-1.5 ps-7">
        <span
          className={cn(
            "text-meta text-muted-foreground tabular-nums",
            file.status === "error" && "text-destructive-foreground",
          )}
        >
          <span aria-live="polite" aria-atomic="true">
            {isPhaseStatus ? statusText : ""}
          </span>
          {!isPhaseStatus && statusText}
        </span>
        {file.status === "uploading" && (
          <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${file.progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Download row (panel variant)
// ---------------------------------------------------------------------------

function PanelDownloadRow({
  state,
  error,
  onClose,
}: {
  state: DownloadProgressState;
  error: string | null;
  onClose: () => void;
}) {
  const bodyText = error
    ? error
    : state.status === "queued"
      ? "Waiting for worker…"
      : state.status === "processing"
        ? state.fileCount != null
          ? `Compressing ${state.fileCount} file${state.fileCount !== 1 ? "s" : ""}…`
          : "Compressing files…"
        : state.status === "ready"
          ? "Your download has started."
          : state.message;

  return (
    <div className={rowClass}>
      <div className="flex min-w-0 items-center gap-2">
        {state.status === "ready" && !error ? (
          <CheckCircle2
            aria-hidden
            className="size-4 shrink-0 text-success-foreground"
          />
        ) : state.status === "error" || error ? null : (
          <Spinner className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            "flex-1 truncate text-body",
            error || state.status === "error"
              ? "text-destructive-foreground"
              : "text-foreground",
          )}
        >
          {bodyText}
        </span>
        {state.status !== "processing" && state.status !== "queued" && (
          <Button
            aria-label="Close"
            onClick={onClose}
            size="icon-xs"
            variant="ghost-muted"
          >
            <X aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
