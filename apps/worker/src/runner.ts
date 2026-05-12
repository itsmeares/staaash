import { setTimeout as delay } from "node:timers/promises";

import {
  BACKGROUND_JOB_LEASE_MS,
  claimDueBackgroundJob,
  findBackgroundJobById,
  heartbeatWorkerInstance,
  markBackgroundJobFailed,
  markBackgroundJobSucceeded,
  markBackgroundJobTerminal,
  recordBackgroundJobEvent,
  renewBackgroundJobLease,
  type BackgroundJobRecord,
} from "@staaash/db/jobs";
import {
  failRestoreReconciliationRun,
  markRestoreReconciliationRunQueued,
} from "@staaash/db/reconciliation";

import type { WorkerStoragePaths } from "./storage-maintenance.js";
import {
  getJobRegistryEntry,
  scheduleNextPeriodicRun,
  schedulePeriodicJobs,
} from "./job-registry.js";
import { TerminalJobError, getErrorMessage } from "./job-context.js";

const MIN_IDLE_DELAY_MS = 1_000;
const MAX_IDLE_DELAY_MS = 30_000;
const SCHEDULER_TICK_MS = 60_000;

type ActiveJobState = {
  jobId: string;
  controller: AbortController;
  done: Promise<void>;
};

const isAbortError = (error: unknown) =>
  error instanceof Error &&
  (error.name === "AbortError" || error.message.includes("aborted"));

