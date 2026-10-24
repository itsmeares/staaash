import { verifyCommittedStorageUsage } from "@staaash/db/reconciliation";

import { getAuthSecret } from "@/server/settings";

/** Runs before the server listens: the auth secret exists and quotas add up. */
export const startup = async () => {
  await getAuthSecret();
  await verifyCommittedStorageUsage();
};
