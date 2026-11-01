import { appendFileSync, renameSync, statSync } from "node:fs";

export const SYNC_LOG_NAME = "sync.log";

const MAX_BYTES = 1024 * 1024;
const REPEAT_AFTER_MS = 60 * 60_000;

export type SyncLog = (stage: string, error: unknown) => void;

/**
 * Only these fields are written, never a whole error object: a request's
 * headers, which hold the device token, must stay out of the file.
 */
const describe = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const { code, status } = error as Error & {
    code?: string | number;
    status?: number;
  };
  const facts = Object.entries({ code, status })
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}: ${value}\n`)
    .join("");
  const cause = error.cause ? `\ncaused by: ${describe(error.cause)}` : "";
  return `${facts}${error.stack ?? `${error.name}: ${error.message}`}${cause}`;
};

const append = (file: string, text: string) => {
  try {
    const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
    if (size >= MAX_BYTES) renameSync(file, `${file}.1`);
    appendFileSync(file, `${new Date().toISOString()} ${text}\n\n`);
  } catch {
    // A full or read-only disk must not stop sync over its own log.
  }
};

/**
 * Keeps what went wrong on this computer, for finding the cause later: this
 * file and one older file. A failing pass repeats every minute, so the same
 * failure is written once an hour.
 */
export const createSyncLog = (file: string): SyncLog => {
  const written = new Map<string, number>();
  return (stage, error) => {
    const text = `${stage}\n${describe(error)}`;
    if (Date.now() - (written.get(text) ?? 0) < REPEAT_AFTER_MS) return;
    if (written.size >= 100) written.clear();
    written.set(text, Date.now());
    append(file, text);
  };
};
