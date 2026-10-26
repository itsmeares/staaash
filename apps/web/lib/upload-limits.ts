// Small direct uploads use multipart; larger files use the resumable protocol.
export const DIRECT_UPLOAD_MAX_REQUEST_BYTES = 128 * 1024 * 1024;
export const DIRECT_UPLOAD_REQUEST_TOO_LARGE_MESSAGE =
  "Direct upload request is too large.";
