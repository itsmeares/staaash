import { version as packageVersion } from "../package.json";

export const resolveAppVersion = (
  staaashVersion: string | undefined = process.env.STAAASH_VERSION,
  appVersion: string | undefined = process.env.APP_VERSION,
) => staaashVersion ?? appVersion ?? packageVersion;
