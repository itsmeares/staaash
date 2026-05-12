"use client";

import { useEffect, useMemo, useState } from "react";

import {
  formatAdminDateTime,
  getAdminStatusClassName,
} from "@/app/admin/admin-format";

export type JsonBackgroundJob = {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "dead" | "cancelled";
  runAt: string;
  lockedAt?: string | null;
  leaseExpiresAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
  attemptCount: number;
  maxAttempts: number;
  dedupeKey: string | null;
  payloadJson: Record<string, unknown> | null;
  fileName?: string | null;
};

type JsonWorker = {
  id: string;
  hostname: string;
  pid: number;
  version: string | null;
  startedAt: string;
  lastHeartbeatAt: string;
  stoppedAt: string | null;
  status: string;
  currentJobId: string | null;
};

type JsonJobSummary = {
  statusCounts: Record<JsonBackgroundJob["status"], number> & { total: number };
  countsByKind: Record<
    string,
    Partial<Record<JsonBackgroundJob["status"], number>>
  >;
  oldestQueuedAgeSeconds: number | null;
  oldestDueQueuedAgeSeconds: number | null;
  nextQueuedRunAt: string | null;
  staleRunning: number;
  failed: number;
  dead: number;
  workers: JsonWorker[];
};

type JsonJobEvent = {
  id: string;
  type: string;
  message: string | null;
  metadataJson: Record<string, unknown>;
  workerId: string | null;
  createdAt: string;
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
  "zip.archive.generate": {
    name: "Archive Generate",
    desc: "Build downloadable zip archives for selected files and folders.",
  },
  "zip.archive.cleanup": {
    name: "Archive Cleanup",
    desc: "Remove expired generated zip archives from storage.",
  },
};

const JOB_POLL_MS = 5000;
const CLOCK_TICK_MS = 1000;
const HISTORY_VISIBLE_RUNS = 12;

function effectiveStatus(
  job: Pick<JsonBackgroundJob, "status" | "lastError">,
): string {
  if (job.status === "dead" && job.lastError === "Cancelled by admin.") {
    return "cancelled";
  }
  return job.status;
}

function formatStableUtcDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function formatLocalDateTime(dateStr: string, nowMs: number | null): string {
  if (nowMs === null) return formatStableUtcDateTime(dateStr);
  return formatAdminDateTime(dateStr);
}

function formatRelativeTime(dateStr: string, nowMs: number | null): string {
  if (nowMs === null) {
    return formatStableUtcDateTime(dateStr);
  }

  const diff = nowMs - new Date(dateStr).getTime();
  const absoluteSeconds = Math.max(0, Math.floor(Math.abs(diff) / 1000));
  const suffix = diff < 0 ? "from now" : "ago";
  if (absoluteSeconds < 60) return `${absoluteSeconds}s ${suffix}`;
  const minutes = Math.floor(absoluteSeconds / 60);
  if (minutes < 60) return `${minutes}m ${suffix}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${suffix}`;
  const days = Math.floor(hours / 24);
  return `${days}d ${suffix}`;
}

function getJobDisplayStatus(
  job: Pick<JsonBackgroundJob, "id" | "status" | "lastError">,
  workerRunningJobIds: Set<string>,
): string {
  if (workerRunningJobIds.has(job.id)) return "running";
  return effectiveStatus(job);
}

function getJobTimingLabel(
  job: JsonBackgroundJob,
  nowMs: number | null,
  displayStatus = effectiveStatus(job),
) {
  if (displayStatus === "queued") {
    const runAtMs = new Date(job.runAt).getTime();
    if (nowMs !== null && runAtMs <= nowMs) {
      return `waiting ${formatRelativeTime(job.runAt, nowMs)}`;
    }
    return `scheduled ${formatLocalDateTime(job.runAt, nowMs)}`;
  }

  if (displayStatus === "running") {
    return `started ${formatRelativeTime(
      job.startedAt ?? job.lockedAt ?? job.updatedAt,
      nowMs,
    )}`;
  }

  if (displayStatus === "succeeded") {
    return `completed ${formatRelativeTime(
      job.completedAt ?? job.updatedAt,
      nowMs,
    )}`;
  }

  if (displayStatus === "cancelled") {
    return `cancelled ${formatRelativeTime(
      job.cancelledAt ?? job.updatedAt,
      nowMs,
    )}`;
  }

  return `updated ${formatRelativeTime(job.updatedAt, nowMs)}`;
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "none";
  const minutes = Math.floor(seconds / 60);
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  if (minutes < 60) return `${minutes}m`;
  const days = Math.floor(hours / 24);
  if (hours < 24) return `${hours}h`;
  return `${days}d`;
}

