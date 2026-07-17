import { resolveRuntimeVersion } from "@staaash/config/version";

import packageMetadata from "../package.json" with { type: "json" };

export const resolveWorkerVersion = (
  appVersion: string | null | undefined = process.env.APP_VERSION,
) =>
  resolveRuntimeVersion({
    packageVersion: packageMetadata.version,
    appVersion,
  });
