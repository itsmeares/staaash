"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  File,
  Loader2,
  X,
} from "lucide-react";

import {
  useTransferContext,
  formatSpeed,
  formatEta,
  type UploadingFile,
  type DownloadProgressState,
} from "./transfer-context";

// ---------------------------------------------------------------------------
// Transfer panel (portal-rendered, bottom-right)
// ---------------------------------------------------------------------------

export function TransferPanel() {
  const {
    uploadingFiles,
    activeDownload,
    currentFilesViewFolderId,
    dismissUpload,
    retryUpload,
    dismissDownload,
  } = useTransferContext();

  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const anchorRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-trigger download when archive is ready
  useEffect(() => {
    if (activeDownload?.state.status === "ready") {
      anchorRef.current?.click();
    }
  }, [activeDownload?.state.status]);

  // Auto-dismiss download panel 3s after it's ready
  useEffect(() => {
    if (activeDownload?.state.status === "ready") {
      const timer = setTimeout(dismissDownload, 3000);
      return () => clearTimeout(timer);
    }
  }, [activeDownload?.state.status, dismissDownload]);

  const isOnFilesRoute =
    pathname === "/files" || pathname.startsWith("/files/");

  // Show uploads in panel only when they don't belong to the currently visible
  // folder (those appear inline in the file list instead).
  const panelUploads = isOnFilesRoute
    ? uploadingFiles.filter((f) => f.folderId !== currentFilesViewFolderId)
    : uploadingFiles;

  const shouldShow = panelUploads.length > 0 || activeDownload !== null;

  if (!mounted || !shouldShow) return null;

  const totalCount = panelUploads.length + (activeDownload ? 1 : 0);
  const title = totalCount === 1 ? "1 transfer" : `${totalCount} transfers`;

  const panel = (
    <div className="transfer-panel">
      <div className="transfer-panel-header">
        <span className="transfer-panel-title">{title}</span>
        <div className="transfer-panel-header-actions">
          <button
            type="button"
            className="transfer-panel-icon-btn"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="transfer-panel-body">
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
              onClose={dismissDownload}
            />
          )}
        </div>
      )}

      {activeDownload?.state.status === "ready" && (
        <a
          ref={anchorRef}
          href={`/api/files/archives/${activeDownload.archiveId}/download`}
          style={{ display: "none" }}
          aria-hidden
        />
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
  const eta = formatEta(file.size, file.progress, file.speed);
  const statusText =
    file.status === "error"
      ? (file.error ?? "Upload failed")
      : file.status === "done"
        ? "Done"
        : file.resumeHint && file.progress === 0
          ? file.resumeHint
          : `${file.progress}% · ${formatSpeed(file.speed)}${eta ? ` · ${eta}` : ""}`;

  return (
    <div className="transfer-panel-row">
      <div className="transfer-panel-row-top">
        <File size={13} className="transfer-panel-row-icon" />
        <span className="transfer-panel-row-name">{file.name}</span>
        <span
          className={`transfer-panel-row-status${file.status === "error" ? " is-error" : ""}`}
        >
          {statusText}
          {file.status === "error" && onRetry && (
            <button
              type="button"
              className="transfer-panel-row-action"
              onClick={onRetry}
            >
              Retry
            </button>
          )}
          {file.status !== "uploading" && (
            <button
              type="button"
              className="transfer-panel-row-action"
              onClick={onDismiss}
              aria-label="Dismiss"
            >
              <X size={11} />
            </button>
          )}
        </span>
      </div>
      {file.status === "uploading" && (
        <div className="transfer-panel-row-track">
          <div
            className="transfer-panel-row-fill"
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
  onClose,
}: {
  state: DownloadProgressState;
  onClose: () => void;
}) {
  const bodyText =
    state.status === "queued"
      ? "Waiting for worker…"
      : state.status === "processing"
        ? state.fileCount != null
          ? `Compressing ${state.fileCount} file${state.fileCount !== 1 ? "s" : ""}…`
          : "Compressing files…"
        : state.status === "ready"
          ? "Your download has started."
          : state.message;

  return (
    <div className="transfer-panel-row transfer-panel-row--download">
      <div className="transfer-panel-row-top">
        {state.status === "ready" ? (
          <CheckCircle2
            size={13}
            className="transfer-panel-row-icon--success"
          />
        ) : state.status === "error" ? null : (
          <Loader2 size={13} className="transfer-panel-row-icon--spin" />
        )}
        <span className="transfer-panel-row-name">{bodyText}</span>
        {state.status !== "processing" && state.status !== "queued" && (
          <button
            type="button"
            className="transfer-panel-row-action"
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
