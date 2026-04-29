"use client";

import { useState } from "react";

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
};

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
  const [running, setRunning] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<JsonBackgroundJob[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const isActive =
    lastRun?.status === "queued" || lastRun?.status === "running";

  const handleRun = async () => {
    setRunning(true);
    try {
      await fetch("/api/admin/jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
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
              <span className={getAdminStatusClassName(lastRun.status)}>
                {lastRun.status}
              </span>{" "}
              · {formatTimeAgo(lastRun.updatedAt)}
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
            history.map((job) => (
              <div className="admin-history-row" key={job.id}>
                <span className={getAdminStatusClassName(job.status)}>
                  {job.status}
                </span>
                <span className="muted">
                  {formatAdminDateTime(job.createdAt)}
                </span>
                <span className="muted" style={{ fontSize: "0.78rem" }}>
                  {job.lastError ?? ""}
                </span>
              </div>
            ))
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
