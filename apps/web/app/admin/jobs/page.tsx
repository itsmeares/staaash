import { ALL_SUPPORTED_JOB_KINDS } from "@staaash/db/jobs";

import {
  getAdminJobSummary,
  getLastRunPerKind,
  toJsonAdminJob,
  toJsonAdminJobSummary,
} from "@/server/admin/jobs";
import { getSystemSettings } from "@/server/settings";
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
  const [lastRunPerKind, queueSummary, settings, mediaDerivatives] =
    await Promise.all([
      getLastRunPerKind(),
      getAdminJobSummary(),
      getSystemSettings(),
      getAdminMediaDerivativeSummary(),
    ]);

  const initialLastRuns: Record<string, JsonBackgroundJob | null> =
    Object.fromEntries(
      Object.entries(lastRunPerKind).map(([kind, job]) => [
        kind,
        job ? toJsonAdminJob(job) : null,
      ]),
    );

  return (
    <main>
      <JobOperations
        derivativeActions={{
          cancelDerivative,
          regenerateDerivative,
          removeDerivative,
          setPinDerivative,
        }}
        initialDerivatives={toJsonAdminMediaDerivativeSummary(mediaDerivatives)}
        initialLastRuns={initialLastRuns}
        initialSummary={toJsonAdminJobSummary(queueSummary)}
        jobKinds={[...ALL_SUPPORTED_JOB_KINDS]}
        instanceTimeZone={settings.timeZone}
      />
    </main>
  );
}
