// Small direct uploads use multipart; larger files use the resumable protocol.
const DIRECT_UPLOAD_MAX_REQUEST_BYTES = 128 * 1024 * 1024;
export const DIRECT_UPLOAD_REQUEST_TOO_LARGE_MESSAGE =
  "Direct upload request is too large.";

export const isDirectUploadRequestTooLarge = (contentLength: string | null) => {
  if (contentLength === null) return false;

  const normalized = contentLength.trim();
  if (!/^\d+$/.test(normalized)) return true;

  const sizeBytes = Number(normalized);
  return (
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes > DIRECT_UPLOAD_MAX_REQUEST_BYTES
  );
};
