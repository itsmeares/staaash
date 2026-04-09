import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { writeInstanceUpdateCheck } from "@staaash/db/instance";

/**
 * Update-check handler (Phase 6 scaffold).
 *
 * In this phase the handler only stamps `lastUpdateCheckAt` and sets a
 * placeholder status. No real upstream network request is made yet. A clear
 * message is written so the admin health surface can show meaningful output.
 */
export const handleUpdateCheck = async (
  _job: BackgroundJobRecord,
): Promise<void> => {
  await writeInstanceUpdateCheck({
    lastUpdateCheckAt: new Date(),
    updateCheckStatus: "placeholder",
    updateCheckMessage:
      "Upstream release lookup is not wired yet. Update checks will be active in a future release.",
    latestAvailableVersion: null,
  });
};
