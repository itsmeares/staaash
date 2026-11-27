import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Archive,
  ArchiveX,
  ChevronDown,
  Clapperboard,
  CloudDownload,
  Copy,
  Film,
  ScanSearch,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";

import { Alert } from "@staaash/ui/components/alert";
import { Badge } from "@staaash/ui/components/badge";
import { Button } from "@staaash/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@staaash/ui/components/dialog";
import { Tabs, TabsList, TabsTab } from "@staaash/ui/components/tabs";
import { toastManager } from "@staaash/ui/components/toast";
import { cn } from "@staaash/ui/utils";
import { PageHeader } from "@/components/page-header";
import { useTime } from "@/components/time-provider";
import { copyText } from "@/lib/clipboard";
import { subscribeLive } from "@/lib/live-events";

import { AdminPage } from "../admin-panel";
import { JOB_NOTE, JobDot, type JobTone } from "./job-parts";
import {
  describeJobFailure,
  collectProblemJobIds,
  applyProblemJobAction,
  applyProblemJobActions,
} from "./job-problems";

type JsonBackgroundJob = {
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
  ownerName?: string | null;
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
  problems: JsonBackgroundJob[];
};

type JsonJobEvent = {
  id: string;
  type: string;
  message: string | null;
  metadataJson: Record<string, unknown>;
  workerId: string | null;
  createdAt: string;
};

const GROUPS = ["Clean up", "Make", "Check"] as const;

const JOB_META: Record<
  string,
  {
    name: string;
    desc: string;
    /** What the row says before the first run. */
    idle?: string;
    icon: LucideIcon;
    group: (typeof GROUPS)[number];
  }
> = {
  "staging.cleanup": {
    name: "Clean temporary uploads",
    desc: "Removes unfinished uploads after they expire.",
    icon: Upload,
    group: "Clean up",
  },
  "trash.retention": {
    name: "Empty trash",
    desc: "Deletes files that stayed in trash past the cleanup window.",
    icon: Trash2,
    group: "Clean up",
  },
  "media.derivative.cleanup": {
    name: "Clean preview files",
    desc: "Removes old preview files and ones whose video is gone.",
    icon: Film,
    group: "Clean up",
  },
  "zip.archive.cleanup": {
    name: "Clean zip files",
    desc: "Removes download zips after they expire.",
    icon: ArchiveX,
    group: "Clean up",
  },
  "media.derivative.generate": {
    name: "Create preview files",
    desc: "Makes a preview of each uploaded video, one run per video.",
    idle: "Makes a preview when someone uploads a video. None yet.",
    icon: Clapperboard,
    group: "Make",
  },
  "update.check": {
    name: "Check for updates",
    desc: "Checks GitHub for a new Staaash release.",
    icon: CloudDownload,
    group: "Check",
  },
  "restore.reconcile": {
    name: "Restore check",
    desc: "Checks restored files against the database. Run it after a restore.",
    icon: ScanSearch,
    group: "Check",
  },
  "file.text.read": {
    name: "Read words in files",
    desc: "Read the text inside files for search and AI apps, and scan pages that are pictures.",
  },
};

const MANUAL_RUN_JOB_KINDS = new Set([
  "staging.cleanup",
  "trash.retention",
  "update.check",
  "restore.reconcile",
]);

const CLOCK_TICK_MS = 1000;
const HISTORY_VISIBLE_RUNS = 20;
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
    // The worker can report a claim before the list shows it, never after it ends.
    jobs.find(
      (job) => !isFinishedJob(job) && workerRunningJobIds.has(job.id),
    ) ??
    jobs.find((job) => job.status === "running") ??
    jobs.find((job) => job.status === "queued" && new Date(job.runAt) <= now) ??
    // A dismissed or cancelled run says less than the last real one.
    jobs.find((job) => isFinishedJob(job) && job.status !== "cancelled") ??
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

const isRetrying = (job: JsonBackgroundJob | null) =>
  job?.status === "queued" && job.attemptCount > 0 && Boolean(job.lastError);

const reasonOf = (error: string | null) => {
  const first = error?.split(/(?<=\.)\s/)[0]?.trim();
  if (!first) return "";
  const short = first.length > 90 ? `${first.slice(0, 89)}…` : first;
  return ` ${short}${/[.!?…]$/.test(short) ? "" : "."}`;
};

const times = (count: number) => (count === 1 ? "once" : `${count} times`);