function isFinishedJob(job: JsonBackgroundJob) {
  return (
    job.status === "succeeded" ||
    job.status === "failed" ||
    job.status === "dead" ||
    job.status === "cancelled"
  );
}

function selectRepresentativeJob(
  jobs: JsonBackgroundJob[],
  workerRunningJobIds: Set<string>,
) {
  const now = new Date();
  return (
    jobs.find((job) => workerRunningJobIds.has(job.id)) ??
    jobs.find((job) => job.status === "running") ??
    jobs.find((job) => job.status === "queued" && new Date(job.runAt) <= now) ??
    jobs.find(isFinishedJob) ??
    jobs.find((job) => job.status === "queued") ??
    null
  );
}

function getActiveJobState(
  jobs: JsonBackgroundJob[],
  workerRunningJobIds: Set<string>,
) {
  const hasRunning = jobs.some(
    (job) => job.status === "running" || workerRunningJobIds.has(job.id),
  );
  const hasQueued = jobs.some((job) => job.status === "queued");
  const activeCount = jobs.filter(
    (job) => job.status === "queued" || job.status === "running",
  ).length;

  return { hasRunning, hasQueued, activeCount };
}

function JobOperationRow({
  kind,
  initialLastRun,
  nowMs,
  workerRunningJobIds,
}: {
  kind: string;
  initialLastRun: JsonBackgroundJob | null;
  nowMs: number | null;
  workerRunningJobIds: Set<string>;
}) {
  const meta = JOB_META[kind];
  const [lastRun, setLastRun] = useState<JsonBackgroundJob | null>(
    initialLastRun,
  );
  const [activeJobState, setActiveJobState] = useState({
    hasRunning: initialLastRun?.status === "running",
    hasQueued: initialLastRun?.status === "queued",
    activeCount:
      initialLastRun?.status === "queued" ||
      initialLastRun?.status === "running"
        ? 1
        : 0,
  });
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<JsonBackgroundJob[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryJobId, setSelectedHistoryJobId] = useState<
    string | null
  >(null);
  const [events, setEvents] = useState<JsonJobEvent[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isActive = activeJobState.hasQueued || activeJobState.hasRunning;
  const lastRunStatus = lastRun
    ? getJobDisplayStatus(lastRun, workerRunningJobIds)
    : null;

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/admin/jobs?kind=${encodeURIComponent(kind)}&limit=100`,
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const jobs: JsonBackgroundJob[] = data.items ?? [];
        const latest = selectRepresentativeJob(jobs, workerRunningJobIds);
        if (!cancelled) {
          setLastRun(latest);
          setActiveJobState(getActiveJobState(jobs, workerRunningJobIds));
          if (historyOpen) {
            setHistory(jobs);
            setSelectedHistoryJobId((current) => current ?? latest?.id ?? null);
          }
        }
      } catch {
        // network error — ignore, retry next tick
      }
    };
    void poll();
    const id = setInterval(() => void poll(), JOB_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [kind, historyOpen, workerRunningJobIds]);

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
      const res = await fetch(`/api/admin/jobs?kind=${kind}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        const jobs: JsonBackgroundJob[] = data.items ?? [];
        const job = selectRepresentativeJob(jobs, workerRunningJobIds);
        setLastRun(job);
        setActiveJobState(getActiveJobState(jobs, workerRunningJobIds));
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

  const postJobAction = async (jobId: string, action: "retry" | "cancel") => {
    setActionError(null);
    const res = await fetch(`/api/admin/jobs/${jobId}/${action}`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setActionError(body?.error ?? `Request failed (${res.status}).`);
      return;
    }
    const updated = await fetch(
      `/api/admin/jobs?kind=${encodeURIComponent(kind)}&limit=100`,
    );
    if (updated.ok) {
      const data = await updated.json();
      const jobs: JsonBackgroundJob[] = data.items ?? [];
      setHistory(jobs);
      setLastRun(selectRepresentativeJob(jobs, workerRunningJobIds));
      setActiveJobState(getActiveJobState(jobs, workerRunningJobIds));
    }
  };

  useEffect(() => {
    if (!historyOpen || !selectedHistoryJobId) return;

    let cancelled = false;
    setEvents(null);
    void fetch(`/api/admin/jobs/${selectedHistoryJobId}/events`)
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setEvents(data.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [historyOpen, selectedHistoryJobId]);

  const handleToggleHistory = async () => {
    const opening = !historyOpen;
    setHistoryOpen(opening);
    if (opening && history === null) {
      setHistoryLoading(true);
      try {
        const res = await fetch(`/api/admin/jobs?kind=${kind}&limit=100`);
        if (res.ok) {
          const data = await res.json();
          const jobs: JsonBackgroundJob[] = data.items ?? [];
          const selected = selectRepresentativeJob(jobs, workerRunningJobIds);
          setHistory(jobs);
          setSelectedHistoryJobId(selected?.id ?? jobs[0]?.id ?? null);
        }
      } finally {
        setHistoryLoading(false);
      }
    }
  };

  const visibleHistory = history?.slice(0, HISTORY_VISIBLE_RUNS) ?? [];
  const selectedHistoryJob =
    history?.find((job) => job.id === selectedHistoryJobId) ??
    visibleHistory[0] ??
    null;

  return (
    <>
      <div className="admin-op-row">
        <div className="admin-op-meta">
          <span className="admin-op-name">{meta?.name ?? kind}</span>
          <span className="admin-op-desc">{meta?.desc}</span>
          {lastRun ? (
            <span className="admin-op-last">
              <span className={getAdminStatusClassName(lastRunStatus ?? "")}>
                {lastRunStatus}
              </span>{" "}
              · {getJobTimingLabel(lastRun, nowMs, lastRunStatus ?? undefined)}
              {activeJobState.activeCount > 1 && (
                <>
                  {" "}
                  · <strong>{activeJobState.activeCount} active</strong>
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
            {running
              ? "Queuing…"
              : activeJobState.hasRunning
                ? "Running"
                : activeJobState.hasQueued
                  ? "Scheduled"
                  : "Run"}
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
          {actionError ? (
            <span
              className="muted"
              style={{ fontSize: "0.8125rem", color: "var(--destructive)" }}
            >
              {actionError}
            </span>
          ) : null}
        </div>
      </div>
      {historyOpen && (
        <div className="admin-job-history-panel">
          {historyLoading ? (
            <p
              className="muted"
              style={{ fontSize: "0.8125rem", padding: "8px 0" }}
            >
              Loading…
            </p>
          ) : history && history.length > 0 ? (
            <div className="admin-job-history-layout">
              <div className="admin-job-run-list">
                <div className="admin-job-history-head">
                  <span>Recent runs</span>
                  <span className="muted">
                    {visibleHistory.length} of {history.length}
                  </span>
                </div>
                {visibleHistory.map((job) => {
                  const displayStatus = getJobDisplayStatus(
                    job,
                    workerRunningJobIds,
                  );
                  return (
                    <button
                      className={`admin-job-run-button ${
                        selectedHistoryJob?.id === job.id
                          ? "admin-job-run-button-active"
                          : ""
                      }`}
                      key={job.id}
                      onClick={() => setSelectedHistoryJobId(job.id)}
                      type="button"
                    >
                      <span className={getAdminStatusClassName(displayStatus)}>
                        {displayStatus}
                      </span>
                      <span>
                        {getJobTimingLabel(job, nowMs, displayStatus)}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="admin-job-detail">
                {selectedHistoryJob ? (
                  <>
                    <div className="admin-job-detail-head">
                      <div>
                        <p className="admin-job-detail-title">
                          {getJobTimingLabel(
                            selectedHistoryJob,
                            nowMs,
                            getJobDisplayStatus(
                              selectedHistoryJob,
                              workerRunningJobIds,
                            ),
                          )}
                        </p>
                        <p className="muted admin-job-detail-id">
                          {selectedHistoryJob.id}
                        </p>
                      </div>
                      <span
                        className={getAdminStatusClassName(
                          getJobDisplayStatus(
                            selectedHistoryJob,
                            workerRunningJobIds,
                          ),
                        )}
                      >
                        {getJobDisplayStatus(
                          selectedHistoryJob,
                          workerRunningJobIds,
                        )}
                      </span>
                    </div>

                    {selectedHistoryJob.lastError ? (
                      <p className="admin-job-detail-error">
                        {selectedHistoryJob.lastError}
                      </p>
                    ) : null}

                    <div className="admin-job-detail-actions">
                      {selectedHistoryJob.status === "failed" ||
                      selectedHistoryJob.status === "dead" ||
                      selectedHistoryJob.status === "cancelled" ? (
                        <button
                          className="button button-secondary"
                          onClick={() =>
                            void postJobAction(selectedHistoryJob.id, "retry")
                          }
                          style={{ fontSize: "0.75rem", padding: "4px 10px" }}
                        >
                          Retry
                        </button>
                      ) : null}
                      {selectedHistoryJob.status === "queued" ||
                      selectedHistoryJob.status === "running" ? (
                        <button
                          className="button button-secondary"
                          onClick={() =>
                            void postJobAction(selectedHistoryJob.id, "cancel")
                          }
                          style={{ fontSize: "0.75rem", padding: "4px 10px" }}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </div>

                    <div className="admin-job-events">
                      <p className="admin-eyebrow">Events</p>
                      {events === null ? (
                        <p className="muted admin-job-events-empty">Loading…</p>
                      ) : events.length > 0 ? (
                        events.map((event) => (
                          <div className="admin-job-event-row" key={event.id}>
                            <span className="status-chip">{event.type}</span>
                            <span className="muted">
                              {formatLocalDateTime(event.createdAt, nowMs)}
                            </span>
                            <span className="muted">
                              {event.message ?? event.workerId ?? ""}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="muted admin-job-events-empty">
                          No events recorded.
                        </p>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
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
  initialSummary: JsonJobSummary;
  jobKinds: string[];
};

export function JobOperations({
  initialLastRuns,
  initialSummary,
  jobKinds,
}: Props) {
  const [summary, setSummary] = useState(initialSummary);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const activeQueueCount =
    summary.statusCounts.queued + summary.statusCounts.running;
  const activeWorkers = summary.workers.filter(
    (worker) => worker.status !== "stopped" && worker.status !== "stale",
  );
  const inactiveWorkers = summary.workers.filter(
    (worker) => worker.status === "stopped" || worker.status === "stale",
  );
  const workerRunningJobIds = useMemo(
    () =>
      new Set(
        summary.workers
          .filter((worker) => worker.status === "running")
          .map((worker) => worker.currentJobId)
          .filter((jobId): jobId is string => Boolean(jobId)),
      ),
    [summary.workers],
  );

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const res = await fetch("/api/admin/jobs/summary");
      if (!res.ok || cancelled) return;
      setSummary(await res.json());
    };
    const id = setInterval(() => void poll(), JOB_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="stack" style={{ gap: "24px" }}>
      <dl className="admin-kv-strip">
        <div className="admin-kv-item">
          <dt className="admin-kv-label">Queue</dt>
          <dd className="admin-kv-value">{activeQueueCount}</dd>
          <dd className="admin-kv-sub">
            {summary.statusCounts.queued} scheduled ·{" "}
            {summary.statusCounts.running} running
          </dd>
        </div>
        <div className="admin-kv-item">
          <dt className="admin-kv-label">Failures</dt>
          <dd className="admin-kv-value">{summary.failed + summary.dead}</dd>
          <dd className="admin-kv-sub">
            {summary.failed} failed · {summary.dead} dead
          </dd>
        </div>
        <div className="admin-kv-item">
          <dt className="admin-kv-label">Due backlog</dt>
          <dd className="admin-kv-value">
            {formatDuration(summary.oldestDueQueuedAgeSeconds)}
          </dd>
          <dd className="admin-kv-sub">
            next{" "}
            {summary.nextQueuedRunAt
              ? formatLocalDateTime(summary.nextQueuedRunAt, nowMs)
              : "none"}{" "}
            · {summary.staleRunning} stale running
          </dd>
        </div>
      </dl>

      {summary.workers.length > 0 ? (
        <section>
          <p className="admin-eyebrow">Workers</p>
          <div className="admin-worker-grid">
            {activeWorkers.map((worker) => (
              <div className="admin-worker-row" key={worker.id}>
                <span className={getAdminStatusClassName(worker.status)}>
                  {worker.status}
                </span>
                <span className="admin-worker-name">
                  {worker.hostname}:{worker.pid}
                </span>
                <span className="muted">
                  last seen {formatRelativeTime(worker.lastHeartbeatAt, nowMs)}
                </span>
              </div>
            ))}
          </div>
          {inactiveWorkers.length > 0 ? (
            <details className="admin-worker-archive">
              <summary>
                {inactiveWorkers.length} stopped or stale worker
                {inactiveWorkers.length === 1 ? "" : "s"}
              </summary>
              <div className="admin-worker-grid admin-worker-grid-archived">
                {inactiveWorkers.map((worker) => (
                  <div className="admin-worker-row" key={worker.id}>
                    <span className={getAdminStatusClassName(worker.status)}>
                      {worker.status}
                    </span>
                    <span className="admin-worker-name">
                      {worker.hostname}:{worker.pid}
                    </span>
                    <span className="muted">
                      last seen{" "}
                      {formatRelativeTime(worker.lastHeartbeatAt, nowMs)}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      <div className="admin-op-list">
        {jobKinds.map((kind) => (
          <JobOperationRow
            initialLastRun={initialLastRuns[kind] ?? null}
            key={kind}
            kind={kind}
            nowMs={nowMs}
            workerRunningJobIds={workerRunningJobIds}
          />
        ))}
      </div>
    </div>
  );
}
