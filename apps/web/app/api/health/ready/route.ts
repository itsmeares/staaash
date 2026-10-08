import { NextResponse } from "next/server";

import { getReadiness } from "@/server/health";

export async function GET() {
  const summary = await getReadiness();

  return NextResponse.json(
    {
      ok: summary.ok,
      checks: {
        app: summary.checks.app.status,
        database: summary.checks.database.status,
        storage: summary.checks.storage.status,
        worker: summary.worker.status,
        queue: summary.checks.queue.status,
        settings: summary.checks.settings.status,
        reconciliation: summary.reconciliation.status,
        storageMutations: summary.checks.storageMutations.status,
      },
      failures: summary.failures,
      operational: summary.operational,
    },
    {
      status: summary.ok ? 200 : 503,
    },
  );
}
