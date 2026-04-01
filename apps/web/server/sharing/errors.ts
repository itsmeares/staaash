export type ShareErrorCode =
  | "SHARE_ACCESS_DENIED"
  | "SHARE_DOWNLOAD_DISABLED"
  | "SHARE_EXPIRED"
  | "SHARE_INVALID"
  | "SHARE_NOT_FOUND"
  | "SHARE_PASSWORD_INVALID"
  | "SHARE_PASSWORD_REQUIRED"
  | "SHARE_TARGET_UNAVAILABLE";

const shareErrorMessages: Record<ShareErrorCode, string> = {
  SHARE_ACCESS_DENIED: "That shared item is not available from this location.",
  SHARE_DOWNLOAD_DISABLED: "Downloads are disabled for this shared link.",
  SHARE_EXPIRED: "That shared link has expired.",
  SHARE_INVALID: "That shared link is not valid.",
  SHARE_NOT_FOUND: "That shared link could not be found.",
  SHARE_PASSWORD_INVALID: "That password did not unlock the shared link.",
  SHARE_PASSWORD_REQUIRED: "That shared link requires a password.",
  SHARE_TARGET_UNAVAILABLE: "That shared item is currently unavailable.",
};

const shareErrorStatuses: Record<ShareErrorCode, number> = {
  SHARE_ACCESS_DENIED: 403,
  SHARE_DOWNLOAD_DISABLED: 403,
  SHARE_EXPIRED: 410,
  SHARE_INVALID: 404,
  SHARE_NOT_FOUND: 404,
  SHARE_PASSWORD_INVALID: 401,
  SHARE_PASSWORD_REQUIRED: 401,
  SHARE_TARGET_UNAVAILABLE: 410,
};

export class ShareError extends Error {
  readonly code: ShareErrorCode;
  readonly status: number;

  constructor(code: ShareErrorCode, message = shareErrorMessages[code]) {
    super(message);
    this.name = "ShareError";
    this.code = code;
    this.status = shareErrorStatuses[code];
  }
}

export const isShareError = (error: unknown): error is ShareError =>
  error instanceof ShareError;
