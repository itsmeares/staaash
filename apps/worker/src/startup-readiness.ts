import { setTimeout as delay } from "node:timers/promises";

import { areMigrationsApplied } from "@staaash/db/health";

import { isStorageProtocolReady } from "./storage-protocol-cutover.js";
import { writeHeartbeat } from "./storage-maintenance.js";

const readStorageProtocolReadySafely = async () => {
  try {
    return await isStorageProtocolReady();
  } catch (error) {
    console.warn("[worker] Storage readiness probe failed; retrying.", {
      error: error instanceof Error ? error.message : "Unknown error.",
    });
    return false;
  }
};

export const waitForStorageProtocolReady = async ({
  runMaintenance,
  heartbeatPath,
  retryDelayMs = 5_000,
}: {
  runMaintenance(): Promise<void>;
  heartbeatPath: string;
  retryDelayMs?: number;
}) => {
  while (!(await readStorageProtocolReadySafely())) {
    await runMaintenance();
    if (await readStorageProtocolReadySafely()) return;
    await writeHeartbeat(heartbeatPath);
    await delay(retryDelayMs);
  }
};

const readMigrationsAppliedSafely = async () => {
  try {
    return { ready: await areMigrationsApplied() };
  } catch (error) {
    return {
      ready: false,
      reason: error instanceof Error ? error.message : "Unknown error.",
    };
  }
};

/**
 * The web server runs the migrations as it starts. The worker waits here
 * before its first query, however long they take, so it never reads a table
 * that is not there yet. No container has to stay stopped for this to work.
 */
export const waitForMigrations = async ({
  heartbeatPath,
  retryDelayMs = 3_000,
}: {
  heartbeatPath: string;
  retryDelayMs?: number;
}) => {
  let last: string | undefined;
  for (;;) {
    const { ready, reason } = await readMigrationsAppliedSafely();
    if (ready) {
      if (last !== undefined)
        console.info("[worker] Database migrations done.");
      return;
    }
    const message = reason ?? "Migrations are still running.";
    // Logged when the reason changes, not every few seconds.
    if (message !== last)
      console.info("[worker] Waiting for database migrations.", {
        reason: message,
      });
    last = message;
    await writeHeartbeat(heartbeatPath);
    await delay(retryDelayMs);
  }
};
