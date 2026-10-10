"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  File,
  Loader2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

import {
  useTransferContext,
  formatSpeed,
  formatEta,
  type UploadingFile,
  type DownloadProgressState,
} from "./transfer-context";
import { startValidatedDownload } from "@/lib/transfers/download";

const rowClass =
  "flex flex-col gap-1 border-b border-border/60 px-3 py-2 last:border-b-0";
const iconButtonClass =
  "inline-flex cursor-pointer items-center justify-center rounded-xs px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-pressed hover:text-foreground";
const nameClass = "flex-1 truncate text-xs text-foreground";

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
    <div className="fixed right-4 bottom-4 z-50 max-w-95 min-w-75 overflow-hidden rounded-md border border-border bg-card shadow-floating max-lg:right-2.5 max-lg:bottom-[calc(76px+env(safe-area-inset-bottom))] max-lg:left-2.5 max-lg:w-auto max-lg:max-w-none max-lg:rounded-xl md:max-lg:landscape:bottom-3.5 md:max-lg:landscape:left-21.5">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="flex-1 text-label font-medium text-foreground">
          {title}
        </span>
        <button
          type="button"
          className={cn(iconButtonClass, "size-6 p-0")}
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {!collapsed && (
        <div className="max-h-80 overflow-y-auto border-t border-border">
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
      <div className="flex min-w-0 items-center gap-1.5">
        <File size={13} className="shrink-0 text-muted-foreground" />
        <span className={nameClass}>{file.name}</span>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground",
            file.status === "error" && "text-destructive-foreground",
          )}
        >
          <span aria-live="polite" aria-atomic="true">
            {isPhaseStatus ? statusText : ""}
          </span>
          {!isPhaseStatus && statusText}
          {file.status === "error" && onRetry && (
            <button type="button" className={iconButtonClass} onClick={onRetry}>
              Retry
            </button>
          )}
          {file.status !== "uploading" && (
            <button
              type="button"
              className={iconButtonClass}
              onClick={onDismiss}
              aria-label="Dismiss"
            >
              <X size={11} />
            </button>
          )}
        </span>
      </div>
      {file.status === "uploading" && (
        <div className="h-0.75 overflow-hidden rounded-xs bg-foreground/10">
          <div
            className="h-full rounded-xs bg-primary transition-[width] duration-300"
            style={{ width: `${file.progress}%` }}
          />
        </div>
      )}
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
      <div className="flex min-w-0 items-center gap-1.5">
        {state.status === "ready" && !error ? (
          <CheckCircle2
            size={13}
            className="shrink-0 text-success-foreground"
          />
        ) : state.status === "error" || error ? null : (
          <Loader2
            size={13}
            className="shrink-0 animate-spin text-muted-foreground"
          />
        )}
        <span className={nameClass}>{bodyText}</span>
        {state.status !== "processing" && state.status !== "queued" && (
          <button
            type="button"
            className={iconButtonClass}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
