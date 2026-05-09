"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, X } from "lucide-react";

export type DownloadProgressState =
  | { status: "queued" }
  | { status: "processing"; fileCount?: number }
  | { status: "ready"; archiveId: string }
  | { status: "error"; message: string };

type DownloadProgressProps = {
  state: DownloadProgressState;
  onClose: () => void;
};

export function DownloadProgress({ state, onClose }: DownloadProgressProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const anchorRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (state.status === "ready") {
      anchorRef.current?.click();
      const timer = setTimeout(onClose, 3000);
      return () => clearTimeout(timer);
    }
  }, [state.status, onClose]);

  const title =
    state.status === "queued"
      ? "Preparing download"
      : state.status === "processing"
        ? "Preparing download"
        : state.status === "ready"
          ? "Download ready"
          : "Download failed";

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

  const panel = (
    <div className="download-progress-panel">
      <div className="download-progress-header">
        <span className="download-progress-title">{title}</span>
        <div className="download-progress-header-actions">
          <button
            type="button"
            className="download-progress-icon-btn"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            type="button"
            className="download-progress-icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="download-progress-body">
          {state.status === "ready" ? (
            <CheckCircle2
              size={14}
              className="download-progress-icon-success"
            />
          ) : state.status === "error" ? null : (
            <Loader2 size={14} className="download-progress-spinner" />
          )}
          <span className="download-progress-body-text">{bodyText}</span>
        </div>
      )}
      {state.status === "ready" && (
        <a
          ref={anchorRef}
          href={`/api/files/archives/${state.archiveId}/download`}
          style={{ display: "none" }}
          aria-hidden
        />
      )}
    </div>
  );

  if (!mounted) return null;
  return createPortal(panel, document.body);
}
