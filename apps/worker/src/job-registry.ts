import { z } from "zod";

import {
  DEFAULT_MAINTENANCE_RUN_TIME,
  DEFAULT_TIME_ZONE,
} from "@staaash/config/time-zone";
import {
  MEDIA_DERIVATIVE_CLEANUP_JOB_KIND,
  MEDIA_DERIVATIVE_GENERATE_JOB_KIND,
  RESTORE_RECONCILE_JOB_KIND,
  STAGING_CLEANUP_JOB_KIND,
  STAGING_CLEANUP_SCHEDULE_WINDOW_MS,
  TRASH_RETENTION_JOB_KIND,
  UPDATE_CHECK_JOB_KIND,
  ZIP_ARCHIVE_CLEANUP_JOB_KIND,
  ZIP_ARCHIVE_GENERATE_JOB_KIND,
  ensureBackgroundJobScheduled,
  type BackgroundJobRecord,
  type SupportedBackgroundJobKind,
} from "@staaash/db/jobs";

import type { WorkerStoragePaths } from "./storage-maintenance.js";
import { handleStagingCleanup } from "./handlers/staging-cleanup.js";
import { handleRestoreReconciliation } from "./handlers/restore-reconciliation.js";
import { handleTrashRetention } from "./handlers/trash-retention.js";
import { handleUpdateCheck } from "./handlers/update-check.js";
import { handleMediaDerivativeGenerate } from "./handlers/media-derivative.js";
import { handleMediaDerivativeCleanup } from "./handlers/media-derivative-cleanup.js";
import { handleZipArchiveGenerate } from "./handlers/zip-archive.js";
import { handleZipArchiveCleanup } from "./handlers/zip-archive-cleanup.js";
import type { JobContext } from "./job-context.js";
import { TerminalJobError } from "./job-context.js";
import { nextDailyRunAtUtc, nextDailyWindowEndUtc } from "./scheduling.js";

type JobHandlerResult = {
  cancelled?: boolean;
};

type JobRegistryEntry = {
  kind: SupportedBackgroundJobKind;
  maxAttempts: number;
  timeoutMs: number;
  cancellable: boolean;
  scheduleEveryMs?: number | (() => Promise<number>);
  scheduleWindowMs?: number | (() => Promise<number>);
  scheduleDaily?: boolean;
  parsePayload: (payloadJson: unknown) => Record<string, unknown>;
  run: (
    job: BackgroundJobRecord,
    storagePaths: WorkerStoragePaths,
    context: JobContext,
  ) => Promise<JobHandlerResult | void>;
};

const emptyPayloadSchema = z.record(z.string(), z.unknown()).default({});
const restorePayloadSchema = z
  .object({ triggeredByUserId: z.string().optional() })
  .passthrough();
const derivativePayloadSchema = z.object({
  fileId: z.string().min(1),
  kind: z.string().min(1),
  profile: z.string().min(1),
  reason: z.string().min(1),
});
const zipArchivePayloadSchema = z.object({
  archiveId: z.string().min(1),
});

const parseWith =
  (schema: z.ZodType<Record<string, unknown>>) => (payloadJson: unknown) => {
    const parsed = schema.safeParse(payloadJson ?? {});
    if (!parsed.success) {
      throw new TerminalJobError("Invalid background job payload.", "payload");
    }
    return parsed.data;
  };

const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const getUpdateCheckIntervalMs = async (): Promise<number> => {
  try {
    const { getPrisma } = await import("@staaash/db/client");
    const db = getPrisma();
    const settings = await db.systemSettings.findUnique({
      where: { id: "singleton" },
    });
    return (settings?.updateCheckIntervalHours ?? 24) * 60 * 60 * 1000;
  } catch {
    return DEFAULT_UPDATE_CHECK_INTERVAL_MS;
  }
};

const getSchedulingSettings = async () => {
  try {
    const { getPrisma } = await import("@staaash/db/client");
    const db = getPrisma();
    const settings = await db.systemSettings.findUnique({
      where: { id: "singleton" },
    });
    return {
      timeZone: settings?.timeZone ?? DEFAULT_TIME_ZONE,
      maintenanceRunTime:
        settings?.maintenanceRunTime ?? DEFAULT_MAINTENANCE_RUN_TIME,
    };
  } catch {
    return {
      timeZone: DEFAULT_TIME_ZONE,
      maintenanceRunTime: DEFAULT_MAINTENANCE_RUN_TIME,
    };
  }
};