// One plain sentence per job state.
// fallow-ignore-next-line complexity
function getJobSentence({
  job,
  kind,
  nowMs,
  status,
  timeZone,
}: {
  job: JsonBackgroundJob | null;
  kind: string;
  nowMs: number;
  status: JsonBackgroundJob["status"] | null;
  timeZone: string;
}) {
  if (!job || !status) return JOB_META[kind]?.idle ?? "Hasn't run yet.";
  const when = (value: string | null | undefined) =>
    formatTimelineDate(value ?? job.updatedAt, nowMs, timeZone, "scheduled");
  if (status === "dead") {
    return `Gave up after ${job.attemptCount} tries.${reasonOf(job.lastError)}`;
  }
  if (status === "failed") {
    return `Failed ${when(job.completedAt)}.${reasonOf(job.lastError)}`;
  }
  if (status === "running") {
    return `Running since ${when(job.startedAt ?? job.lockedAt)}.`;
  }
  if (isRetrying(job)) {
    return `Failed ${times(job.attemptCount)}.${reasonOf(job.lastError)} Tries again ${when(job.runAt)}.`;
  }
  if (status === "queued") {
    return new Date(job.runAt).getTime() > nowMs
      ? `Runs ${when(job.runAt)}.`
      : "Waiting to start.";
  }
  if (status === "cancelled") {
    return `Cancelled ${when(job.cancelledAt)}.`;
  }
  return `Ran fine ${when(job.completedAt)}.`;
}

function JobSentence({
  error,
  ...state
}: Parameters<typeof getJobSentence>[0] & { error: string | null }) {
  const alarming =
    getJobTone(state.status) === "failed" || isRetrying(state.job) || error;
  return (
    <p
      className={cn(
        "m-0 text-meta",
        alarming ? "text-destructive-foreground" : "text-muted-foreground",
      )}
    >
      {getJobSentence(state)}
      {error ? ` ${error}` : null}
    </p>
  );
}

const PREVIEW_KIND = "media.derivative.generate";

const tries = (count: number) => `${count} ${count === 1 ? "try" : "tries"}`;

const plural = (count: number, word: string) =>
  `${count} ${count === 1 ? word : `${word}s`}`;

/** The first sentence of why a run failed, without its full stop. */
const shortReason = (job: JsonBackgroundJob) => {
  const first =
    describeJobFailure(job)
      .split(/(?<=\.)\s/)[0]
      ?.trim() ?? "";
  const short = first.length > 90 ? `${first.slice(0, 89)}…` : first;
  return short.replace(/\.$/, "");
};

// One short title per run state, plus the reason when it failed.
// fallow-ignore-next-line complexity
function runTitle(
  job: JsonBackgroundJob,
  status: JsonBackgroundJob["status"],
  nowMs: number,
  timeZone: string,
): { what: string; why?: string } {
  const when = (value: string) =>
    formatTimelineDate(value, nowMs, timeZone, "scheduled");
  if (status === "dead") {
    return {
      // Retry keeps the try count, so more tries than allowed means an admin
      // retried it after it gave up.
      what:
        job.attemptCount > job.maxAttempts
          ? "Failed again after a retry"
          : `Gave up after ${tries(job.attemptCount)}`,
      why: shortReason(job),
    };
  }
  if (status === "failed") return { what: "Failed", why: shortReason(job) };
  if (status === "running") return { what: "Running" };
  if (isRetrying(job)) {
    return {
      what: `Failed ${times(job.attemptCount)}, tries again ${when(job.runAt)}`,
      why: shortReason(job),
    };
  }
  if (status === "queued") {
    return {
      what:
        new Date(job.runAt).getTime() > nowMs
          ? `Runs ${when(job.runAt)}`
          : "Waiting to start",
    };
  }
  if (status === "cancelled") {
    // A dismissed run keeps the error it failed with.
    return job.lastError && job.lastError !== "Cancelled by admin."
      ? { what: "Dismissed", why: shortReason(job) }
      : { what: "Cancelled" };
  }
  return { what: job.kind === PREVIEW_KIND ? "Made a preview" : "Ran fine" };
}

const formatDuration = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 1) return "under a second";
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

const ownerPart = (job: JsonBackgroundJob) =>
  job.kind === PREVIEW_KIND
    ? [job.ownerName ? `${job.ownerName}'s file` : "A deleted file"]
    : [];

// startedAt is the first try, so after more tries the gap counts the waits.
const tookPart = ({
  attemptCount,
  startedAt,
  completedAt,
}: JsonBackgroundJob) =>
  attemptCount === 1 && startedAt && completedAt
    ? [
        `took ${formatDuration(
          new Date(completedAt).getTime() - new Date(startedAt).getTime(),
        )}`,
      ]
    : [];

/** Whose file it was (previews only), when it ended and how long it took. */
const runMeta = (job: JsonBackgroundJob, nowMs: number, timeZone: string) => {
  const at = job.completedAt ?? job.cancelledAt ?? job.startedAt;
  return [
    ...ownerPart(job),
    ...(at ? [formatTimelineDate(at, nowMs, timeZone, "scheduled")] : []),
    ...tookPart(job),
  ].join(" · ");
};

