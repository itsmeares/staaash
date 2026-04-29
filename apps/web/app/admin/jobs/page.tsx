import { ALL_SUPPORTED_JOB_KINDS } from "@staaash/db/jobs";

import { getLastRunPerKind } from "@/server/admin/jobs";

import { type JsonBackgroundJob, JobOperations } from "./job-operations";

export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  const lastRunPerKind = await getLastRunPerKind();

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
              createdAt: job.createdAt.toISOString(),
              updatedAt: job.updatedAt.toISOString(),
              lastError: job.lastError,
              attemptCount: job.attemptCount,
              maxAttempts: job.maxAttempts,
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
          jobKinds={[...ALL_SUPPORTED_JOB_KINDS]}
        />
      </section>
    </main>
  );
}