export class WorkerRunner {
  private stopping = false;
  private idleDelayMs = MIN_IDLE_DELAY_MS;
  private activeJob: ActiveJobState | null = null;
  private schedulerTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: {
      workerId: string;
      storagePaths: WorkerStoragePaths;
      leaseMs?: number;
    },
  ) {}

  async start() {
    this.schedulerTimer = setInterval(() => {
      void schedulePeriodicJobs().catch((error) => {
        console.warn("[worker] Failed to schedule periodic jobs.", {
          error: getErrorMessage(error),
        });
      });
    }, SCHEDULER_TICK_MS);

    while (!this.stopping) {
      try {
        const processed = await this.drainDueJobs();
        this.idleDelayMs = processed
          ? MIN_IDLE_DELAY_MS
          : Math.min(this.idleDelayMs * 2, MAX_IDLE_DELAY_MS);
      } catch (error) {
        console.error("[worker] Poll loop failed.", {
          error: getErrorMessage(error),
        });
      }

      if (!this.stopping) {
        await heartbeatWorkerInstance({
          id: this.options.workerId,
          status: "idle",
          currentJobId: null,
        }).catch(() => undefined);
        await delay(this.idleDelayMs);
      }
    }
  }

  async stop(timeoutMs = 25_000) {
    this.stopping = true;
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    this.activeJob?.controller.abort();

    if (!this.activeJob) return;

    await Promise.race([
      this.activeJob.done,
      delay(timeoutMs).then(() => undefined),
    ]);
  }

  async drainDueJobs() {
    let processed = false;

    while (!this.stopping) {
      const didProcess = await this.processNextJob();
      if (!didProcess) return processed;
      processed = true;
    }

    return processed;
  }

  async processNextJob(): Promise<boolean> {
    const job = await claimDueBackgroundJob({
      workerId: this.options.workerId,
      leaseMs: this.options.leaseMs ?? BACKGROUND_JOB_LEASE_MS,
    });

    if (!job) return false;

    const controller = new AbortController();
    const done = this.runClaimedJob(job, controller);
    this.activeJob = {
      jobId: job.id,
      controller,
      done,
    };

    try {
      await done;
    } finally {
      this.activeJob = null;
      await heartbeatWorkerInstance({
        id: this.options.workerId,
        status: "idle",
        currentJobId: null,
      }).catch(() => undefined);
    }

    return true;
  }

  private async runClaimedJob(
    job: BackgroundJobRecord,
    controller: AbortController,
  ) {
    const entry = getJobRegistryEntry(job.kind);

    if (!entry) {
      await markBackgroundJobTerminal({
        jobId: job.id,
        workerId: this.options.workerId,
        errorCode: "unsupported_kind",
        errorMessage: `Unsupported job kind: ${job.kind}`,
      });
      return;
    }

    const leaseMs = this.options.leaseMs ?? BACKGROUND_JOB_LEASE_MS;
    const leaseTimer = setInterval(
      () => {
        void renewBackgroundJobLease({
          jobId: job.id,
          workerId: this.options.workerId,
          leaseMs,
        }).catch((error) => {
          console.warn("[worker] Failed to renew job lease.", {
            jobId: job.id,
            kind: job.kind,
            error: getErrorMessage(error),
          });
        });
      },
      Math.max(1000, Math.floor(leaseMs / 2)),
    );

    const timeoutTimer = setTimeout(() => {
      controller.abort();
    }, entry.timeoutMs);

    const cancelTimer = entry.cancellable
      ? setInterval(() => {
          void findBackgroundJobById({ jobId: job.id })
            .then((current) => {
              if (current?.status === "cancelled") controller.abort();
            })
            .catch(() => undefined);
        }, 3000)
      : null;

    const context = {
      signal: controller.signal,
      workerId: this.options.workerId,
      storagePaths: this.options.storagePaths,
      emitEvent: (type: string, message?: string, metadataJson = {}) =>
        recordBackgroundJobEvent({
          jobId: job.id,
          type,
          message: message ?? null,
          metadataJson,
          workerId: this.options.workerId,
        }).then(() => undefined),
      updateProgress: (progressJson: Record<string, unknown>) =>
        renewBackgroundJobLease({
          jobId: job.id,
          workerId: this.options.workerId,
          leaseMs,
          progressJson,
        }).then(() => undefined),
    };

    try {
      entry.parsePayload(job.payloadJson);
      await context.emitEvent("started", "Job handler started.");
      const result = await entry.run(job, this.options.storagePaths, context);
      const current = await findBackgroundJobById({ jobId: job.id });

      if (result?.cancelled || current?.status === "cancelled") {
        await context.emitEvent("cancel_ack", "Worker observed cancellation.");
        return;
      }

      await markBackgroundJobSucceeded({
        jobId: job.id,
        workerId: this.options.workerId,
      });
      await scheduleNextPeriodicRun(job.kind as never);
    } catch (error) {
      await this.handleJobError(job, error);
    } finally {
      clearInterval(leaseTimer);
      if (cancelTimer) clearInterval(cancelTimer);
      clearTimeout(timeoutTimer);
    }
  }

  private async handleJobError(job: BackgroundJobRecord, error: unknown) {
    const errorMessage = getErrorMessage(error);
    const current = await findBackgroundJobById({ jobId: job.id }).catch(
      () => null,
    );

    if (current?.status === "cancelled") {
      await recordBackgroundJobEvent({
        jobId: job.id,
        type: "cancel_ack",
        message: "Worker stopped after cancellation.",
        workerId: this.options.workerId,
      });
      return;
    }

    const terminal = error instanceof TerminalJobError || isAbortError(error);
    const updatedJob = terminal
      ? await markBackgroundJobTerminal({
          jobId: job.id,
          workerId: this.options.workerId,
          errorCode: error instanceof TerminalJobError ? error.code : "timeout",
          errorMessage,
        })
      : await markBackgroundJobFailed({
          jobId: job.id,
          workerId: this.options.workerId,
          errorMessage,
        });

    if (job.kind === "restore.reconcile" && updatedJob) {
      if (updatedJob.status === "queued") {
        await markRestoreReconciliationRunQueued({
          backgroundJobId: job.id,
          errorMessage,
        });
      } else if (
        updatedJob.status === "dead" ||
        updatedJob.status === "failed"
      ) {
        await failRestoreReconciliationRun({
          backgroundJobId: job.id,
          errorMessage,
        });
      }
    }

    if (updatedJob?.status === "dead") {
      console.error("[worker] Background job dead-lettered after retries.", {
        jobId: job.id,
        kind: job.kind,
        error: errorMessage,
      });
    } else {
      console.warn("[worker] Background job failed.", {
        jobId: job.id,
        kind: job.kind,
        status: updatedJob?.status,
        error: errorMessage,
      });
    }
  }
}