function RunText({
  job,
  nowMs,
  status,
  timeZone,
}: {
  job: JsonBackgroundJob;
  nowMs: number;
  status: JsonBackgroundJob["status"];
  timeZone: string;
}) {
  const { what, why } = runTitle(job, status, nowMs, timeZone);
  const meta = runMeta(job, nowMs, timeZone);
  return (
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span className="text-body wrap-anywhere">
        {what}
        {why ? <span className="text-muted-foreground"> · {why}</span> : null}
      </span>
      {meta ? (
        <span className="text-meta text-muted-foreground">{meta}</span>
      ) : null}
    </span>
  );
}

const withoutStop = (message: string | null) =>
  message?.trim().replace(/\.$/, "") || "Failed";

/** Each recorded step as a plain sentence; null hides the step. */
const EVENT_SENTENCES: Record<
  string,
  (event: JsonJobEvent, clock: (iso: string) => string) => string | null
> = {
  queued: () => "Added to the queue.",
  claimed: () => "Started.",
  started: () => null,
  succeeded: () => "Finished.",
  retry_scheduled: (event, clock) => {
    const next = event.metadataJson.nextRunAt;
    return `${withoutStop(event.message)}. Tries again${
      typeof next === "string" ? ` at ${clock(next)}` : ""
    }.`;
  },
  dead: (event) => {
    const count = event.metadataJson.attemptCount;
    return `${withoutStop(event.message)}. Gave up${
      typeof count === "number" ? ` after ${tries(count)}` : ""
    }.`;
  },
  failed: (event) => `${withoutStop(event.message)}. Stopped.`,
  cancelled: () => "Cancelled by an admin.",
  cancel_ack: () => "The worker stopped.",
  retry_requested: () => "An admin asked for a retry.",
  dismissed: () => "An admin dismissed it.",
};

const eventSentence = (event: JsonJobEvent, clock: (iso: string) => string) =>
  event.type in EVENT_SENTENCES
    ? EVENT_SENTENCES[event.type]!(event, clock)
    : (event.message ?? event.type);

/**
 * A run's recorded steps, loaded when its row opens and again whenever the
 * run changes, so a cancel or retry shows up in the story.
 */
