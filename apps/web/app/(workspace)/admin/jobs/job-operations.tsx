"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { subscribeLive } from "@/lib/live-events";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import {
  formatAdminBytes,
  formatAdminDateTime,
} from "@/app/(workspace)/admin/admin-format";
import { AdminPanel } from "@/app/(workspace)/admin/admin-panel";
import { useTime } from "@/components/time-provider";
import { cn } from "@/lib/utils";
import type {
  JsonAdminMediaDerivativeRow,
  JsonAdminMediaDerivativeSummary,
} from "@/server/admin/media-derivatives";

import {
  JOB_NOTE,
  JOB_TONE_TEXT,
  JobDot,
  type JobTone,
  ModalHeading,
} from "./job-parts";
import {
  MediaDerivativeRowActions,
  type MediaDerivativeAction,
} from "./media-derivative-row-actions";

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

const JOB_META: Record<string, { name: string; desc: string }> = {
  "staging.cleanup": {
    name: "Clean temporary uploads",
    desc: "Remove expired temporary upload files from storage.",
  },
  "trash.retention": {
    name: "Empty trash",
    desc: "Permanently delete files that stayed in trash past the cleanup window.",
  },
  "update.check": {
    name: "Check for updates",
    desc: "Check GitHub for a new Staaash release.",
  },
  "restore.reconcile": {
    name: "Restore check",
    desc: "Check restored files against database records. Run after a restore.",
  },
  "media.derivative.generate": {
    name: "Create preview files",
    desc: "Create video preview files. One job is queued per file.",
  },
  "media.derivative.cleanup": {
    name: "Clean preview files",
    desc: "Remove stale or orphaned preview files from storage.",
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
const ACTIVITY_PAGE_SIZE = 25;

type ActivityFilter = "all" | "active" | "failed" | "done";
type ActivityView = "jobs" | "derivatives";

type MediaDerivativeActions = {
  regenerateDerivative: MediaDerivativeAction;
  setPinDerivative: MediaDerivativeAction;
  removeDerivative: MediaDerivativeAction;
  cancelDerivative: MediaDerivativeAction;
};

type JsonJobListResponse = {
  items: JsonBackgroundJob[];
  nextCursor: string | null;
  page: number;
  pageCount: number;
  pageSize: number;
  totalCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

const ACTIVITY_FILTER_LABELS: Record<ActivityFilter, string> = {
  all: "All",
  active: "Active",
  failed: "Failed",
  done: "Done",
};

const ACTIVITY_FILTER_STATUSES: Record<
  Exclude<ActivityFilter, "all">,
  JsonBackgroundJob["status"][]
> = {
  active: ["queued", "running"],
  failed: ["failed", "dead"],
  done: ["succeeded", "cancelled"],
};

function effectiveStatus(
  job: Pick<JsonBackgroundJob, "status" | "lastError">,
): JsonBackgroundJob["status"] {
  if (job.status === "dead" && job.lastError === "Cancelled by admin.") {
    return "cancelled";
  }
  return job.status;
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
  nowMs: number,
  timeZone: string,
  mode: "absolute" | "scheduled" = "absolute",
) {
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

function formatRelativeTime(dateStr: string, nowMs: number): string {
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
  nowMs: number;
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
    if (runAtMs > nowMs) {
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
  nowMs: number;
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

function buildJobsUrl({
  cursor,
  kind,
  limit = ACTIVITY_PAGE_SIZE,
  page = 1,
  status,
  statuses,
}: {
  cursor?: string | null;
  kind?: string | null;
  limit?: number;
  page?: number;
  status?: JsonBackgroundJob["status"] | null;
  statuses?: JsonBackgroundJob["status"][] | null;
}) {
  const params = new URLSearchParams({
    limit: String(limit),
    page: String(page),
  });
  if (cursor) params.set("cursor", cursor);
  if (kind) params.set("kind", kind);
  if (statuses?.length) {
    params.set("status", statuses.join(","));
  } else if (status) {
    params.set("status", status);
  }
  return `/api/admin/jobs?${params.toString()}`;
}

function sortJobsByUpdatedAt(jobs: JsonBackgroundJob[]) {
  return [...jobs].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime() || right.id.localeCompare(left.id),
  );
}

function mergeJobsById(
  current: JsonBackgroundJob[],
  incoming: JsonBackgroundJob[],
) {
  const byId = new Map<string, JsonBackgroundJob>();
  for (const job of [...current, ...incoming]) {
    byId.set(job.id, job);
  }
  return sortJobsByUpdatedAt([...byId.values()]);
}

async function fetchActivityJobs({
  filter,
  kind,
  page,
}: {
  filter: ActivityFilter;
  kind: string | null;
  page: number;
}) {
  const res = await fetch(
    buildJobsUrl({
      kind,
      page,
      statuses: filter === "all" ? null : ACTIVITY_FILTER_STATUSES[filter],
    }),
  );
  if (!res.ok) throw new Error(`Request failed (${res.status}).`);
  return (await res.json()) as JsonJobListResponse;
}

function getActivityDetail(job: JsonBackgroundJob) {
  if (job.lastError) return job.lastError;
  if (job.fileName) return job.fileName;
  if (job.dedupeKey) return job.dedupeKey;
  return job.id;
}

function getPayloadFileId(job: JsonBackgroundJob | null) {
  const payload = job?.payloadJson;
  if (!payload || typeof payload !== "object") return null;
  const fileId = (payload as { fileId?: unknown }).fileId;
  return typeof fileId === "string" ? fileId : null;
}

function formatBytesString(value: string | null) {
  return value ? formatAdminBytes(BigInt(value)) : "n/a";
}

function getDerivativeTone(status: string) {
  if (status === "ready") return "succeeded";
  if (status === "queued" || status === "processing") return "running";
  if (status === "failed") return "failed";
  return "idle";
}

function jobMatchesActivityView({
  filter,
  job,
  kind,
}: {
  filter: ActivityFilter;
  job: JsonBackgroundJob;
  kind: string | null;
}) {
  if (kind && job.kind !== kind) return false;
  if (filter === "all") return true;
  return ACTIVITY_FILTER_STATUSES[filter].includes(effectiveStatus(job));
}

type PaginationMarker = "start-ellipsis" | "end-ellipsis";
type PaginationItem = number | PaginationMarker;

function getPaginationItems(page: number, pageCount: number): PaginationItem[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const items: PaginationItem[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);

  if (start > 2) {
    items.push("start-ellipsis");
  } else {
    for (let pageNumber = 2; pageNumber < start; pageNumber += 1) {
      items.push(pageNumber);
    }
  }

  for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
    items.push(pageNumber);
  }

  if (end < pageCount - 1) {
    items.push("end-ellipsis");
  } else {
    for (let pageNumber = end + 1; pageNumber < pageCount; pageNumber += 1) {
      items.push(pageNumber);
    }
  }

  items.push(pageCount);
  return items;
}

function JsonBlock({ value }: { value: Record<string, unknown> | null }) {
  if (!value || Object.keys(value).length === 0) {
    return <p className={JOB_NOTE}>No payload recorded.</p>;
  }

  return (
    <pre className="m-0 max-h-45 overflow-auto rounded-md bg-hover p-2.5 font-mono text-xs leading-normal text-foreground md:text-meta">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function MediaDerivativeCard({
  actions,
  compact = false,
  derivative,
}: {
  actions: MediaDerivativeActions;
  compact?: boolean;
  derivative: JsonAdminMediaDerivativeRow;
}) {
  const tone = getDerivativeTone(derivative.status);
  const { timeZone } = useTime();

  return (
    <article
      className={cn(
        "grid grid-cols-[minmax(220px,0.85fr)_minmax(260px,1fr)_auto] items-center gap-3.5 rounded-lg border border-hairline bg-card p-3 max-lg:grid-cols-1",
        compact && "grid-cols-1",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <JobDot tone={tone} />
        <div className="grid min-w-0 grid-cols-1 gap-0.5">
          <strong className="truncate text-label font-semibold text-foreground md:text-meta">
            {derivative.originalName}
          </strong>
          <small className="truncate text-xs text-muted-foreground md:text-meta">
            {derivative.ownerLabel}
          </small>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-xs text-muted-foreground md:text-meta">
        <span
          className={cn(
            "inline-flex items-center gap-2 font-semibold capitalize",
            JOB_TONE_TEXT[tone],
          )}
        >
          {derivative.status}
        </span>
        {derivative.pinnedByAdmin ? <Badge size="sm">Pinned</Badge> : null}
        <span>{formatBytesString(derivative.originalSizeBytes)} original</span>
        <span>{formatBytesString(derivative.sizeBytes)} preview</span>
        <span>{formatAdminDateTime(derivative.generatedAt, timeZone)}</span>
      </div>

      {derivative.error ? (
        <p
          className="col-span-full m-0 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive-foreground md:text-meta"
          title={derivative.error}
        >
          {derivative.error.length > 120
            ? `${derivative.error.slice(0, 120)}...`
            : derivative.error}
        </p>
      ) : null}

      <MediaDerivativeRowActions
        cancelAction={actions.cancelDerivative}
        fileId={derivative.fileId}
        id={derivative.id}
        pinnedByAdmin={derivative.pinnedByAdmin}
        regenerateAction={actions.regenerateDerivative}
        removeAction={actions.removeDerivative}
        setPinAction={actions.setPinDerivative}
        status={derivative.status}
      />
    </article>
  );
}

function JobEventList({
  events,
  timeZone,
}: {
  events: JsonJobEvent[] | null;
  timeZone: string;
}) {
  if (events === null) {
    return <p className={JOB_NOTE}>Loading events...</p>;
  }

  if (events.length === 0) {
    return <p className={JOB_NOTE}>No events recorded.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-0">
      {events.map((event) => (
        <div
          className="grid grid-cols-[140px_minmax(0,1fr)] gap-3.5 border-b border-hairline py-2 text-label leading-snug last:border-b-0 max-md:grid-cols-1 max-md:gap-1 md:text-meta"
          key={event.id}
        >
          <span className="text-muted-foreground tabular-nums">
            {formatAdminDateTime(event.createdAt, timeZone)}
          </span>
          <span className="grid min-w-0 grid-cols-1 gap-0.5">
            <strong className="capitalize">{event.type}</strong>
            {event.message || event.workerId ? (
              <span className="wrap-anywhere text-muted-foreground">
                {event.message ?? event.workerId}
              </span>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function JobDetailsModal({
  actionError,
  derivativeActions,
  derivatives,
  events,
  history,
  historyLoading,
  timeZone,
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
  derivativeActions: MediaDerivativeActions;
  derivatives: JsonAdminMediaDerivativeRow[];
  events: JsonJobEvent[] | null;
  history: JsonBackgroundJob[] | null;
  historyLoading: boolean;
  timeZone: string;
  jobName: string;
  nowMs: number;
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
  const selectedFileId = getPayloadFileId(selectedHistoryJob);
  const selectedDerivative = selectedFileId
    ? (derivatives.find((row) => row.fileId === selectedFileId) ?? null)
    : null;

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogPopup className="max-h-[min(760px,calc(100dvh-3rem))] max-w-230 overflow-hidden">
        <DialogHeader className="flex-row items-start justify-between gap-4.5 border-b border-hairline pr-14 max-md:flex-col">
          <div className="min-w-0">
            <DialogTitle>{jobName}</DialogTitle>
            {selectedHistoryJob ? (
              <DialogDescription className="mt-1.5 md:text-meta">
                {getJobStateLine({
                  job: selectedHistoryJob,
                  nowMs,
                  status: selectedStatus,
                  timeZone,
                })}
              </DialogDescription>
            ) : null}
          </div>
          {selectedStatus ? (
            <span
              className={cn(
                "inline-flex items-center gap-2 text-label font-semibold capitalize md:text-meta",
                JOB_TONE_TEXT[selectedTone],
              )}
            >
              <JobDot tone={selectedTone} />
              {selectedStatus}
            </span>
          ) : null}
        </DialogHeader>

        {actionError ? (
          <div className="px-6 pt-4">
            <Alert variant="error">{actionError}</Alert>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(210px,0.38fr)_minmax(0,1fr)] gap-0 overflow-hidden max-md:grid-cols-1 max-md:overflow-y-auto">
          <section
            className="min-h-0 overflow-y-auto border-r border-hairline bg-hover p-4.5 max-md:max-h-55 max-md:border-r-0 max-md:border-b max-md:p-4"
            aria-label="Recent runs"
          >
            <ModalHeading>Recent runs</ModalHeading>
            {historyLoading ? (
              <p className={JOB_NOTE}>Loading runs...</p>
            ) : history && history.length > 0 ? (
              <div className="grid grid-cols-1 gap-1">
                {history.slice(0, HISTORY_VISIBLE_RUNS).map((job) => {
                  const status = getJobDisplayStatus(job, workerRunningJobIds);
                  const tone = getJobTone(status);
                  const selected = selectedHistoryJob?.id === job.id;

                  return (
                    <button
                      aria-pressed={selected}
                      className={cn(
                        "grid min-h-11 w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-lg p-2 text-left outline-none hover:bg-selected focus-visible:ring-2 focus-visible:ring-ring/60",
                        selected && "bg-selected",
                      )}
                      key={job.id}
                      onClick={() => onSelectHistoryJob(job.id)}
                      type="button"
                    >
                      <JobDot tone={tone} />
                      <span>
                        <strong className="block text-label font-medium capitalize md:text-body">
                          {status}
                        </strong>
                        <small className="block text-xs text-muted-foreground md:text-meta">
                          {formatRelativeTime(job.updatedAt, nowMs)}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className={JOB_NOTE}>No runs recorded yet.</p>
            )}
          </section>

          <section className="grid min-h-0 grid-cols-1 content-start gap-4.5 overflow-y-auto p-4.5 pb-5.5 max-md:p-4 max-md:pb-7">
            {selectedHistoryJob ? (
              <>
                {selectedHistoryJob.lastError ? (
                  <div className="grid grid-cols-1 gap-2">
                    <ModalHeading>Error</ModalHeading>
                    <Alert variant="error">
                      {selectedHistoryJob.lastError}
                    </Alert>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-2">
                  <ModalHeading>Events</ModalHeading>
                  <JobEventList events={events} timeZone={timeZone} />
                </div>

                {selectedFileId ? (
                  <div className="grid grid-cols-1 gap-2">
                    <ModalHeading>Preview file</ModalHeading>
                    {selectedDerivative ? (
                      <MediaDerivativeCard
                        actions={derivativeActions}
                        compact
                        derivative={selectedDerivative}
                      />
                    ) : (
                      <p className={JOB_NOTE}>
                        No preview file record found for this file.
                      </p>
                    )}
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-2">
                  <ModalHeading>Payload</ModalHeading>
                  <JsonBlock value={selectedHistoryJob.payloadJson} />
                </div>

                <div className="flex flex-wrap gap-2">
                  {selectedHistoryJob.status === "failed" ||
                  selectedHistoryJob.status === "dead" ||
                  selectedHistoryJob.status === "cancelled" ? (
                    <Button
                      onClick={() =>
                        onJobAction(selectedHistoryJob.id, "retry")
                      }
                    >
                      Retry
                    </Button>
                  ) : null}
                  {selectedHistoryJob.status === "queued" ||
                  selectedHistoryJob.status === "running" ? (
                    <Button
                      variant="destructive"
                      onClick={() =>
                        onJobAction(selectedHistoryJob.id, "cancel")
                      }
                    >
                      Cancel
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(selectedHistoryJob.id);
                    }}
                  >
                    Copy ID
                  </Button>
                </div>
              </>
            ) : (
              <p className={JOB_NOTE}>No run selected.</p>
            )}
          </section>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function JobTaskCard({
  derivativeActions,
  derivatives,
  timeZone,
  kind,
  lastRun,
  nowMs,
  onLastRunChange,
  workerRunningJobIds,
}: {
  derivativeActions: MediaDerivativeActions;
  derivatives: JsonAdminMediaDerivativeRow[];
  timeZone: string;
  kind: string;
  lastRun: JsonBackgroundJob | null;
  nowMs: number;
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
    <article className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 first:border-t-0">
      <div className="grid min-w-0 flex-1 basis-80 gap-0.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <JobDot tone={tone} />
          <h2 className="m-0 min-w-0 font-sans text-body font-semibold wrap-anywhere">
            {jobName}
          </h2>
        </div>
        <p className="m-0 max-w-[70ch] text-meta text-muted-foreground">
          {jobDescription}
        </p>
        <p className={cn("m-0 text-meta", JOB_TONE_TEXT[tone])}>
          {getJobLastFact({ job: lastRun, nowMs, status: displayStatus })}
          {runError ? (
            <span className="text-destructive-foreground"> {runError}</span>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {primaryActionIsCommand ? (
          <Button
            disabled={running}
            loading={running}
            size="sm"
            variant="outline"
            onClick={() => void handlePrimaryAction()}
          >
            {primaryActionLabel}
          </Button>
        ) : (
          <span className="px-2 text-meta text-muted-foreground">
            {primaryActionLabel}
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={() => void openDetails()}>
          Details
        </Button>
      </div>

      <JobDetailsModal
        actionError={actionError}
        derivativeActions={derivativeActions}
        derivatives={derivatives}
        events={events}
        history={history}
        historyLoading={historyLoading}
        timeZone={timeZone}
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

function ActivityPagination({
  disabled,
  pagination,
  onPageChange,
}: {
  disabled: boolean;
  pagination: Omit<JsonJobListResponse, "items" | "nextCursor">;
  onPageChange: (page: number) => void;
}) {
  const safePageCount = Math.max(pagination.pageCount, 1);
  const page = Math.min(Math.max(pagination.page, 1), safePageCount);
  const firstItem =
    pagination.totalCount === 0 ? 0 : (page - 1) * pagination.pageSize + 1;
  const lastItem = Math.min(pagination.totalCount, page * pagination.pageSize);
  const pageItems = getPaginationItems(page, pagination.pageCount);
  const canGoBack = pagination.hasPreviousPage && !disabled;
  const canGoForward = pagination.hasNextPage && !disabled;

  return (
    <nav
      className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-hover px-2.5 py-2 max-md:grid"
      aria-label="Activity pagination"
    >
      <p className="m-0 text-xs font-semibold whitespace-nowrap text-muted-foreground max-md:whitespace-normal md:text-label">
        Showing {firstItem}-{lastItem} of {pagination.totalCount} logs
      </p>
      {pagination.pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-end gap-1 max-md:justify-start">
          <Button
            aria-label="First page"
            disabled={!canGoBack}
            onClick={() => onPageChange(1)}
            size="icon-xs"
            title="First page"
            variant="outline"
          >
            <ChevronsLeft aria-hidden />
          </Button>
          <Button
            aria-label="Previous page"
            disabled={!canGoBack}
            onClick={() => onPageChange(page - 1)}
            size="icon-xs"
            title="Previous page"
            variant="outline"
          >
            <ChevronLeft aria-hidden />
          </Button>
          {pageItems.map((item) =>
            typeof item === "number" ? (
              <Button
                aria-current={item === page ? "page" : undefined}
                disabled={disabled}
                key={item}
                onClick={() => {
                  if (item !== page) onPageChange(item);
                }}
                size="xs"
                variant={item === page ? "secondary" : "outline"}
              >
                {item}
              </Button>
            ) : (
              <span
                aria-hidden
                className="min-w-5.5 text-center text-label font-semibold text-muted-foreground"
                key={item}
              >
                ...
              </span>
            ),
          )}
          <Button
            aria-label="Next page"
            disabled={!canGoForward}
            onClick={() => onPageChange(page + 1)}
            size="icon-xs"
            title="Next page"
            variant="outline"
          >
            <ChevronRight aria-hidden />
          </Button>
          <Button
            aria-label="Last page"
            disabled={!canGoForward}
            onClick={() => onPageChange(pagination.pageCount)}
            size="icon-xs"
            title="Last page"
            variant="outline"
          >
            <ChevronsRight aria-hidden />
          </Button>
        </div>
      ) : null}
    </nav>
  );
}

// fallow-ignore-next-line complexity
function JobActivityPanel({
  derivativeActions,
  derivatives,
  timeZone,
  jobKinds,
  liveJobs,
  nowMs,
  onLastRunChange,
  workerRunningJobIds,
}: {
  derivativeActions: MediaDerivativeActions;
  derivatives: JsonAdminMediaDerivativeSummary;
  timeZone: string;
  jobKinds: string[];
  liveJobs: JsonBackgroundJob[];
  nowMs: number;
  onLastRunChange: (kind: string, job: JsonBackgroundJob | null) => void;
  workerRunningJobIds: Set<string>;
}) {
  const router = useRouter();
  const [view, setView] = useState<ActivityView>("jobs");
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [items, setItems] = useState<JsonBackgroundJob[]>([]);
  const [activityPage, setActivityPage] = useState(1);
  const [pagination, setPagination] = useState<
    Omit<JsonJobListResponse, "items" | "nextCursor">
  >({
    page: 1,
    pageCount: 0,
    pageSize: ACTIVITY_PAGE_SIZE,
    totalCount: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedKind, setSelectedKind] = useState<string | null>(null);
  const [history, setHistory] = useState<JsonBackgroundJob[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryJobId, setSelectedHistoryJobId] = useState<
    string | null
  >(null);
  const [events, setEvents] = useState<JsonJobEvent[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedHistoryJob =
    history?.find((job) => job.id === selectedHistoryJobId) ??
    history?.[0] ??
    items.find((job) => job.id === selectedHistoryJobId) ??
    null;

  const kindFilterOptions = useMemo(
    () => [
      { label: "All jobs", value: "all" },
      ...jobKinds.map((kind) => ({ label: formatJobKind(kind), value: kind })),
    ],
    [jobKinds],
  );
  const activityKind = kindFilter === "all" ? null : kindFilter;
  const isInitialActivityLoad = loading && items.length === 0;
  const applyActivityData = useCallback(
    (data: JsonJobListResponse) => {
      setItems(data.items);
      setPagination({
        page: data.page,
        pageCount: data.pageCount,
        pageSize: data.pageSize,
        totalCount: data.totalCount,
        hasNextPage: data.hasNextPage,
        hasPreviousPage: data.hasPreviousPage,
      });
      if (data.page !== activityPage) {
        setActivityPage(data.page);
      }
    },
    [activityPage],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void fetchActivityJobs({ filter, kind: activityKind, page: activityPage })
      .then((data) => {
        if (cancelled) return;
        applyActivityData(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Failed to load jobs.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activityKind, activityPage, applyActivityData, filter]);

  useEffect(() => {
    if (activityPage !== 1 || liveJobs.length === 0) return;

    setItems((current) => {
      const liveJobIds = new Set(liveJobs.map((job) => job.id));
      const visibleLiveJobs = liveJobs.filter((job) =>
        jobMatchesActivityView({ filter, job, kind: activityKind }),
      );
      const visibleLiveJobIds = new Set(visibleLiveJobs.map((job) => job.id));

      return mergeJobsById(
        current.filter(
          (job) => !liveJobIds.has(job.id) || visibleLiveJobIds.has(job.id),
        ),
        visibleLiveJobs,
      ).slice(0, pagination.pageSize);
    });
  }, [activityKind, activityPage, filter, liveJobs, pagination.pageSize]);

  useEffect(() => {
    if (!selectedHistoryJobId || liveJobs.length === 0) return;
    const liveSelectedJob = liveJobs.find(
      (job) => job.id === selectedHistoryJobId,
    );
    if (!liveSelectedJob) return;

    setHistory((current) =>
      current ? mergeJobsById(current, [liveSelectedJob]) : current,
    );
  }, [liveJobs, selectedHistoryJobId]);

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

  const refreshActivity = async () => {
    const data = await fetchActivityJobs({
      filter,
      kind: activityKind,
      page: activityPage,
    });
    applyActivityData(data);
  };

  const refreshHistory = async (kind: string, selectedJobId?: string) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(buildJobsUrl({ kind, limit: 100 }));
      if (!res.ok) return;
      const data = (await res.json()) as JsonJobListResponse;
      const nextSelectedJobId =
        selectedJobId && data.items.some((job) => job.id === selectedJobId)
          ? selectedJobId
          : (data.items[0]?.id ?? null);

      setHistory(data.items);
      onLastRunChange(
        kind,
        selectRepresentativeJob(data.items, workerRunningJobIds),
      );
      setSelectedHistoryJobId(nextSelectedJobId);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openDetails = async (job: JsonBackgroundJob) => {
    setActionError(null);
    setDetailsOpen(true);
    setSelectedKind(job.kind);
    setHistory([job]);
    setSelectedHistoryJobId(job.id);
    await refreshHistory(job.kind, job.id);
  };

  const postJobAction = async (jobId: string, action: "retry" | "cancel") => {
    if (!selectedKind) return;
    setActionError(null);
    const res = await fetch(`/api/admin/jobs/${jobId}/${action}`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setActionError(body?.error ?? `Request failed (${res.status}).`);
      return;
    }
    await Promise.all([refreshActivity(), refreshHistory(selectedKind, jobId)]);
  };

  return (
    <AdminPanel
      className="gap-3.5 p-4.5 max-md:p-3.5"
      aria-label="Job activity"
    >
      <div className="flex flex-wrap items-start justify-between gap-4.5 max-md:grid">
        <div className="min-w-0 flex-[1_1_280px]">
          <h2 className="m-0 font-sans text-base leading-tight font-semibold">
            {view === "jobs" ? "Job activity" : "Preview files"}
          </h2>
          <p className="m-0 mt-1.5 text-label leading-normal text-muted-foreground md:text-meta">
            {view === "jobs"
              ? "Recent queued, running, failed, and completed work."
              : "Generated preview files, pins, cleanup state, and manual recovery."}
          </p>
        </div>
        <div className="flex min-w-0 flex-[1_1_420px] flex-wrap items-start justify-end gap-2.5 max-md:grid max-md:justify-stretch">
          <ToggleGroup
            className="max-w-full max-md:w-full"
            onValueChange={(value) => {
              const next = value[0] as ActivityView | undefined;
              if (next) setView(next);
            }}
            value={[view]}
            variant="outline"
          >
            <ToggleGroupItem className="max-md:flex-1" value="jobs">
              Jobs
            </ToggleGroupItem>
            <ToggleGroupItem className="max-md:flex-1" value="derivatives">
              Preview files
            </ToggleGroupItem>
          </ToggleGroup>

          {view === "jobs" ? (
            <>
              <ToggleGroup
                className="max-w-full max-md:w-full"
                onValueChange={(value) => {
                  const next = value[0] as ActivityFilter | undefined;
                  if (!next) return;
                  setFilter(next);
                  setActivityPage(1);
                }}
                value={[filter]}
                variant="outline"
              >
                {(Object.keys(ACTIVITY_FILTER_LABELS) as ActivityFilter[]).map(
                  (value) => (
                    <ToggleGroupItem
                      className="max-md:flex-1"
                      key={value}
                      value={value}
                    >
                      {ACTIVITY_FILTER_LABELS[value]}
                    </ToggleGroupItem>
                  ),
                )}
              </ToggleGroup>
              <div className="grid w-[min(196px,100%)] min-w-40 flex-[0_1_196px] grid-cols-1 gap-0 max-md:w-full">
                <Select
                  items={kindFilterOptions}
                  onValueChange={(value) => {
                    setKindFilter(value ?? "all");
                    setActivityPage(1);
                  }}
                  value={kindFilter}
                >
                  <SelectTrigger aria-label="Job type">
                    <SelectValue placeholder="Job type" />
                  </SelectTrigger>
                  <SelectContent align="end" alignItemWithTrigger={false}>
                    <SelectGroup>
                      {kindFilterOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <Button variant="secondary" onClick={() => router.refresh()}>
              Refresh
            </Button>
          )}
        </div>
      </div>

      {view === "derivatives" ? (
        <div className="grid grid-cols-1 gap-2.5">
          {derivatives.deletedCount > 0 ? (
            <p className="m-0 rounded-lg border border-hairline bg-hover px-3 py-2.5 text-label leading-normal text-muted-foreground md:text-meta">
              {derivatives.deletedCount} preview file
              {derivatives.deletedCount === 1 ? "" : "s"} for deleted files are
              hidden and will be cleaned up automatically.
            </p>
          ) : null}
          {derivatives.rows.length > 0 ? (
            derivatives.rows.map((derivative) => (
              <MediaDerivativeCard
                actions={derivativeActions}
                derivative={derivative}
                key={derivative.id}
              />
            ))
          ) : (
            <p className={cn(JOB_NOTE, "p-4.5")}>No preview files yet.</p>
          )}
        </div>
      ) : (
        <>
          {loadError ? <Alert variant="error">{loadError}</Alert> : null}

          <div className="grid min-h-13.5 grid-cols-1 gap-0 overflow-hidden rounded-lg border border-hairline">
            {isInitialActivityLoad ? (
              <p className={cn(JOB_NOTE, "p-4.5")}>Loading activity...</p>
            ) : items.length > 0 ? (
              <>
                {loading ? (
                  <p className="m-0 border-b border-hairline bg-hover px-3 py-1.5 text-label font-medium text-muted-foreground">
                    Updating...
                  </p>
                ) : null}
                {items.map((job) => {
                  const status = getJobDisplayStatus(job, workerRunningJobIds);
                  const tone = getJobTone(status);

                  return (
                    <button
                      className="grid min-h-13.5 w-full cursor-pointer grid-cols-[auto_minmax(220px,1.1fr)_88px_72px_minmax(180px,1fr)] items-center gap-3 border-b border-hairline px-3 py-2.5 text-left outline-none last:border-b-0 hover:bg-selected focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset max-md:min-h-17 max-md:grid-cols-[auto_minmax(0,1fr)_auto] max-md:gap-x-2.5 max-md:gap-y-2 md:min-h-control"
                      key={job.id}
                      onClick={() => void openDetails(job)}
                      type="button"
                    >
                      <JobDot tone={tone} />
                      <span className="grid min-w-0 grid-cols-1 gap-1">
                        <strong className="truncate text-label font-semibold md:text-body">
                          {formatJobKind(job.kind)}
                        </strong>
                        <small className="truncate text-xs font-medium text-muted-foreground md:text-meta">
                          {getJobStateLine({
                            job,
                            nowMs,
                            status,
                            timeZone,
                          })}
                        </small>
                      </span>
                      <span
                        className={cn(
                          "text-xs font-semibold capitalize max-md:justify-self-end md:text-meta",
                          JOB_TONE_TEXT[tone],
                        )}
                      >
                        {status}
                      </span>
                      <span className="text-xs font-semibold text-muted-foreground tabular-nums max-md:col-[2/3] md:text-meta">
                        {job.attemptCount}/{job.maxAttempts}
                      </span>
                      <span className="truncate text-xs text-muted-foreground max-md:col-[2/4] max-md:whitespace-normal md:text-meta">
                        {getActivityDetail(job)}
                      </span>
                    </button>
                  );
                })}
              </>
            ) : (
              <p className={cn(JOB_NOTE, "p-4.5")}>No jobs match this view.</p>
            )}
          </div>

          {pagination.totalCount > 0 ? (
            <ActivityPagination
              disabled={loading}
              onPageChange={setActivityPage}
              pagination={pagination}
            />
          ) : null}
        </>
      )}

      <JobDetailsModal
        actionError={actionError}
        derivativeActions={derivativeActions}
        derivatives={derivatives.rows}
        events={events}
        history={history}
        historyLoading={historyLoading}
        timeZone={timeZone}
        jobName={selectedKind ? formatJobKind(selectedKind) : "Job"}
        nowMs={nowMs}
        onJobAction={(jobId, action) => void postJobAction(jobId, action)}
        onSelectHistoryJob={setSelectedHistoryJobId}
        open={detailsOpen}
        selectedHistoryJob={selectedHistoryJob}
        setOpen={setDetailsOpen}
        workerRunningJobIds={workerRunningJobIds}
      />
    </AdminPanel>
  );
}

type Props = {
  derivativeActions: MediaDerivativeActions;
  initialDerivatives: JsonAdminMediaDerivativeSummary;
  initialLastRuns: Record<string, JsonBackgroundJob | null>;
  initialSummary: JsonJobSummary;
  jobKinds: string[];
};

export function JobOperations({
  derivativeActions,
  initialDerivatives,
  initialLastRuns,
  initialSummary,
  jobKinds,
}: Props) {
  const [summary, setSummary] = useState(initialSummary);
  const [lastRuns, setLastRuns] = useState(initialLastRuns);
  const { now, timeZone } = useTime();
  const [nowMs, setNowMs] = useState(() => now.getTime());
  const failedCount = summary.failed + summary.dead;
  const oldestDueLabel = formatDuration(summary.oldestDueQueuedAgeSeconds);
  const onlineWorkers = summary.workers.filter(
    (worker) => worker.status !== "stopped" && worker.status !== "stale",
  ).length;
  const workerNoun = onlineWorkers === 1 ? "worker" : "workers";
  const workerLabel = `${onlineWorkers} ${workerNoun}`;
  const queueSummaryLabel = [
    `${summary.statusCounts.running} running`,
    `${summary.statusCounts.queued} waiting`,
    `${failedCount} failed`,
    `${workerLabel} online`,
    summary.oldestDueQueuedAgeSeconds
      ? `oldest waiting ${oldestDueLabel}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
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
  const liveJobs = useMemo(
    () =>
      Object.values(lastRuns).filter(
        (job): job is JsonBackgroundJob => job !== null,
      ),
    [lastRuns],
  );

  useEffect(
    () =>
      subscribeLive("state", (data) => {
        const state = data as JsonJobState;
        setSummary(state.summary);
        setLastRuns(state.lastRuns);
      }),
    [],
  );

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="grid w-full max-w-6xl grid-cols-1 content-start gap-6">
      <PageHeader
        actions={
          <Button render={<Link href="/admin/settings" />} variant="outline">
            Schedule
          </Button>
        }
        description={queueSummaryLabel}
        title="Jobs"
      />

      <section
        aria-label="Background jobs"
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        {jobKinds.map((kind) => {
          const lastRun = lastRuns[kind] ?? null;
          return (
            <JobTaskCard
              derivativeActions={derivativeActions}
              derivatives={initialDerivatives.rows}
              timeZone={timeZone}
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

      <JobActivityPanel
        derivativeActions={derivativeActions}
        derivatives={initialDerivatives}
        timeZone={timeZone}
        jobKinds={jobKinds}
        liveJobs={liveJobs}
        nowMs={nowMs}
        onLastRunChange={(updatedKind, job) => {
          setLastRuns((current) => ({
            ...current,
            [updatedKind]: job,
          }));
        }}
        workerRunningJobIds={workerRunningJobIds}
      />
    </div>
  );
}
