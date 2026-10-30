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
  setupSkipped: false,
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

const ENCRYPTED = 0x65;
const PLAIN = 0x70;

/**
 * The device token, encrypted with the OS keychain where there is one. The
 * first byte says which: a token saved without a keychain must not be fed to
 * the decrypter later, and the other way round. Only call after app ready;
 * before it, the keychain reads as missing on Windows and Linux.
 */
export const loadToken = () => {
  if (!existsSync(tokenFile())) return null;
  try {
    const data = readFileSync(tokenFile());
    const body = data.subarray(1);
    if (data[0] === ENCRYPTED) return safeStorage.decryptString(body);
    if (data[0] === PLAIN) return body.toString("utf8");
    return null;
  } catch {
    return null;
  }
};

export const saveToken = (token: string | null) => {
  if (token === null) return rm(tokenFile(), { force: true });
  const encrypted = safeStorage.isEncryptionAvailable();
  return writeAtomic(
    tokenFile(),
    Buffer.concat([
      Buffer.from([encrypted ? ENCRYPTED : PLAIN]),
      encrypted ? safeStorage.encryptString(token) : Buffer.from(token),
    ]),
  );
};
