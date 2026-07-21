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
export const CLEANUP_WINDOWS_PER_RETENTION =
  UPLOAD_TERMINAL_RETENTION_MS / STAGING_CLEANUP_INTERVAL_MS;

export const getTerminalBacklogLimits = ({
  perUserActiveLimit,
  instanceActiveLimit,
}: {
  perUserActiveLimit: number;
  instanceActiveLimit: number;
}) => ({
  perUser: perUserActiveLimit * CLEANUP_WINDOWS_PER_RETENTION,
  instance: instanceActiveLimit * CLEANUP_WINDOWS_PER_RETENTION,
});

export const isTerminalUploadSessionStatus = (status: string) =>
  (TERMINAL_UPLOAD_SESSION_STATUSES as readonly string[]).includes(status);