function useRunEvents(jobId: string, version: string) {
  const [events, setEvents] = useState<JsonJobEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setLoading(true);
    void fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}/events`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { items: JsonJobEvent[] };
        if (!cancelled) setEvents(data.items);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, version, attempt]);
  // Steps shown during a reload may be out of date, so copying waits.
  const ready = !loading && !failed ? events : null;
  return { events, failed, ready, retry: () => setAttempt((n) => n + 1) };
}

const copyRunDetails = async (
  job: JsonBackgroundJob,
  events: JsonJobEvent[],
) => {
  const details = {
    id: job.id,
    kind: job.kind,
    status: job.status,
    attempts: `${job.attemptCount} of ${job.maxAttempts}`,
    lastError: job.lastError,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    completedAt: job.completedAt ?? null,
    events: events.map((event) => ({
      at: event.createdAt,
      type: event.type,
      message: event.message,
    })),
  };
  try {
    await copyText(JSON.stringify(details, null, 2));
    toastManager.add({ title: "Details copied.", type: "success" });
  } catch {
    toastManager.add({ title: "Could not copy the details.", type: "error" });
  }
};

function RunSteps({
  events,
  failed,
  onRetry,
  timeZone,
}: {
  events: JsonJobEvent[] | null;
  failed: boolean;
  onRetry: () => void;
  timeZone: string;
}) {
  if (failed)
    return (
      <p className={cn(JOB_NOTE, "flex flex-wrap items-center gap-2")}>
        Couldn&apos;t load the steps.
        <Button size="xs" variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      </p>
    );
  if (events === null) return <p className={JOB_NOTE}>Loading steps…</p>;
  const clock = (iso: string) =>
    getLocalDateParts(new Date(iso), timeZone).time;
  const steps = events.flatMap((event) => {
    const sentence = eventSentence(event, clock);
    return sentence
      ? [{ id: event.id, at: clock(event.createdAt), sentence }]
      : [];
  });
  if (steps.length === 0) return <p className={JOB_NOTE}>No steps recorded.</p>;
  return (
    <ol className="m-0 grid list-none grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 p-0 text-meta">
      {steps.map((step) => (
        <li className="col-span-2 grid grid-cols-subgrid" key={step.id}>
          <span className="text-muted-foreground tabular-nums">{step.at}</span>
          <span className="wrap-anywhere text-foreground/80">
            {step.sentence}
          </span>
        </li>
      ))}
    </ol>
  );
}

const runAction = (status: JsonBackgroundJob["status"]) =>
  status === "queued" || status === "running"
    ? "cancel"
    : status === "succeeded"
      ? null
      : "retry";

/** What a run did, step by step, and what you can do with it. */
function RunStory({
  job,
  onJobAction,
  timeZone,
}: {
  job: JsonBackgroundJob;
  onJobAction: (jobId: string, action: "retry" | "cancel") => void;
  timeZone: string;
}) {
  const { events, failed, ready, retry } = useRunEvents(job.id, job.updatedAt);
  const action = runAction(effectiveStatus(job));
  return (
    <div className="grid gap-3.5 ps-9 pe-4 pt-1 pb-4">
      <RunSteps
        events={events}
        failed={failed}
        timeZone={timeZone}
        onRetry={retry}
      />
      <div className="flex flex-wrap gap-1.5">
        {action ? (
          <Button
            onClick={() => onJobAction(job.id, action)}
            size="xs"
            variant={action === "cancel" ? "destructive-outline" : "outline"}
          >
            {action === "cancel" ? "Cancel" : "Retry"}
          </Button>
        ) : null}
        <Button
          disabled={!ready}
          onClick={() => ready && void copyRunDetails(job, ready)}
          size="xs"
          variant="outline"
        >
          <Copy aria-hidden />
          Copy details
        </Button>
      </div>
    </div>
  );
}

function RunRow({
  job,
  nowMs,
  onJobAction,
  timeZone,
  workerRunningJobIds,
}: {
  job: JsonBackgroundJob;
  nowMs: number;
  onJobAction: (jobId: string, action: "retry" | "cancel") => void;
  timeZone: string;
  workerRunningJobIds: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const status = getJobDisplayStatus(job, workerRunningJobIds);
  return (
    <li
      className={cn(
        "border-t border-border first:border-t-0",
        open && "bg-hover/50",
      )}
    >
      <button
        aria-expanded={open}
        className={cn(
          "flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
          !open && "hover:bg-hover",
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <JobDot tone={getJobTone(status)} />
        <RunText job={job} nowMs={nowMs} status={status} timeZone={timeZone} />
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <RunStory job={job} onJobAction={onJobAction} timeZone={timeZone} />
      ) : null}
    </li>
  );
}

const RUN_LIST =
  "m-0 list-none overflow-hidden rounded-xl border border-border bg-card p-0";

function RunList({
  runs: { history, status, retry },
  ...row
}: Omit<Parameters<typeof RunRow>[0], "job"> & { runs: Runs }) {
  if (status === "loading") return <p className={JOB_NOTE}>Loading runs…</p>;
  if (status === "failed")
    return (
      <div className="flex items-center justify-between gap-3">
        <p className={JOB_NOTE}>Couldn't load the runs.</p>
        <Button size="sm" variant="outline" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  if (!history?.length) return <p className={JOB_NOTE}>No runs yet.</p>;
  return (
    <ul aria-label="Runs" className={RUN_LIST}>
      {history.slice(0, HISTORY_VISIBLE_RUNS).map((job) => (
        <RunRow job={job} key={job.id} {...row} />
      ))}
    </ul>
  );
}

const resultTitle = (
  action: "retry" | "dismiss",
  changed: number,
  unchanged: number,
) => {
  const done =
    action === "retry"
      ? `${plural(changed, "run")} sent back to the queue.`
      : `${plural(changed, "run")} dismissed.`;
  return unchanged ? `${done} ${unchanged} had already changed.` : done;
};

/** Retry or dismiss one failed run, or every failed run of the job. */
function useFailedActions(kind: string, onRefresh: () => Promise<void>) {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [errors, setErrors] = useState<{ jobId: string; error: string }[]>([]);
  const act = async (action: "retry" | "dismiss", jobId?: string) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setErrors([]);
    try {
      const results = jobId
        ? [await applyProblemJobAction(jobId, action)]
        : await applyProblemJobActions(
            await collectProblemJobIds(kind),
            action,
          );
      const failures = results.flatMap((result) =>
        result.error ? [{ jobId: result.jobId, error: result.error }] : [],
      );
      setErrors(failures);
      const changed = results.filter(
        (result) => !result.error && result.changed,
      ).length;
      if (changed || !failures.length)
        toastManager.add({
          title: resultTitle(
            action,
            changed,
            results.length - failures.length - changed,
          ),
          type: "success",
        });
    } catch (error) {
      toastManager.add({
        title:
          error instanceof Error
            ? error.message
            : "Could not load the jobs. Try again.",
        type: "error",
      });
    } finally {
      // Each refresh reports its own failure; the buttons come back anyway.
      await onRefresh()
        .catch(() => {})
        .finally(() => {
          busy.current = false;
          setPending(false);
        });
    }
  };
  return { pending, errors, act };
}

/** The job's failed runs, each with Dismiss and Retry. */
function FailedRuns({
  actions: { pending, errors, act },
  count,
  jobs,
  kind,
  nowMs,
  timeZone,
}: {
  actions: ReturnType<typeof useFailedActions>;
  count: number;
  jobs: JsonBackgroundJob[];
  kind: string;
  nowMs: number;
  timeZone: string;
}) {
  return (
    <div className="grid gap-3">
      {errors.length ? (
        <Alert variant="error">
          {errors.map((entry) => {
            const job = jobs.find((item) => item.id === entry.jobId);
            const label = job ? runMeta(job, nowMs, timeZone) : "";
            return (
              <p className="wrap-anywhere" key={entry.jobId}>
                {label || "A run"}: {entry.error}
              </p>
            );
          })}
        </Alert>
      ) : null}
      <ul
        aria-busy={pending}
        aria-label={`Failed ${formatJobKind(kind)} runs`}
        className={RUN_LIST}
      >
        {jobs.map((job) => (
          <li
            className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border px-4 py-2.5 first:border-t-0"
            key={job.id}
          >
            <JobDot tone="failed" />
            <RunText
              job={job}
              nowMs={nowMs}
              status={effectiveStatus(job)}
              timeZone={timeZone}
            />
            <span className="flex gap-1.5">
              <Button
                disabled={pending}
                onClick={() => void act("dismiss", job.id)}
                size="xs"
                variant="ghost-muted"
              >
                Dismiss
              </Button>
              <Button
                disabled={pending}
                onClick={() => void act("retry", job.id)}
                size="xs"
                variant="outline"
              >
                Retry
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {count > jobs.length ? (
        <p className={JOB_NOTE}>
          Showing the latest {jobs.length} of {count}. Retry all and Dismiss all
          act on every one.
        </p>
      ) : null}
    </div>
  );
}

type DetailsTab = "failed" | "runs";

function DetailsHeader({
  failedCount,
  kind,
  setTab,
  showFailed,
}: {
  failedCount: number;
  kind: string;
  setTab: (tab: DetailsTab) => void;
  showFailed: boolean;
}) {
  return (
    <DialogHeader>
      <div className="flex items-center gap-3 pe-8">
        <JobIcon failed={failedCount > 0} kind={kind} />
        <div className="grid min-w-0 gap-0.5">
          <DialogTitle>{formatJobKind(kind)}</DialogTitle>
          <DialogDescription>{getJobDescription(kind)}</DialogDescription>
        </div>
      </div>
      {failedCount > 0 ? (
        <Tabs
          className="mt-2"
          onValueChange={(value) => setTab(value as DetailsTab)}
          value={showFailed ? "failed" : "runs"}
        >
          <TabsList className="self-start">
            <TabsTab value="failed">
              Failed
              <span className="text-muted-foreground tabular-nums">
                {failedCount.toLocaleString()}
              </span>
            </TabsTab>
            <TabsTab value="runs">All runs</TabsTab>
          </TabsList>
        </Tabs>
      ) : null}
    </DialogHeader>
  );
}

/** Dismiss or retry every failed run of the job. */
function BulkActions({
  actions,
}: {
  actions: ReturnType<typeof useFailedActions>;
}) {
  return (
    <div className="flex gap-2 sm:me-auto">
      <Button
        disabled={actions.pending}
        onClick={() => void actions.act("dismiss")}
        size="sm"
        variant="ghost-muted"
      >
        Dismiss all
      </Button>
      <Button
        disabled={actions.pending}
        onClick={() => void actions.act("retry")}
        size="sm"
        variant="outline"
      >
        Retry all
      </Button>
    </div>
  );
}

function JobDetailsDialog({
  actionError,
  failedCount,
  kind,
  nowMs,
  onJobAction,
  onRefreshFailed,
  runs,
  problems,
  setTab,
  tab,
  timeZone,
  workerRunningJobIds,
}: {
  actionError: string | null;
  failedCount: number;
  kind: string;
  nowMs: number;
  onJobAction: (jobId: string, action: "retry" | "cancel") => void;
  onRefreshFailed: () => Promise<void>;
  runs: Runs;
  problems: JsonBackgroundJob[];
  setTab: (tab: DetailsTab | null) => void;
  tab: DetailsTab | null;
  timeZone: string;
  workerRunningJobIds: Set<string>;
}) {
  const failedActions = useFailedActions(kind, onRefreshFailed);
  const showFailed = tab === "failed" && failedCount > 0;
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) setTab(null);
      }}
      open={tab !== null}
    >
      <DialogPopup className="sm:max-w-2xl">
        <DetailsHeader
          failedCount={failedCount}
          kind={kind}
          setTab={setTab}
          showFailed={showFailed}
        />
        <DialogPanel className="grid gap-3">
          {actionError ? <Alert variant="error">{actionError}</Alert> : null}
          {showFailed ? (
            <FailedRuns
              actions={failedActions}
              count={failedCount}
              jobs={problems}
              kind={kind}
              nowMs={nowMs}
              timeZone={timeZone}
            />
          ) : (
            <RunList
              nowMs={nowMs}
              runs={runs}
              onJobAction={onJobAction}
              timeZone={timeZone}
              workerRunningJobIds={workerRunningJobIds}
            />
          )}
        </DialogPanel>
        <DialogFooter>
          {showFailed && failedCount > 1 ? (
            <BulkActions actions={failedActions} />
          ) : null}
          <DialogClose render={<Button size="sm" variant="outline" />}>
            Close
          </DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** Retry, cancel or dismiss one run; the server's message when it refuses. */
async function sendJobAction(
  jobId: string,
  action: "retry" | "cancel" | "dismiss",
) {
  const res = await fetch(`/api/admin/jobs/${jobId}/${action}`, {
    method: "POST",
  });
  if (res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? `Request failed (${res.status}).`;
}

function JobIcon({ kind, failed }: { kind: string; failed: boolean }) {
  const Icon = JOB_META[kind]?.icon ?? Archive;
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl",
        failed ? "bg-destructive/12" : "bg-hover",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-4",
          failed ? "text-destructive-foreground" : "text-muted-foreground",
        )}
      />
    </span>
  );
}

/** Running and waiting counts, shown only when they aren't zero. */
function JobCounts({
  counts = {},
}: {
  counts: JsonJobSummary["countsByKind"][string] | undefined;
}) {
  const count = (status: JsonBackgroundJob["status"]) => counts[status] ?? 0;
  const list = [
    { label: "running", count: count("running"), variant: "info" },
    { label: "waiting", count: count("queued"), variant: "neutral" },
  ] as const;
  return list.map((item) =>
    item.count > 0 ? (
      <Badge key={item.label} variant={item.variant}>
        {item.count.toLocaleString()} {item.label}
      </Badge>
    ) : null,
  );
}

const withRun = (jobs: JsonBackgroundJob[], run: JsonBackgroundJob) =>
  [run, ...jobs.filter((job) => job.id !== run.id)].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );

type Runs = {
  history: JsonBackgroundJob[] | null;
  status: "loading" | "failed" | "ready";
  retry: () => void;
};

/**
 * The job's run list, read on each open and kept current after. `onLoaded`
 * gets each accepted read, so the card follows whichever read lands last.
 */
function useJobHistory(
  kind: string,
  lastRun: JsonBackgroundJob | null,
  onLoaded: (jobs: JsonBackgroundJob[]) => void,
) {
  const [history, setHistory] = useState<JsonBackgroundJob[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // A list read can land after a newer live update or a newer read.
  const pushed = useRef(lastRun);
  const reads = useRef(0);

  useEffect(() => {
    pushed.current = lastRun;
    if (lastRun)
      setHistory((current) => (current ? withRun(current, lastRun) : current));
  }, [lastRun]);

  const loadHistory = async () => {
    const read = ++reads.current;
    const before = pushed.current;
    let jobs: JsonBackgroundJob[];
    try {
      const res = await fetch(
        `/api/admin/jobs?kind=${encodeURIComponent(kind)}&limit=100`,
      );
      if (!res.ok) throw new Error();
      jobs = ((await res.json()) as { items: JsonBackgroundJob[] }).items;
    } catch {
      if (read === reads.current) {
        setFailed(true);
        toastManager.add({
          title: "Could not refresh the runs. Reload to see them.",
          type: "error",
        });
      }
      return;
    }
    if (read !== reads.current) return;
    setFailed(false);
    const live = pushed.current;
    // The card already shows a run pushed while this read was out.
    if (live !== before && live) {
      setHistory(withRun(jobs, live));
      return;
    }
    setHistory(jobs);
    onLoaded(jobs);
  };

  const loadOnOpen = async () => {
    if (history === null) setHistoryLoading(true);
    try {
      await loadHistory();
    } finally {
      setHistoryLoading(false);
    }
  };

  const runs: Runs = {
    history,
    status: historyLoading
      ? "loading"
      : failed && !history
        ? "failed"
        : "ready",
    retry: () => void loadOnOpen(),
  };
  return { runs, loadHistory, loadOnOpen };
}

// One row per job kind: its state, counts and buttons; the logic is in the
// helpers above, what's left is wiring.
// fallow-ignore-next-line complexity
function JobTaskCard({
  counts = {},
  timeZone,
  kind,
  lastRun,
  nowMs,
  problems,
  onLastRunChange,
  onRefreshProblems,
  workerRunningJobIds,
}: {
  counts: JsonJobSummary["countsByKind"][string] | undefined;
  timeZone: string;
  kind: string;
  lastRun: JsonBackgroundJob | null;
  nowMs: number;
  problems: JsonBackgroundJob[];
  onLastRunChange: (kind: string, job: JsonBackgroundJob | null) => void;
  onRefreshProblems: () => Promise<void>;
  workerRunningJobIds: Set<string>;
}) {
  const failedCount = (counts.failed ?? 0) + (counts.dead ?? 0);
  const [tab, setTab] = useState<DetailsTab | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { runs, loadHistory, loadOnOpen } = useJobHistory(
    kind,
    lastRun,
    (jobs) =>
      onLastRunChange(kind, selectRepresentativeJob(jobs, workerRunningJobIds)),
  );

  const displayStatus = lastRun
    ? getJobDisplayStatus(lastRun, workerRunningJobIds)
    : null;
  const tone = getJobTone(displayStatus);
  const canRunNow =
    MANUAL_RUN_JOB_KINDS.has(kind) && displayStatus !== "running";

  const refreshJobs = loadHistory;

  const openDetails = (next: DetailsTab) => {
    setActionError(null);
    setTab(next);
    void loadOnOpen();
  };

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
      await refreshJobs();
    } finally {
      setRunning(false);
    }
  };

  const postJobAction = async (jobId: string, action: "retry" | "cancel") => {
    setActionError(null);
    const message = await sendJobAction(jobId, action);
    if (message) {
      setActionError(message);
      return;
    }
    await Promise.all([refreshJobs(), onRefreshProblems()]);
  };

  return (
    <article className="flex min-h-16 flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-border px-4 py-3">
      <JobIcon kind={kind} failed={tone === "failed"} />
      <div className="grid min-w-0 flex-1 basis-64 gap-0.5">
        <h3 className="m-0 font-sans text-body font-medium wrap-anywhere">
          {formatJobKind(kind)}
        </h3>
        <JobSentence
          error={runError}
          job={lastRun}
          kind={kind}
          nowMs={nowMs}
          status={displayStatus}
          timeZone={timeZone}
        />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 max-sm:w-full max-sm:ps-12.5">
        <JobCounts counts={counts} />
        {failedCount > 0 ? (
          <Button
            onClick={() => openDetails("failed")}
            size="sm"
            variant="destructive-outline"
          >
            {failedCount.toLocaleString()} failed
          </Button>
        ) : null}
        {canRunNow ? (
          <Button
            disabled={running}
            loading={running}
            size="sm"
            variant="outline"
            onClick={() => void handleRun()}
          >
            Run now
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost-muted"
          onClick={() => openDetails("runs")}
        >
          Details
        </Button>
      </div>

      <JobDetailsDialog
        actionError={actionError}
        failedCount={failedCount}
        kind={kind}
        nowMs={nowMs}
        onJobAction={(jobId, action) => void postJobAction(jobId, action)}
        onRefreshFailed={async () => {
          await Promise.all([onRefreshProblems(), refreshJobs()]);
        }}
        runs={runs}
        problems={problems}
        setTab={setTab}
        tab={tab}
        timeZone={timeZone}
        workerRunningJobIds={workerRunningJobIds}
      />
    </article>
  );
}

const workerOffline = (summary: JsonJobSummary) =>
  !summary.workers.some(
    (worker) => worker.status !== "stopped" && worker.status !== "stale",
  );

const groupKinds = (kinds: string[]) => {
  const groups = [...GROUPS, "Other"].map((group) => ({
    group,
    kinds: kinds.filter((kind) => (JOB_META[kind]?.group ?? "Other") === group),
  }));
  return groups.filter((entry) => entry.kinds.length > 0);
};

const runningJobIds = (workers: JsonWorker[]) =>
  new Set(
    workers.flatMap((worker) =>
      worker.status === "running" && worker.currentJobId
        ? [worker.currentJobId]
        : [],
    ),
  );

/** Swaps one job kind's latest run, for rows that refreshed themselves. */
const updateLastRun =
  (
    setLastRuns: Dispatch<
      SetStateAction<Record<string, JsonBackgroundJob | null>>
    >,
  ) =>
  (kind: string, job: JsonBackgroundJob | null) =>
    setLastRuns((current) => ({ ...current, [kind]: job }));

/** Job state from the page load, kept current by what the server pushes. */
function useJobState(
  initialSummary: JsonJobSummary,
  initialLastRuns: Record<string, JsonBackgroundJob | null>,
  initialProblems: JsonBackgroundJob[],
) {
  const [summary, setSummary] = useState(initialSummary);
  const [lastRuns, setLastRuns] = useState(initialLastRuns);
  const [problems, setProblems] = useState(initialProblems);
  // A refresh can land after a newer push or a newer refresh.
  const version = useRef(0);
  const apply = (state: JsonJobState) => {
    setSummary(state.summary);
    setLastRuns(state.lastRuns);
    setProblems(state.problems);
  };
  useEffect(
    () =>
      subscribeLive("state", (data) => {
        version.current += 1;
        apply(data as JsonJobState);
      }),
    [],
  );
  /** Rows and counts together, for when live updates are not arriving. */
  const refreshState = async () => {
    const read = ++version.current;
    try {
      const res = await fetch("/api/views/admin/jobs");
      if (!res.ok) throw new Error();
      const data = (await res.json()) as {
        initialSummary: JsonJobSummary;
        initialLastRuns: Record<string, JsonBackgroundJob | null>;
        initialProblems: JsonBackgroundJob[];
      };
      if (read === version.current)
        apply({
          summary: data.initialSummary,
          lastRuns: data.initialLastRuns,
          problems: data.initialProblems,
        });
    } catch {
      toastManager.add({
        title:
          "Could not refresh the jobs. Reconnect or reload to check their current state.",
        type: "error",
      });
    }
  };
  return { summary, lastRuns, setLastRuns, problems, refreshState };
}

/** The current time, ticking each second for "2m ago" style labels. */
function useClock() {
  const { now } = useTime();
  const [nowMs, setNowMs] = useState(() => now.getTime());
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return nowMs;
}

function JobGroups({
  counts,
  jobKinds,
  lastRuns,
  nowMs,
  problems,
  timeZone,
  workerRunningJobIds,
  onLastRunChange,
  onRefreshProblems,
}: {
  counts: JsonJobSummary["countsByKind"];
  jobKinds: string[];
  lastRuns: Record<string, JsonBackgroundJob | null>;
  nowMs: number;
  problems: JsonBackgroundJob[];
  timeZone: string;
  workerRunningJobIds: Set<string>;
  onLastRunChange: (kind: string, job: JsonBackgroundJob | null) => void;
  onRefreshProblems: () => Promise<void>;
}) {
  return (
    <section
      aria-label="Jobs"
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      {groupKinds(jobKinds).map(({ group, kinds }) => (
        <div className="[&>article]:first-of-type:border-t-0" key={group}>
          <h2 className="m-0 border-t border-border px-4 pt-3.5 pb-1.5 font-sans text-label font-semibold text-muted-foreground first:border-t-0">
            {group}
          </h2>
          {kinds.map((kind) => (
            <JobTaskCard
              counts={counts[kind]}
              timeZone={timeZone}
              key={kind}
              kind={kind}
              lastRun={lastRuns[kind] ?? null}
              nowMs={nowMs}
              problems={problems.filter((job) => job.kind === kind)}
              onLastRunChange={onLastRunChange}
              onRefreshProblems={onRefreshProblems}
              workerRunningJobIds={workerRunningJobIds}
            />
          ))}
        </div>
      ))}
    </section>
  );
}

type Props = {
  initialProblems: JsonBackgroundJob[];
  initialLastRuns: Record<string, JsonBackgroundJob | null>;
  initialSummary: JsonJobSummary;
  jobKinds: string[];
};

export function JobOperations({
  initialProblems,
  initialLastRuns,
  initialSummary,
  jobKinds,
}: Props) {
  const { summary, lastRuns, setLastRuns, problems, refreshState } =
    useJobState(initialSummary, initialLastRuns, initialProblems);
  const { timeZone } = useTime();
  const nowMs = useClock();
  const workerRunningJobIds = useMemo(
    () => runningJobIds(summary.workers),
    [summary.workers],
  );

  return (
    <AdminPage>
      <PageHeader title="Jobs" />
      {workerOffline(summary) ? (
        <Alert variant="error">No worker is online, so nothing runs.</Alert>
      ) : null}
      <JobGroups
        counts={summary.countsByKind}
        jobKinds={jobKinds}
        lastRuns={lastRuns}
        nowMs={nowMs}
        problems={problems}
        timeZone={timeZone}
        workerRunningJobIds={workerRunningJobIds}
        onLastRunChange={updateLastRun(setLastRuns)}
        onRefreshProblems={refreshState}
      />
    </AdminPage>
  );
}
