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
  type BackgroundJobLane,
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
import { recoverStorageMutations } from "./handlers/storage-mutation-recovery.js";
import { JobNotifications } from "./job-notifications.js";

const MIN_IDLE_DELAY_MS = 1_000;
const MAX_IDLE_DELAY_MS = 30_000;
const SCHEDULER_TICK_MS = 60_000;
const MOVE_STORAGE_MUTATION_CONCURRENCY = 5;
const STORAGE_MUTATION_POLL_MS = 1_000;

const isAbortError = (error: unknown) =>
  error instanceof Error &&
  (error.name === "AbortError" || error.message.includes("aborted"));

export class WorkerRunner {
  private stopping = false;
  private idleDelayMs = MIN_IDLE_DELAY_MS;
  private activeJobController: AbortController | null = null;
  private processing: Promise<boolean> | null = null;
  private storageMutationLoop: Promise<void> | null = null;
  private schedulerTimer: NodeJS.Timeout | null = null;
  private idleWait = new AbortController();
  private readonly jobNotifications = new JobNotifications(() => {
    this.idleWait.abort();
  });

  constructor(
    private readonly options: {
      workerId: string;
      storagePaths: WorkerStoragePaths;
      leaseMs?: number;
      lane?: BackgroundJobLane;
    },
  ) {}

  async start() {
    if (!this.options.lane || this.options.lane === "general") {
      this.storageMutationLoop = this.runStorageMutationLoop();
      this.schedulerTimer = setInterval(() => {
        void schedulePeriodicJobs().catch((error) => {
          console.warn("[worker] Failed to schedule periodic jobs.", {
            error: getErrorMessage(error),
          });
        });
      }, SCHEDULER_TICK_MS);
    }

    while (!this.stopping) {
      // Arm before querying so a notification between the last claim and sleep is retained.
      this.idleWait = new AbortController();
      this.jobNotifications.connect();
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
        await delay(this.idleDelayMs, undefined, {
          signal: this.idleWait.signal,
        }).catch((error: unknown) => {
          if (!isAbortError(error)) throw error;
        });
      }
    }

    await this.storageMutationLoop;
  }

  async stop(timeoutMs = 25_000) {
    this.stopping = true;
    this.idleWait.abort();
    this.jobNotifications.close();
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    this.activeJobController?.abort();

    const active = [this.processing, this.storageMutationLoop].filter(
      (value) => value !== null,
    );
    if (active.length === 0) return;

    await Promise.race([
      Promise.allSettled(active).then(() => undefined),
      delay(timeoutMs, undefined, { ref: false }).then(() => undefined),
    ]);
  }

  private async runStorageMutationLoop() {
    while (!this.stopping) {
      try {
        await recoverStorageMutations({
          storagePaths: this.options.storagePaths,
          leaseOwner: `storage-move:${this.options.workerId}`,
          kinds: ["batch_move"],
          take: MOVE_STORAGE_MUTATION_CONCURRENCY,
          concurrency: MOVE_STORAGE_MUTATION_CONCURRENCY,
        });
      } catch (error) {
        console.warn("[worker] Move operation poll failed.", {
          error: getErrorMessage(error),
        });
      }

      if (!this.stopping) await delay(STORAGE_MUTATION_POLL_MS);
    }
  }

  async drainDueJobs() {
    let processed = false;

    while (!this.stopping) {
      this.processing = this.processNextJob();
      let didProcess: boolean;
      try {
        didProcess = await this.processing;
      } finally {
        this.processing = null;
      }
      if (!didProcess) return processed;
      processed = true;
    }

    return processed;
  }

  async processNextJob(): Promise<boolean> {
    const job = await claimDueBackgroundJob({
      workerId: this.options.workerId,
      lane: this.options.lane,
      leaseMs: this.options.leaseMs ?? BACKGROUND_JOB_LEASE_MS,
    });

    // A claim completed during shutdown is left leased for restart recovery.
    if (!job || this.stopping) return false;

    const controller = new AbortController();
    this.activeJobController = controller;

    try {
      await this.runClaimedJob(job, controller);
    } finally {
      this.activeJobController = null;
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
      await entry.run(job, this.options.storagePaths, context);
      await this.finishJob(job, controller.signal);
    } catch (error) {
      if (!this.stopping) await this.handleJobError(job, error);
    } finally {
      clearInterval(leaseTimer);
      if (cancelTimer) clearInterval(cancelTimer);
      clearTimeout(timeoutTimer);
    }
  }

  private async finishJob(job: BackgroundJobRecord, signal: AbortSignal) {
    const current = await findBackgroundJobById({ jobId: job.id });

    // Only the stored status says a job was cancelled. A handler that stops
    // early for its own reasons is finished; leaving the job running would
    // hand it back out when the lease runs out, forever.
    if (current?.status === "cancelled") {
      await recordBackgroundJobEvent({
        jobId: job.id,
        type: "cancel_ack",
        message: "Worker observed cancellation.",
        workerId: this.options.workerId,
      });
      return;
    }

    if (this.stopping) return;
    signal.throwIfAborted();

    await markBackgroundJobSucceeded({
      jobId: job.id,
      workerId: this.options.workerId,
    });
    await scheduleNextPeriodicRun(job.kind as never);
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

    if (updatedJob?.status === "dead" || updatedJob?.status === "failed") {
      await scheduleNextPeriodicRun(job.kind as never).catch(
        (scheduleError) => {
          console.warn("[worker] Failed to schedule the next periodic run.", {
            jobId: job.id,
            kind: job.kind,
            error: getErrorMessage(scheduleError),
          });
        },
      );
    }
  }
}
