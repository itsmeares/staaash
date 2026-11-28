import { Client } from "pg";
import { ZIP_ARCHIVE_GENERATE_JOB_KIND } from "./jobs";

export type HealthCheckStatus = "healthy" | "warning" | "error";

export type QueueBacklogSummary = {
  queued: number;
  running: number;
  failed: number;
  dead: number;
  cancelled: number;
  oldestQueuedAgeSeconds: number | null;
  staleRunning: number;
  status: HealthCheckStatus;
  probeStatus: "healthy" | "error";
  message?: string;
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown database error.";

const withClient = async <T>(
  databaseUrl: string,
  work: (client: Client) => Promise<T>,
) => {
  // A probe that hangs on a stalled network would hang its caller too: the
  // readiness route, or the worker's migration wait and its heartbeat.
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
  });

  await client.connect();

  try {
    return await work(client);
  } finally {
    // Closing waits on the same network, so it is not awaited either.
    client.end().catch(() => {});
  }
};

export const probeDatabaseReachability = async (
  databaseUrl = process.env.DATABASE_URL,
) => {
  if (!databaseUrl) {
    return {
      status: "error" as const,
      message: "DATABASE_URL is not configured.",
    };
  }

  try {
    await withClient(databaseUrl, async (client) => {
      await client.query("SELECT 1");
    });

    return {
      status: "healthy" as const,
    };
  } catch (error) {
    return {
      status: "error" as const,
      message: getErrorMessage(error),
    };
  }
};

// The newest folder in prisma/migrations, set at build time (vite.config.ts).
declare const __STAAASH_LATEST_MIGRATION__: string;

/**
 * Whether the database has every migration this build ships: the newest one
 * finished and none left half applied. Throws while the database cannot be
 * reached or has never been migrated.
 */
export const areMigrationsApplied = async (
  databaseUrl = process.env.DATABASE_URL,
) => {
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
  return withClient(databaseUrl, async (client) => {
    const result = await client.query<{ ready: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM "_prisma_migrations"
         WHERE migration_name = $1
           AND finished_at IS NOT NULL AND rolled_back_at IS NULL
       ) AND NOT EXISTS (
         SELECT 1 FROM "_prisma_migrations"
         WHERE finished_at IS NULL AND rolled_back_at IS NULL
       ) AS ready`,
      [__STAAASH_LATEST_MIGRATION__],
    );
    return result.rows[0]?.ready === true;
  });
};

export const getQueueBacklogSummary = async (
  databaseUrl = process.env.DATABASE_URL,
): Promise<QueueBacklogSummary> => {
  if (!databaseUrl) {
    return {
      queued: 0,
      running: 0,
      failed: 0,
      dead: 0,
      cancelled: 0,
      oldestQueuedAgeSeconds: null,
      staleRunning: 0,
      status: "error",
      probeStatus: "error",
      message: "DATABASE_URL is not configured.",
    };
  }

  try {
    return await withClient(databaseUrl, async (client) => {
      // A failed zip belongs to one download, and the person downloading
      // sees it there. It is not something for the owner to fix.
      const result = await client.query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::text AS count FROM "BackgroundJob"
         WHERE NOT (kind = $1 AND status IN ('failed', 'dead'))
         GROUP BY status`,
        [ZIP_ARCHIVE_GENERATE_JOB_KIND],
      );

      const counts = {
        queued: 0,
        running: 0,
        failed: 0,
        dead: 0,
        cancelled: 0,
      };

      for (const row of result.rows) {
        if (row.status in counts) {
          counts[row.status as keyof typeof counts] = Number(row.count);
        }
      }

      const [oldestQueuedResult, staleRunningResult] = await Promise.all([
        client.query<{ age_seconds: string | null }>(
          'SELECT EXTRACT(EPOCH FROM (NOW() - MIN("runAt")))::text AS age_seconds FROM "BackgroundJob" WHERE status = $1',
          ["queued"],
        ),
        client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM "BackgroundJob"
           WHERE status = 'running'
             AND (
               ("leaseExpiresAt" IS NOT NULL AND "leaseExpiresAt" <= NOW())
               OR ("leaseExpiresAt" IS NULL AND "lockedAt" <= NOW() - INTERVAL '60 seconds')
             )`,
        ),
      ]);

      const status: HealthCheckStatus =
        counts.dead > 0 || Number(staleRunningResult.rows[0]?.count ?? 0) > 0
          ? "error"
          : counts.failed > 0
            ? "warning"
            : "healthy";

      return {
        ...counts,
        probeStatus: "healthy",
        oldestQueuedAgeSeconds: oldestQueuedResult.rows[0]?.age_seconds
          ? Math.max(
              0,
              Math.floor(Number(oldestQueuedResult.rows[0].age_seconds)),
            )
          : null,
        staleRunning: Number(staleRunningResult.rows[0]?.count ?? 0),
        status,
      };
    });
  } catch (error) {
    return {
      queued: 0,
      running: 0,
      failed: 0,
      dead: 0,
      cancelled: 0,
      oldestQueuedAgeSeconds: null,
      staleRunning: 0,
      status: "error",
      probeStatus: "error",
      message: getErrorMessage(error),
    };
  }
};
