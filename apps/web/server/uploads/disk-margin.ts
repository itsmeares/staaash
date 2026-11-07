import { formatBytes } from "@/lib/format-bytes";

/** Uploads are refused once free disk space would drop below this share. */
const UPLOAD_DISK_MARGIN_PERCENT = 10n;

export const uploadDiskMarginBytes = (totalBytes: bigint) =>
  (totalBytes * UPLOAD_DISK_MARGIN_PERCENT) / 100n;

export const describeDiskMargin = (marginBytes: bigint) =>
  `${UPLOAD_DISK_MARGIN_PERCENT}% of the disk (${formatBytes(marginBytes)})`;
