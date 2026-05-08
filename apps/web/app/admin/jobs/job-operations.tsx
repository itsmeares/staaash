"use client";

import { useEffect, useState } from "react";

import {
  formatAdminDateTime,
  getAdminStatusClassName,
} from "@/app/admin/admin-format";

export type JsonBackgroundJob = {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "dead";
  runAt: string;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
  attemptCount: number;
  maxAttempts: number;
  dedupeKey: string | null;
  payloadJson: Record<string, unknown> | null;
  fileName?: string | null;
};

const JOB_META: Record<string, { name: string; desc: string }> = {
  "staging.cleanup": {
    name: "Staging Cleanup",
    desc: "Remove expired upload staging files from temporary storage.",
  },
  "trash.retention": {
    name: "Trash Retention",
    desc: "Permanently delete files that have exceeded their trash retention period.",
  },
  "update.check": {
    name: "Update Check",
    desc: "Check GitHub for a new Staaash release.",
  },
  "restore.reconcile": {
    name: "Restore Reconciliation",
    desc: "Verify database metadata against committed originals in file storage. Run after a restore.",
  },
  "media.derivative.generate": {
    name: "Derivative Generate",
    desc: "Generate preview derivatives for video files. One job is queued per file.",
  },
  "media.derivative.cleanup": {
    name: "Derivative Cleanup",
    desc: "Remove stale or orphaned derivative files from storage.",
  },
};

function effectiveStatus(
  job: Pick<JsonBackgroundJob, "status" | "lastError">,
): string {
  if (job.status === "dead" && job.lastError === "Cancelled by admin.") {
    return "cancelled";
  }
  return job.status;
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function JobOperationRow({
  kind,
  initialLastRun,
}: {
  kind: string;
  initialLastRun: JsonBackgroundJob | null;
}) {
  const meta = JOB_META[kind];
  const [lastRun, setLastRun] = useState<JsonBackgroundJob | null>(
    initialLastRun,
  );
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<JsonBackgroundJob[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const isActive =
    lastRun?.status === "queued" || lastRun?.status === "running";

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/admin/jobs?kind=${encodeURIComponent(kind)}`,
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const jobs: JsonBackgroundJob[] = data.items ?? [];
        const latest: JsonBackgroundJob | null = jobs[0] ?? null;
        const count = jobs.filter(
          (j) => j.status === "queued" || j.status === "running",
        ).length;
        if (!cancelled) {
          setLastRun(latest);
          setActiveCount(count > 0 ? count : null);
          if (historyOpen) {
            setHistory(jobs);
          }
        }
      } catch {
        // network error — ignore, retry next tick
      }
    };
    const id = setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [kind, historyOpen]);

  const handleRun = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const runRes = await fetch("/api/admin/jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      if (!runRes.ok) {
        const body = await runRes.json().catch(() => null);
        setRunError(body?.error ?? `Request failed (${runRes.status}).`);
        return;
      }
      const res = await fetch(`/api/admin/jobs?kind=${kind}&limit=1`);
      if (res.ok) {
        const data = await res.json();
        const job = data.items[0] ?? null;
        setLastRun(job);
        if (historyOpen && job) {
          setHistory((prev) =>
            prev ? [job, ...prev.filter((j) => j.id !== job.id)] : [job],
          );
        }
      }
    } finally {
      setRunning(false);
    }
  };

  const handleToggleHistory = async () => {
    const opening = !historyOpen;
    setHistoryOpen(opening);
    if (opening && history === null) {
      setHistoryLoading(true);
      try {
        const res = await fetch(`/api/admin/jobs?kind=${kind}&limit=10`);
        if (res.ok) {
          const data = await res.json();
          setHistory(data.items);
        }
      } finally {
        setHistoryLoading(false);
      }
    }
  };

  return (
    <>
      <div className="admin-op-row">
        <div className="admin-op-meta">
          <span className="admin-op-name">{meta?.name ?? kind}</span>
          <span className="admin-op-desc">{meta?.desc}</span>
          {lastRun ? (
            <span className="admin-op-last">
              <span
                className={getAdminStatusClassName(effectiveStatus(lastRun))}
              >
                {effectiveStatus(lastRun)}
              </span>{" "}
              · {formatTimeAgo(lastRun.updatedAt)}
              {activeCount !== null && activeCount > 1 && (
                <>
                  {" "}
                  · <strong>{activeCount} active</strong>
                </>
              )}
            </span>
          ) : (
            <span className="admin-op-last">Never run</span>
          )}
        </div>
        <div className="admin-op-actions">
          <button
            className="button button-secondary"
            disabled={running || isActive}
            onClick={handleRun}
            style={{ fontSize: "0.8125rem" }}
          >
            {running ? "Queuing…" : isActive ? "Active" : "Run"}
          </button>
          <button
            className="button button-secondary"
            onClick={handleToggleHistory}
            style={{ fontSize: "0.8125rem" }}
          >
            History {historyOpen ? "▴" : "▾"}
          </button>
          {runError ? (
            <span
              className="muted"
              style={{ fontSize: "0.8125rem", color: "var(--destructive)" }}
            >
              {runError}
            </span>
          ) : null}
        </div>
      </div>
      {historyOpen && (
        <div className="admin-op-history-panel">
          {historyLoading ? (
            <p
              className="muted"
              style={{ fontSize: "0.8125rem", padding: "8px 0" }}
            >
              Loading…
            </p>
          ) : history && history.length > 0 ? (
            history.map((job) => {
              const fileId = job.dedupeKey?.split(":")[1] ?? null;
              const reason =
                typeof job.payloadJson?.reason === "string"
                  ? job.payloadJson.reason
                  : null;
              const fileLabel =
                job.fileName ?? (fileId ? `${fileId.slice(0, 8)}…` : null);
              return (
                <div className="admin-history-row" key={job.id}>
                  <span
                    className={getAdminStatusClassName(effectiveStatus(job))}
                  >
                    {effectiveStatus(job)}
                  </span>
                  <span className="muted">
                    {formatAdminDateTime(job.createdAt)}
                  </span>
                  {fileLabel ? (
                    <span className="muted" style={{ fontSize: "0.78rem" }}>
                      {reason ? `${reason} · ` : ""}
                      {fileLabel}
                    </span>
                  ) : (
                    <span className="muted" style={{ fontSize: "0.78rem" }}>
                      {job.lastError ?? ""}
                    </span>
                  )}
                </div>
              );
            })
          ) : (
            <p
              className="muted"
              style={{ fontSize: "0.8125rem", padding: "8px 0" }}
            >
              No runs recorded yet.
            </p>
          )}
        </div>
      )}
    </>
  );
}

type Props = {
  initialLastRuns: Record<string, JsonBackgroundJob | null>;
  jobKinds: string[];
};

export function JobOperations({ initialLastRuns, jobKinds }: Props) {
  return (
    <div className="admin-op-list">
      {jobKinds.map((kind) => (
        <JobOperationRow
          initialLastRun={initialLastRuns[kind] ?? null}
          key={kind}
          kind={kind}
        />
      ))}
    </div>
  );
}
