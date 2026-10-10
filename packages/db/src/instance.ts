import { getPrisma } from "./client";

/** Postgres channel the worker notifies after a check stores new releases. */
export const UPDATE_STATE_CHANGED_CHANNEL = "staaash_update_state_changed";

export type UpdateRelease = {
  version: string;
  name: string | null;
  /** Release notes as written on GitHub (markdown). */
  notes: string;
  publishedAt: string | null;
  url: string | null;
};

export type InstanceUpdateState = {
  lastUpdateCheckAt: Date | null;
  updateCheckError: string | null;
  /** Newest first, on the channel that was active at check time. */
  updateReleases: UpdateRelease[];
};

type InstanceRow = {
  lastUpdateCheckAt: Date | null;
  updateCheckError: string | null;
  updateReleases: unknown;
};

type InstanceClient = {
  instance: {
    findUnique(args: object): Promise<InstanceRow | null>;
    updateMany(args: object): Promise<unknown>;
  };
  $executeRawUnsafe?: (query: string, ...values: unknown[]) => Promise<unknown>;
};

const isRelease = (value: unknown): value is UpdateRelease =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as UpdateRelease).version === "string" &&
  typeof (value as UpdateRelease).notes === "string";

export const readInstanceUpdateState = async (
  client?: InstanceClient,
): Promise<InstanceUpdateState> => {
  const activeClient = client ?? (getPrisma() as unknown as InstanceClient);
  const row = await activeClient.instance.findUnique({
    where: { id: "singleton" },
    select: {
      lastUpdateCheckAt: true,
      updateCheckError: true,
      updateReleases: true,
    },
  });
  return {
    lastUpdateCheckAt: row?.lastUpdateCheckAt ?? null,
    updateCheckError: row?.updateCheckError ?? null,
    updateReleases: Array.isArray(row?.updateReleases)
      ? row.updateReleases.filter(isRelease)
      : [],
  };
};

/**
 * Stores a check result and tells listening web processes. A failed check
 * keeps the releases from the last good one.
 */
export const writeInstanceUpdateCheck = async (
  result:
    | { checkedAt: Date; releases: UpdateRelease[] }
    | { checkedAt: Date; error: string },
  client?: InstanceClient,
): Promise<void> => {
  const activeClient = client ?? (getPrisma() as unknown as InstanceClient);
  await activeClient.instance.updateMany({
    where: { id: "singleton" },
    data:
      "error" in result
        ? {
            lastUpdateCheckAt: result.checkedAt,
            updateCheckError: result.error,
          }
        : {
            lastUpdateCheckAt: result.checkedAt,
            updateCheckError: null,
            updateReleases: result.releases,
          },
  });
  await activeClient
    .$executeRawUnsafe?.(
      `SELECT pg_notify('${UPDATE_STATE_CHANGED_CHANNEL}', '')`,
    )
    .catch(() => undefined);
};
