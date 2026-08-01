import { setTimeout as delay } from "node:timers/promises";

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
