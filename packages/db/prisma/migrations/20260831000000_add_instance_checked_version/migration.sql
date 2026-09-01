ALTER TABLE "Instance" ADD COLUMN "checkedVersion" TEXT;

UPDATE "Instance"
SET
  "lastUpdateCheckAt" = NULL,
  "updateCheckStatus" = NULL,
  "updateCheckMessage" = NULL,
  "latestAvailableVersion" = NULL;
