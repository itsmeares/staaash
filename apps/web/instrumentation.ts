export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getAuthSecret } = await import("./server/settings");
    await getAuthSecret();
    const { verifyCommittedStorageUsage } =
      await import("@staaash/db/reconciliation");
    await verifyCommittedStorageUsage();
  }
}
