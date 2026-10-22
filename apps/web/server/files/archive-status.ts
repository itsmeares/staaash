import {
  ZIP_ARCHIVE_STATUS_PROCESSING,
  ZIP_ARCHIVE_STATUS_READY,
} from "@staaash/db/zip-archives";

import {
  assertStorageEntityReadable,
  StorageEntityUnavailableError,
} from "@/server/storage-read-guard";

export async function getReadableArchiveStatus(archive: {
  id: string;
  status: string;
}) {
  if (archive.status !== ZIP_ARCHIVE_STATUS_READY) return archive.status;
  try {
    await assertStorageEntityReadable("archive", archive.id);
    return ZIP_ARCHIVE_STATUS_READY;
  } catch (error) {
    if (
      !(error instanceof StorageEntityUnavailableError) ||
      error.code === "STORAGE_RECOVERY_REQUIRED"
    ) {
      throw error;
    }
    return ZIP_ARCHIVE_STATUS_PROCESSING;
  }
}