const JOB_REGISTRY: Record<SupportedBackgroundJobKind, JobRegistryEntry> = {
  [STAGING_CLEANUP_JOB_KIND]: {
    kind: STAGING_CLEANUP_JOB_KIND,
    maxAttempts: 5,
    timeoutMs: 10 * 60 * 1000,
    cancellable: false,
    scheduleEveryMs: STAGING_CLEANUP_SCHEDULE_WINDOW_MS,
    scheduleWindowMs: STAGING_CLEANUP_SCHEDULE_WINDOW_MS,
    parsePayload: parseWith(emptyPayloadSchema),
    run: handleStagingCleanup,
  },
  [TRASH_RETENTION_JOB_KIND]: {
    kind: TRASH_RETENTION_JOB_KIND,
    maxAttempts: 5,
    timeoutMs: 60 * 60 * 1000,
    cancellable: false,
    scheduleDaily: true,
    parsePayload: parseWith(emptyPayloadSchema),
    run: async (job) => handleTrashRetention(job),
  },
  [UPDATE_CHECK_JOB_KIND]: {
    kind: UPDATE_CHECK_JOB_KIND,
    maxAttempts: 3,
    timeoutMs: 5 * 60 * 1000,
    cancellable: false,
    scheduleEveryMs: getUpdateCheckIntervalMs,
    scheduleWindowMs: getUpdateCheckIntervalMs,
    parsePayload: parseWith(emptyPayloadSchema),
    run: handleUpdateCheck,
  },
  [RESTORE_RECONCILE_JOB_KIND]: {
    kind: RESTORE_RECONCILE_JOB_KIND,
    maxAttempts: 3,
    timeoutMs: 2 * 60 * 60 * 1000,
    cancellable: false,
    parsePayload: parseWith(restorePayloadSchema),
    run: async (job, storagePaths) =>
      handleRestoreReconciliation(job, storagePaths),
  },
  [MEDIA_DERIVATIVE_GENERATE_JOB_KIND]: {
    kind: MEDIA_DERIVATIVE_GENERATE_JOB_KIND,
    maxAttempts: 3,
    timeoutMs: 6 * 60 * 60 * 1000,
    cancellable: true,
    parsePayload: parseWith(derivativePayloadSchema),
    run: async (job, storagePaths, context) => ({
      cancelled: await handleMediaDerivativeGenerate(
        job,
        storagePaths,
        context,
      ),
    }),
  },
  [MEDIA_DERIVATIVE_CLEANUP_JOB_KIND]: {
    kind: MEDIA_DERIVATIVE_CLEANUP_JOB_KIND,
    maxAttempts: 5,
    timeoutMs: 60 * 60 * 1000,
    cancellable: false,
    scheduleDaily: true,
    parsePayload: parseWith(emptyPayloadSchema),
    run: handleMediaDerivativeCleanup,
  },
  [ZIP_ARCHIVE_GENERATE_JOB_KIND]: {
    kind: ZIP_ARCHIVE_GENERATE_JOB_KIND,
    maxAttempts: 3,
    timeoutMs: 2 * 60 * 60 * 1000,
    cancellable: false,
    parsePayload: parseWith(zipArchivePayloadSchema),
    run: handleZipArchiveGenerate,
  },
  [ZIP_ARCHIVE_CLEANUP_JOB_KIND]: {
    kind: ZIP_ARCHIVE_CLEANUP_JOB_KIND,
    maxAttempts: 5,
    timeoutMs: 60 * 60 * 1000,
    cancellable: false,
    scheduleDaily: true,
    parsePayload: parseWith(emptyPayloadSchema),
    run: handleZipArchiveCleanup,
  },
};

export const getJobRegistryEntry = (kind: string) =>
  JOB_REGISTRY[kind as SupportedBackgroundJobKind] ?? null;

const resolveMaybeAsyncMs = async (value: number | (() => Promise<number>)) =>
  typeof value === "number" ? value : value();

const resolveSchedule = async (
  entry: JobRegistryEntry,
  now: Date,
  runMissingImmediately: boolean,
) => {
  if (entry.scheduleDaily) {
    const { timeZone, maintenanceRunTime } = await getSchedulingSettings();
    const runAt = runMissingImmediately
      ? now
      : nextDailyRunAtUtc({ timeZone, localTime: maintenanceRunTime, now });
    return {
      runAt,
      windowEnd: nextDailyWindowEndUtc({
        timeZone,
        localTime: maintenanceRunTime,
        runAt,
      }),
    };
  }

  if (!entry.scheduleEveryMs) return null;

  const intervalMs = await resolveMaybeAsyncMs(entry.scheduleEveryMs);
  const windowMs = entry.scheduleWindowMs
    ? await resolveMaybeAsyncMs(entry.scheduleWindowMs)
    : intervalMs;
  const runAt = runMissingImmediately
    ? now
    : new Date(now.getTime() + intervalMs);

  return {
    runAt,
    windowEnd: new Date(runAt.getTime() + windowMs),
  };
};

export const schedulePeriodicJobs = async (
  now = new Date(),
  { runMissingImmediately = false }: { runMissingImmediately?: boolean } = {},
) => {
  for (const entry of Object.values(JOB_REGISTRY)) {
    const schedule = await resolveSchedule(entry, now, runMissingImmediately);
    if (!schedule) continue;

    await ensureBackgroundJobScheduled({
      kind: entry.kind,
      runAt: schedule.runAt,
      payloadJson: {},
      maxAttempts: entry.maxAttempts,
      windowEnd: schedule.windowEnd,
      now,
    });
  }
};

export const scheduleNextPeriodicRun = async (
  kind: SupportedBackgroundJobKind,
  now = new Date(),
) => {
  const entry = JOB_REGISTRY[kind];
  const schedule = await resolveSchedule(entry, now, false);
  if (!schedule) return;

  await ensureBackgroundJobScheduled({
    kind,
    runAt: schedule.runAt,
    payloadJson: {},
    maxAttempts: entry.maxAttempts,
    windowEnd: schedule.windowEnd,
    now,
  });
};
