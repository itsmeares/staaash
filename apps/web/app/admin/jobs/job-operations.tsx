"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import { formatAdminDateTime } from "@/app/admin/admin-format";

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

type JsonJobState = {
  summary: JsonJobSummary;
  lastRuns: Record<string, JsonBackgroundJob | null>;
};

type JsonJobEvent = {
  id: string;
  type: string;
  message: string | null;
  metadataJson: Record<string, unknown>;
  workerId: string | null;
  createdAt: string;
};

type JobTone =
  | "idle"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

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

const MANUAL_RUN_JOB_KINDS = new Set([
  "staging.cleanup",
  "trash.retention",
  "update.check",
  "restore.reconcile",
]);

const CLOCK_TICK_MS = 1000;
const HISTORY_VISIBLE_RUNS = 12;

function effectiveStatus(
  job: Pick<JsonBackgroundJob, "status" | "lastError">,
): JsonBackgroundJob["status"] {
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

function formatLocalDateTime(
  dateStr: string,
  nowMs: number | null,
  timeZone?: string,
): string {
  if (nowMs === null) return formatStableUtcDateTime(dateStr);
  return formatAdminDateTime(dateStr, timeZone);
}

function getLocalDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);

  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    day: getPart("day"),
    hour: Number.parseInt(getPart("hour"), 10),
    minute: getPart("minute"),
    month: getPart("month"),
    time: `${getPart("hour")}:${getPart("minute")}`,
    year: getPart("year"),
  };
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getLocalDateKey(parts: ReturnType<typeof getLocalDateParts>) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatTimelineDate(
  dateStr: string,
  nowMs: number | null,
  timeZone: string,
  mode: "absolute" | "scheduled" = "absolute",
) {
  if (nowMs === null) return formatStableUtcDateTime(dateStr);

  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;

  const now = new Date(nowMs);
  const targetParts = getLocalDateParts(date, timeZone);
  const todayKey = getLocalDateKey(getLocalDateParts(now, timeZone));
  const tomorrowKey = getLocalDateKey(
    getLocalDateParts(addDays(now, 1), timeZone),
  );
  const targetKey = getLocalDateKey(targetParts);

  if (mode === "scheduled") {
    if (targetKey === todayKey) return `${targetParts.time} today`;
    if (targetKey === tomorrowKey && targetParts.hour < 6) {
      return `${targetParts.time} tonight`;
    }
    if (targetKey === tomorrowKey) return `${targetParts.time} tomorrow`;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone,
  }).format(date);
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

