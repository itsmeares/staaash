export const UPLOAD_SESSION_STATUS_ALLOCATING = "allocating";
export const UPLOAD_SESSION_STATUS_CREATED = "created";
export const UPLOAD_SESSION_STATUS_RECEIVING = "receiving";
export const UPLOAD_SESSION_STATUS_COMMITTING = "committing";
export const UPLOAD_SESSION_STATUS_COMPLETED = "completed";
export const UPLOAD_SESSION_STATUS_FAILED = "failed";
export const UPLOAD_SESSION_STATUS_CANCELLED = "cancelled";
export const UPLOAD_SESSION_STATUS_EXPIRED = "expired";

export const ACTIVE_UPLOAD_SESSION_STATUSES = [
  UPLOAD_SESSION_STATUS_ALLOCATING,
  UPLOAD_SESSION_STATUS_CREATED,
  UPLOAD_SESSION_STATUS_RECEIVING,
] as const;

export const RECEIVABLE_UPLOAD_SESSION_STATUSES = [
  UPLOAD_SESSION_STATUS_CREATED,
  UPLOAD_SESSION_STATUS_RECEIVING,
] as const;

export const TERMINAL_UPLOAD_SESSION_STATUSES = [
  UPLOAD_SESSION_STATUS_COMPLETED,
  UPLOAD_SESSION_STATUS_FAILED,
  UPLOAD_SESSION_STATUS_CANCELLED,
  UPLOAD_SESSION_STATUS_EXPIRED,
] as const;

export const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const UPLOAD_ALLOCATION_LEASE_MS = 10 * 60 * 1000;
export const UPLOAD_TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;
export const STAGING_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const CLEANUP_WINDOWS_PER_RETENTION =
  UPLOAD_TERMINAL_RETENTION_MS / STAGING_CLEANUP_INTERVAL_MS;

// Fixed caps against runaway clients. The staging byte limits, which admins
// set, are what protect the disk.
export const OPEN_SESSION_LIMITS = { perUser: 32, instance: 128 };

// Finished sessions wait for cleanup. More than a retention's worth of them
// means cleanup is behind, so new sessions wait for it.
export const TERMINAL_BACKLOG_LIMITS = {
  perUser: OPEN_SESSION_LIMITS.perUser * CLEANUP_WINDOWS_PER_RETENTION,
  instance: OPEN_SESSION_LIMITS.instance * CLEANUP_WINDOWS_PER_RETENTION,
};

export const isTerminalUploadSessionStatus = (status: string) =>
  (TERMINAL_UPLOAD_SESSION_STATUSES as readonly string[]).includes(status);
