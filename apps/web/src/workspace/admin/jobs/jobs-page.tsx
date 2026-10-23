import { useSuspenseQuery } from "@tanstack/react-query";

import { adminJobsQuery } from "@/src/queries";

import { JobOperations } from "./job-operations";

export function AdminJobsPage() {
  const data = useSuspenseQuery(adminJobsQuery).data;
  return (
    <main className="m-0 w-full p-0">
      <JobOperations
        initialDerivatives={data.initialDerivatives}
        initialLastRuns={data.initialLastRuns}
        initialProblems={data.initialProblems}
        initialSummary={data.initialSummary}
        jobKinds={data.jobKinds}
      />
    </main>
  );
}
