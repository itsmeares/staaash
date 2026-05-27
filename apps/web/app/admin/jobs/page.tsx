import { ALL_SUPPORTED_JOB_KINDS } from "@staaash/db/jobs";

import { getAdminJobSummary, getLastRunPerKind } from "@/server/admin/jobs";
import { getSystemSettings } from "@/server/settings";

import { type JsonBackgroundJob, JobOperations } from "./job-operations";

export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  const [lastRunPerKind, queueSummary, settings] = await Promise.all([
    getLastRunPerKind(),
    getAdminJobSummary(),
    getSystemSettings(),
  ]);

  const initialLastRuns: Record<string, JsonBackgroundJob | null> =
    Object.fromEntries(
      Object.entries(lastRunPerKind).map(([kind, job]) => [
        kind,
        job
          ? {
              id: job.id,
              kind: job.kind,
              status: job.status,
              runAt: job.runAt.toISOString(),
              lockedAt: job.lockedAt?.toISOString() ?? null,
              leaseExpiresAt: job.leaseExpiresAt?.toISOString() ?? null,
              startedAt: job.startedAt?.toISOString() ?? null,
              completedAt: job.completedAt?.toISOString() ?? null,
              cancelledAt: job.cancelledAt?.toISOString() ?? null,
              createdAt: job.createdAt.toISOString(),
              updatedAt: job.updatedAt.toISOString(),
              lastError: job.lastError,
              attemptCount: job.attemptCount,
              maxAttempts: job.maxAttempts,
              dedupeKey: job.dedupeKey,
              payloadJson: job.payloadJson as Record<string, unknown> | null,
            }
          : null,
      ]),
    );

  return (
    <main className="stack" style={{ gap: "40px" }}>
      <section>
        <h1 style={{ marginBottom: "8px" }}>Workers</h1>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          Run and monitor background operations on this instance.
        </p>
      </section>

      <section>
        <JobOperations
          initialLastRuns={initialLastRuns}
          initialSummary={{
            ...queueSummary,
            nextQueuedRunAt:
              queueSummary.nextQueuedRunAt?.toISOString() ?? null,
            workers: queueSummary.workers.map((worker) => ({
              ...worker,
              startedAt: worker.startedAt.toISOString(),
              lastHeartbeatAt: worker.lastHeartbeatAt.toISOString(),
              stoppedAt: worker.stoppedAt?.toISOString() ?? null,
              createdAt: worker.createdAt.toISOString(),
              updatedAt: worker.updatedAt.toISOString(),
            })),
          }}
          jobKinds={[...ALL_SUPPORTED_JOB_KINDS]}
          instanceTimeZone={settings.timeZone}
        />
      </section>
    </main>
  );
}
