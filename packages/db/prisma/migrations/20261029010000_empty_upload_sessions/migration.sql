-- An emptied file is replaced through a resumable session, so it keeps its id.

ALTER TABLE "UploadSession"
DROP CONSTRAINT "UploadSession_totalSizeBytes_positive_check",
ADD CONSTRAINT "UploadSession_totalSizeBytes_nonnegative_check"
CHECK ("totalSizeBytes" >= 0);
