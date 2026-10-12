import { ALL_SUPPORTED_JOB_KINDS } from "@staaash/db/jobs";

import {
  getAdminJobList,
  getAdminJobSummary,
  getLastRunPerKind,
  toJsonAdminJob,
  toJsonAdminJobSummary,
} from "@/server/admin/jobs";
import {
  getAdminMediaDerivativeSummary,
  toJsonAdminMediaDerivativeSummary,
} from "@/server/admin/media-derivatives";

import { type JsonBackgroundJob, JobOperations } from "./job-operations";
import {
  cancelDerivative,
  regenerateDerivative,
  removeDerivative,
  setPinDerivative,
} from "./media-derivative-actions";

export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  const [lastRunPerKind, queueSummary, mediaDerivatives, problems] =
    await Promise.all([
      getLastRunPerKind(),
      getAdminJobSummary(),
      getAdminMediaDerivativeSummary(),
      getAdminJobList({ status: ["failed", "dead"], limit: 20 }),
    ]);

  const initialLastRuns: Record<string, JsonBackgroundJob | null> =
    Object.fromEntries(
      Object.entries(lastRunPerKind).map(([kind, job]) => [
        kind,
        job ? toJsonAdminJob(job) : null,
      ]),
    );

  return (
    <main className="m-0 w-full p-0">
      <JobOperations
        derivativeActions={{
          cancelDerivative,
          regenerateDerivative,
          removeDerivative,
          setPinDerivative,
        }}
        initialProblems={problems.items.map(toJsonAdminJob)}
        initialDerivatives={toJsonAdminMediaDerivativeSummary(mediaDerivatives)}
        initialLastRuns={initialLastRuns}
        initialSummary={toJsonAdminJobSummary(queueSummary)}
        jobKinds={[...ALL_SUPPORTED_JOB_KINDS]}
      />
    </main>
  );
}
