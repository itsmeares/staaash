import { tryGetContext } from "hono/context-storage";

/** The device session behind the current request, if a device token sent it. */
export const requestDeviceId = () => {
  const session = tryGetContext<{
    Variables: { session?: { id: string; deviceName: string | null } };
  }>()?.var.session;
  return session?.deviceName ? session.id : null;
};