function formatJobKind(kind: string) {
  return (
    JOB_META[kind]?.name ??
    kind
      .split(".")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function getJobDescription(kind: string) {
  return JOB_META[kind]?.desc ?? "Background maintenance job.";
}

function isFinishedJob(job: Pick<JsonBackgroundJob, "status">) {
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

function getJobDisplayStatus(
  job: Pick<JsonBackgroundJob, "id" | "status" | "lastError">,
  workerRunningJobIds: Set<string>,
): JsonBackgroundJob["status"] {
  if (!isFinishedJob(job) && workerRunningJobIds.has(job.id)) {
    return "running";
  }
  return effectiveStatus(job);
}

function getJobTone(status: JsonBackgroundJob["status"] | null): JobTone {
  if (status === "failed" || status === "dead") return "failed";
  if (status === "running") return "running";
  if (status === "queued") return "queued";
  if (status === "succeeded") return "succeeded";
  if (status === "cancelled") return "cancelled";
  return "idle";
}

function getJobStateLine({
  job,
  nowMs,
  status,
  timeZone,
}: {
  job: JsonBackgroundJob | null;
  nowMs: number | null;
  status: JsonBackgroundJob["status"] | null;
  timeZone: string;
}) {
  if (!job || !status) return "Never run";

  if (status === "failed" || status === "dead") {
    return `Failed ${formatTimelineDate(
      job.completedAt ?? job.updatedAt,
      nowMs,
      timeZone,
    )} · attempt ${job.attemptCount} of ${job.maxAttempts}`;
  }

  if (status === "running") {
    return `Running since ${formatTimelineDate(
      job.startedAt ?? job.lockedAt ?? job.updatedAt,
      nowMs,
      timeZone,
    )}`;
  }

  if (status === "queued") {
    const runAtMs = new Date(job.runAt).getTime();
    if (nowMs !== null && runAtMs > nowMs) {
      return `Scheduled for ${formatTimelineDate(
        job.runAt,
        nowMs,
        timeZone,
        "scheduled",
      )}`;
    }
    return `Queued for ${formatTimelineDate(job.runAt, nowMs, timeZone)}`;
  }

  if (status === "cancelled") {
    return `Cancelled ${formatTimelineDate(
      job.cancelledAt ?? job.updatedAt,
      nowMs,
      timeZone,
    )}`;
  }

  return `Last run ${formatTimelineDate(
    job.completedAt ?? job.updatedAt,
    nowMs,
    timeZone,
  )}`;
}

function getJobLastFact({
  job,
  nowMs,
  status,
}: {
  job: JsonBackgroundJob | null;
  nowMs: number | null;
  status: JsonBackgroundJob["status"] | null;
}) {
  if (!job || !status) return "Never run";

  if (status === "running") {
    return `Started ${formatRelativeTime(
      job.startedAt ?? job.lockedAt ?? job.updatedAt,
      nowMs,
    )}`;
  }

  if (status === "queued") {
    return `Queued ${formatRelativeTime(job.createdAt, nowMs)}`;
  }

  if (status === "failed" || status === "dead") {
    return `Failed ${formatRelativeTime(
      job.completedAt ?? job.updatedAt,
      nowMs,
    )}`;
  }

  if (status === "cancelled") {
    return `Cancelled ${formatRelativeTime(
      job.cancelledAt ?? job.updatedAt,
      nowMs,
    )}`;
  }

  return `Succeeded ${formatRelativeTime(
    job.completedAt ?? job.updatedAt,
    nowMs,
  )}`;
}

function getPrimaryActionLabel({
  canRunManually,
  lastRun,
  status,
}: {
  canRunManually: boolean;
  lastRun: JsonBackgroundJob | null;
  status: JsonBackgroundJob["status"] | null;
}) {
  if (
    lastRun &&
    (status === "failed" || status === "dead" || status === "cancelled")
  ) {
    return "Retry";
  }

  if (status === "running") {
    return "Running";
  }

  if (canRunManually) {
    return "Run now";
  }

  return "Auto-run only";
}

function JsonBlock({ value }: { value: Record<string, unknown> | null }) {
  if (!value || Object.keys(value).length === 0) {
    return <p className="admin-jobs-modal-empty">No payload recorded.</p>;
  }

  return (
    <pre className="admin-jobs-payload">{JSON.stringify(value, null, 2)}</pre>
  );
}

function JobEventList({
  events,
  nowMs,
  timeZone,
}: {
  events: JsonJobEvent[] | null;
  nowMs: number | null;
  timeZone: string;
}) {
  if (events === null) {
    return <p className="admin-jobs-modal-empty">Loading events...</p>;
  }

  if (events.length === 0) {
    return <p className="admin-jobs-modal-empty">No events recorded.</p>;
  }

  return (
    <div className="admin-jobs-event-list">
      {events.map((event) => (
        <div className="admin-jobs-event-row" key={event.id}>
          <span className="admin-jobs-event-time">
            {formatLocalDateTime(event.createdAt, nowMs, timeZone)}
          </span>
          <span className="admin-jobs-event-main">
            <strong>{event.type}</strong>
            {event.message || event.workerId ? (
              <span>{event.message ?? event.workerId}</span>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function JobDetailsModal({
  actionError,
  events,
  history,
  historyLoading,
  instanceTimeZone,
  jobName,
  nowMs,
  onJobAction,
  onSelectHistoryJob,
  open,
  selectedHistoryJob,
  setOpen,
  workerRunningJobIds,
}: {
  actionError: string | null;
  events: JsonJobEvent[] | null;
  history: JsonBackgroundJob[] | null;
  historyLoading: boolean;
  instanceTimeZone: string;
  jobName: string;
  nowMs: number | null;
  onJobAction: (jobId: string, action: "retry" | "cancel") => void;
  onSelectHistoryJob: (jobId: string) => void;
  open: boolean;
  selectedHistoryJob: JsonBackgroundJob | null;
  setOpen: (open: boolean) => void;
  workerRunningJobIds: Set<string>;
}) {
  const selectedStatus = selectedHistoryJob
    ? getJobDisplayStatus(selectedHistoryJob, workerRunningJobIds)
    : null;
  const selectedTone = getJobTone(selectedStatus);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent className="admin-jobs-modal">
        <div className="admin-jobs-modal-head">
          <div>
            <DialogTitle>{jobName}</DialogTitle>
            {selectedHistoryJob ? (
              <p>
                {getJobStateLine({
                  job: selectedHistoryJob,
                  nowMs,
                  status: selectedStatus,
                  timeZone: instanceTimeZone,
                })}
              </p>
            ) : null}
          </div>
          {selectedStatus ? (
            <span
              className={`admin-jobs-state admin-jobs-state-${selectedTone}`}
            >
              <span aria-hidden className="admin-jobs-state-dot" />
              {selectedStatus}
            </span>
          ) : null}
        </div>

        {actionError ? (
          <p className="admin-jobs-modal-error">{actionError}</p>
        ) : null}

        <div className="admin-jobs-modal-layout">
          <section className="admin-jobs-run-list" aria-label="Recent runs">
            <h3>Recent runs</h3>
            {historyLoading ? (
              <p className="admin-jobs-modal-empty">Loading runs...</p>
            ) : history && history.length > 0 ? (
              <div className="admin-jobs-run-buttons">
                {history.slice(0, HISTORY_VISIBLE_RUNS).map((job) => {
                  const status = getJobDisplayStatus(job, workerRunningJobIds);
                  const tone = getJobTone(status);
                  const selected = selectedHistoryJob?.id === job.id;

                  return (
                    <button
                      aria-pressed={selected}
                      className={`admin-jobs-run-button ${
                        selected ? "admin-jobs-run-button-selected" : ""
                      }`}
                      key={job.id}
                      onClick={() => onSelectHistoryJob(job.id)}
                      type="button"
                    >
                      <span
                        aria-hidden
                        className={`admin-jobs-run-dot admin-jobs-run-dot-${tone}`}
                      />
                      <span>
                        <strong>{status}</strong>
                        <small>
                          {formatRelativeTime(job.updatedAt, nowMs)}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="admin-jobs-modal-empty">No runs recorded yet.</p>
            )}
          </section>

          <section className="admin-jobs-run-detail">
            {selectedHistoryJob ? (
              <>
                {selectedHistoryJob.lastError ? (
                  <div className="admin-jobs-modal-section">
                    <h3>Error</h3>
                    <p className="admin-jobs-modal-error">
                      {selectedHistoryJob.lastError}
                    </p>
                  </div>
                ) : null}

                <div className="admin-jobs-modal-section">
                  <h3>Events</h3>
                  <JobEventList
                    events={events}
                    nowMs={nowMs}
                    timeZone={instanceTimeZone}
                  />
                </div>

                <div className="admin-jobs-modal-section">
                  <h3>Payload</h3>
                  <JsonBlock value={selectedHistoryJob.payloadJson} />
                </div>

                <div className="admin-jobs-modal-actions">
                  {selectedHistoryJob.status === "failed" ||
                  selectedHistoryJob.status === "dead" ||
                  selectedHistoryJob.status === "cancelled" ? (
                    <button
                      className="admin-jobs-button admin-jobs-button-primary"
                      onClick={() =>
                        onJobAction(selectedHistoryJob.id, "retry")
                      }
                      type="button"
                    >
                      Retry
                    </button>
                  ) : null}
                  {selectedHistoryJob.status === "queued" ||
                  selectedHistoryJob.status === "running" ? (
                    <button
                      className="admin-jobs-button admin-jobs-button-danger"
                      onClick={() =>
                        onJobAction(selectedHistoryJob.id, "cancel")
                      }
                      type="button"
                    >
                      Cancel
                    </button>
                  ) : null}
                  <button
                    className="admin-jobs-button"
                    onClick={() => {
                      void navigator.clipboard.writeText(selectedHistoryJob.id);
                    }}
                    type="button"
                  >
                    Copy ID
                  </button>
                </div>
              </>
            ) : (
              <p className="admin-jobs-modal-empty">No run selected.</p>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function JobTaskCard({
  instanceTimeZone,
  kind,
  lastRun,
  nowMs,
  onLastRunChange,
  workerRunningJobIds,
}: {
  instanceTimeZone: string;
  kind: string;
  lastRun: JsonBackgroundJob | null;
  nowMs: number | null;
  onLastRunChange: (kind: string, job: JsonBackgroundJob | null) => void;
  workerRunningJobIds: Set<string>;
}) {
  const jobName = formatJobKind(kind);
  const jobDescription = getJobDescription(kind);
  const canRunManually = MANUAL_RUN_JOB_KINDS.has(kind);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [history, setHistory] = useState<JsonBackgroundJob[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryJobId, setSelectedHistoryJobId] = useState<
    string | null
  >(null);
  const [events, setEvents] = useState<JsonJobEvent[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const displayStatus = lastRun
    ? getJobDisplayStatus(lastRun, workerRunningJobIds)
    : null;
  const tone = getJobTone(displayStatus);
  const primaryActionLabel = getPrimaryActionLabel({
    canRunManually,
    lastRun,
    status: displayStatus,
  });
  const primaryActionIsCommand =
    primaryActionLabel === "Run now" || primaryActionLabel === "Retry";

  useEffect(() => {
    if (!detailsOpen || !selectedHistoryJobId) return;

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
  }, [detailsOpen, selectedHistoryJobId]);

  useEffect(() => {
    if (!detailsOpen || !lastRun) return;

    setHistory((current) => {
      if (!current) return current;
      const withoutLatest = current.filter((job) => job.id !== lastRun.id);
      return [lastRun, ...withoutLatest].sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime(),
      );
    });
    setSelectedHistoryJobId((current) => current ?? lastRun.id);
  }, [detailsOpen, lastRun]);

  const refreshJobs = async () => {
    const updated = await fetch(
      `/api/admin/jobs?kind=${encodeURIComponent(kind)}&limit=100`,
    );
    if (!updated.ok) return;

    const data = await updated.json();
    const jobs: JsonBackgroundJob[] = data.items ?? [];
    setHistory(jobs);
    onLastRunChange(kind, selectRepresentativeJob(jobs, workerRunningJobIds));
    setSelectedHistoryJobId((current) => current ?? jobs[0]?.id ?? null);
  };

  const openDetails = async () => {
    setDetailsOpen(true);
    setSelectedHistoryJobId((current) => current ?? lastRun?.id ?? null);
    if (history !== null) return;

    setHistoryLoading(true);
    try {
      const res = await fetch(
        `/api/admin/jobs?kind=${encodeURIComponent(kind)}&limit=100`,
      );
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
  };

  const handleRun = async () => {
    if (!canRunManually) {
      await openDetails();
      return;
    }

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
      await refreshJobs();
    } finally {
      setRunning(false);
    }
  };

  const postJobAction = async (jobId: string, action: "retry" | "cancel") => {
    setActionError(null);
    setRunError(null);
    const res = await fetch(`/api/admin/jobs/${jobId}/${action}`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message = body?.error ?? `Request failed (${res.status}).`;
      setActionError(message);
      setRunError(message);
      return;
    }
    await refreshJobs();
  };

  const handlePrimaryAction = async () => {
    if (
      lastRun &&
      (displayStatus === "failed" ||
        displayStatus === "dead" ||
        displayStatus === "cancelled")
    ) {
      await postJobAction(lastRun.id, "retry");
      return;
    }

    await handleRun();
  };

  const selectedHistoryJob =
    history?.find((job) => job.id === selectedHistoryJobId) ??
    history?.[0] ??
    lastRun;

  return (
    <article className={`admin-jobs-card admin-jobs-card-${tone}`}>
      <div className="admin-jobs-card-body">
        <div className="admin-jobs-card-head">
          <div className="admin-jobs-card-title-row">
            <span
              aria-hidden
              className={`admin-jobs-card-dot admin-jobs-card-dot-${tone}`}
            />
            <h2>{jobName}</h2>
          </div>
          <p className="admin-jobs-card-desc">{jobDescription}</p>
        </div>

        <div className="admin-jobs-card-facts">
          <p className={`admin-jobs-card-state admin-jobs-card-state-${tone}`}>
            {getJobLastFact({ job: lastRun, nowMs, status: displayStatus })}
          </p>

          {runError ? (
            <p className="admin-jobs-card-error">{runError}</p>
          ) : null}
        </div>
      </div>

      <div className="admin-jobs-card-actions">
        {primaryActionIsCommand ? (
          <button
            className="admin-jobs-rail-action admin-jobs-rail-action-primary"
            disabled={running}
            onClick={() => void handlePrimaryAction()}
            type="button"
          >
            {running ? "..." : primaryActionLabel}
          </button>
        ) : (
          <span className="admin-jobs-rail-note">{primaryActionLabel}</span>
        )}
        <button
          className="admin-jobs-rail-action"
          onClick={() => void openDetails()}
          type="button"
        >
          Details
        </button>
      </div>

      <JobDetailsModal
        actionError={actionError}
        events={events}
        history={history}
        historyLoading={historyLoading}
        instanceTimeZone={instanceTimeZone}
        jobName={jobName}
        nowMs={nowMs}
        onJobAction={(jobId, action) => void postJobAction(jobId, action)}
        onSelectHistoryJob={setSelectedHistoryJobId}
        open={detailsOpen}
        selectedHistoryJob={selectedHistoryJob}
        setOpen={setDetailsOpen}
        workerRunningJobIds={workerRunningJobIds}
      />
    </article>
  );
}

type Props = {
  initialLastRuns: Record<string, JsonBackgroundJob | null>;
  initialSummary: JsonJobSummary;
  jobKinds: string[];
  instanceTimeZone: string;
};

export function JobOperations({
  initialLastRuns,
  initialSummary,
  jobKinds,
  instanceTimeZone,
}: Props) {
  const [summary, setSummary] = useState(initialSummary);
  const [lastRuns, setLastRuns] = useState(initialLastRuns);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const activeQueueCount =
    summary.statusCounts.queued + summary.statusCounts.running;
  const onlineWorkers = summary.workers.filter(
    (worker) => worker.status !== "stopped" && worker.status !== "stale",
  ).length;
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
    const source = new EventSource("/api/admin/jobs/state/stream");
    const onState = (event: Event) => {
      const state = JSON.parse(
        (event as MessageEvent<string>).data,
      ) as JsonJobState;
      setSummary(state.summary);
      setLastRuns(state.lastRuns);
    };
    source.addEventListener("state", onState);

    return () => {
      source.removeEventListener("state", onState);
      source.close();
    };
  }, []);

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="admin-jobs-page">
      <header className="admin-jobs-header">
        <h1>Jobs</h1>
        <div className="admin-jobs-summary" aria-label="Queue summary">
          <span>
            <strong>{summary.statusCounts.running}</strong> running
          </span>
          <span>
            <strong>{summary.statusCounts.queued}</strong> queued
          </span>
          <span className="admin-jobs-summary-danger">
            <strong>{summary.failed + summary.dead}</strong> failed
          </span>
          <span>
            <strong>{onlineWorkers}</strong> worker
            {onlineWorkers === 1 ? "" : "s"}
          </span>
          <span>
            oldest due{" "}
            <strong>{formatDuration(summary.oldestDueQueuedAgeSeconds)}</strong>
          </span>
          <span>
            active <strong>{activeQueueCount}</strong>
          </span>
        </div>
        <Link className="admin-jobs-schedule-link" href="/admin/settings">
          Schedule
        </Link>
      </header>

      <section className="admin-jobs-grid" aria-label="Background jobs">
        {jobKinds.map((kind) => {
          const lastRun = lastRuns[kind] ?? null;
          return (
            <JobTaskCard
              instanceTimeZone={instanceTimeZone}
              key={kind}
              kind={kind}
              lastRun={lastRun}
              nowMs={nowMs}
              onLastRunChange={(updatedKind, job) => {
                setLastRuns((current) => ({
                  ...current,
                  [updatedKind]: job,
                }));
              }}
              workerRunningJobIds={workerRunningJobIds}
            />
          );
        })}
      </section>
    </div>
  );
}
