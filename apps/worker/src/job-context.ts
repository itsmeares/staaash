import type { WorkerStoragePaths } from "./storage-maintenance.js";

export type JobContext = {
  signal: AbortSignal;
  workerId: string;
  storagePaths: WorkerStoragePaths;
  emitEvent: (
    type: string,
    message?: string,
    metadataJson?: Record<string, unknown>,
  ) => Promise<void>;
  updateProgress: (progressJson: Record<string, unknown>) => Promise<void>;
};

export class TerminalJobError extends Error {
  readonly code: string;

  constructor(message: string, code = "terminal") {
    super(message);
    this.name = "TerminalJobError";
    this.code = code;
  }
}

export const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown worker error.";
