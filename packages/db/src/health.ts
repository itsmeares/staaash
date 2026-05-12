import { Client } from "pg";

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
  message?: string;
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown database error.";

const withClient = async <T>(
  databaseUrl: string,
  work: (client: Client) => Promise<T>,
) => {
  const client = new Client({
    connectionString: databaseUrl,
  });

  await client.connect();

  try {
    return await work(client);
  } finally {
    await client.end();
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
      message: "DATABASE_URL is not configured.",
    };
  }

  try {
    return await withClient(databaseUrl, async (client) => {
      const result = await client.query<{ status: string; count: string }>(
        'SELECT status, COUNT(*)::text AS count FROM "BackgroundJob" GROUP BY status',
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
      status: "warning",
      message: getErrorMessage(error),
    };
  }
};
