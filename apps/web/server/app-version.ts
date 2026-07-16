import { version as packageVersion } from "../package.json";
import { resolveRuntimeVersion } from "@staaash/config/version";

export const resolveAppVersion = (
  appVersion: string | undefined = process.env.APP_VERSION,
) => resolveRuntimeVersion({ packageVersion, appVersion });
