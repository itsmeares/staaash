import { existsSync, readFileSync } from "node:fs";
import { rm, writeFile, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, safeStorage } from "electron";

import { FILES_AT_ONCE } from "../shared/files-at-once";
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
  filesAtOnce: FILES_AT_ONCE.default,
  pausedUntil: null,
  startAtLogin: true,
  setupSkipped: false,
  updateChannel: "auto",
  confirmStopSync: true,
  theme: "system",
});

const file = () => path.join(app.getPath("userData"), "settings.json");
const tokenFile = () => path.join(app.getPath("userData"), "device-token");

/** Written to a temporary file first, so a crash never leaves half a file. */
const writeAtomic = async (target: string, data: string | Buffer) => {
  const temp = `${target}.tmp`;
  await writeFile(temp, data, { mode: 0o600, flush: true });
  await rename(temp, target);
};

const THEMES = new Set(["system", "light", "dark"]);

export const loadSettings = (): Settings => {
  try {
    const saved: Settings = {
      ...defaults(),
      ...JSON.parse(readFileSync(file(), "utf8")),
    };
    // Electron takes only these three, and a hand-edited file may hold more.
    if (!THEMES.has(saved.theme)) saved.theme = "system";
    return saved;
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
