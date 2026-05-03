import { getPrisma } from "./client";

export type UpdateCheckStatus =
  | "unavailable"
  | "up-to-date"
  | "update-available"
  | "error";

export type InstanceUpdateCheckState = {
  lastUpdateCheckAt: Date | null;
  updateCheckStatus: UpdateCheckStatus | null;
  updateCheckMessage: string | null;
  latestAvailableVersion: string | null;
};

type InstanceClient = {
  instance: {
    findUnique(args: object): Promise<InstanceUpdateCheckState | null>;
    updateMany(args: object): Promise<unknown>;
  };
};

export const readInstanceUpdateCheck = async (
  client?: InstanceClient,
): Promise<InstanceUpdateCheckState> => {
  const activeClient = client ?? (getPrisma() as unknown as InstanceClient);

  const instance = await activeClient.instance.findUnique({
    where: { id: "singleton" },
    select: {
      lastUpdateCheckAt: true,
      updateCheckStatus: true,
      updateCheckMessage: true,
      latestAvailableVersion: true,
    },
  });

  return (
    instance ?? {
      lastUpdateCheckAt: null,
      updateCheckStatus: null,
      updateCheckMessage: null,
      latestAvailableVersion: null,
    }
  );
};

export const writeInstanceUpdateCheck = async (
  {
    lastUpdateCheckAt,
    updateCheckStatus,
    updateCheckMessage,
    latestAvailableVersion,
  }: Partial<InstanceUpdateCheckState>,
  client?: InstanceClient,
): Promise<void> => {
  const activeClient = client ?? (getPrisma() as unknown as InstanceClient);

  const data: Record<string, unknown> = {};

  if (lastUpdateCheckAt !== undefined) {
    data.lastUpdateCheckAt = lastUpdateCheckAt;
  }

  if (updateCheckStatus !== undefined) {
    data.updateCheckStatus = updateCheckStatus;
  }

  if (updateCheckMessage !== undefined) {
    data.updateCheckMessage = updateCheckMessage;
  }

  if (latestAvailableVersion !== undefined) {
    data.latestAvailableVersion = latestAvailableVersion;
  }

  await activeClient.instance.updateMany({
    where: { id: "singleton" },
    data,
  });
};
