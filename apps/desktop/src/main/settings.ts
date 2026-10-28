import { existsSync, readFileSync } from "node:fs";
import { rm, writeFile, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, safeStorage } from "electron";

import type { Settings } from "../shared/types";

const GB = 1024 ** 3;

const defaults = (): Settings => ({
  serverUrl: null,
  email: null,
  deviceName: os.hostname().replace(/\.local$/, "") || "My computer",
  pairs: [],
  ignore: [],
  minFreeBytes: 5 * GB,
  uploadLimitKBps: null,
  downloadLimitKBps: null,
  pausedUntil: null,
  startAtLogin: true,
});

const file = () => path.join(app.getPath("userData"), "settings.json");
const tokenFile = () => path.join(app.getPath("userData"), "device-token");

/** Written to a temporary file first, so a crash never leaves half a file. */
const writeAtomic = async (target: string, data: string | Buffer) => {
  const temp = `${target}.tmp`;
  await writeFile(temp, data, { mode: 0o600, flush: true });
  await rename(temp, target);
};

export const loadSettings = (): Settings => {
  try {
    return { ...defaults(), ...JSON.parse(readFileSync(file(), "utf8")) };
  } catch {
    return defaults();
  }
};

export const saveSettings = (settings: Settings) =>
  writeAtomic(file(), JSON.stringify(settings, null, 2));

/** The device token, encrypted with the OS keychain where there is one. */
export const loadToken = () => {
  if (!existsSync(tokenFile())) return null;
  try {
    const data = readFileSync(tokenFile());
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(data)
      : data.toString("utf8");
  } catch {
    return null;
  }
};

export const saveToken = (token: string | null) =>
  token === null
    ? rm(tokenFile(), { force: true })
    : writeAtomic(
        tokenFile(),
        safeStorage.isEncryptionAvailable()
          ? safeStorage.encryptString(token)
          : Buffer.from(token),
      );
