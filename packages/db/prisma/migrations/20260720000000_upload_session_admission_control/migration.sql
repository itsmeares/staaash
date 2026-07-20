ALTER TABLE "SystemSettings"
ADD COLUMN "resumableMaxActiveSessionsPerUser" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN "resumableMaxActiveSessionsInstance" INTEGER NOT NULL DEFAULT 32,
ADD COLUMN "resumableMaxReservedBytesPerUser" BIGINT NOT NULL DEFAULT 21474836480,
ADD COLUMN "resumableMaxReservedBytesInstance" BIGINT NOT NULL DEFAULT 107374182400;

UPDATE "SystemSettings"
SET
  "resumableMaxReservedBytesPerUser" = GREATEST(
    "resumableMaxReservedBytesPerUser",
    "maxUploadBytes"
  ),
  "resumableMaxReservedBytesInstance" = GREATEST(
    "resumableMaxReservedBytesInstance",
    "resumableMaxReservedBytesPerUser",
    "maxUploadBytes"
  );

ALTER TABLE "SystemSettings"
ADD CONSTRAINT "SystemSettings_resumable_active_limits_check"
CHECK (
  "resumableMaxActiveSessionsPerUser" > 0
  AND "resumableMaxActiveSessionsInstance" >= "resumableMaxActiveSessionsPerUser"
),
ADD CONSTRAINT "SystemSettings_resumable_byte_limits_check"
CHECK (
  "resumableMaxReservedBytesPerUser" >= "maxUploadBytes"
  AND "resumableMaxReservedBytesInstance" >= "resumableMaxReservedBytesPerUser"
);

ALTER TABLE "UploadSession"
ADD COLUMN "terminalAt" TIMESTAMP(3),
ADD COLUMN "stagingReleasedAt" TIMESTAMP(3),
ADD COLUMN "cleanupAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "cleanupLastAttemptAt" TIMESTAMP(3),
ADD COLUMN "cleanupLastError" TEXT,
ADD COLUMN "committedFileId" TEXT;

UPDATE "UploadSession"
SET
  "terminalAt" = "updatedAt",
  "stagingReleasedAt" = "updatedAt"
WHERE "status" = 'completed';

UPDATE "UploadSession"
SET "terminalAt" = "updatedAt"
WHERE "status" IN ('cancelled', 'failed');

UPDATE "UploadSession"
SET
  "status" = 'expired',
  "terminalAt" = CURRENT_TIMESTAMP
WHERE
  "status" IN ('created', 'receiving')
  AND "expiresAt" <= CURRENT_TIMESTAMP;

DELETE FROM "UploadChunk"
WHERE "sessionId" IN (
  SELECT "id"
  FROM "UploadSession"
  WHERE "status" IN ('completed', 'failed', 'cancelled', 'expired')
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "UploadSession"
    GROUP BY "tmpPath"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce UploadSession.tmpPath uniqueness: duplicate staging paths exist.';
  END IF;
END
$$;

DROP INDEX IF EXISTS "UploadSession_ownerUserId_status_idx";
DROP INDEX IF EXISTS "UploadSession_expiresAt_status_idx";

CREATE UNIQUE INDEX "UploadSession_tmpPath_key"
ON "UploadSession"("tmpPath");

CREATE INDEX "UploadSession_ownerUserId_status_expiresAt_idx"
ON "UploadSession"("ownerUserId", "status", "expiresAt");

CREATE INDEX "UploadSession_status_expiresAt_idx"
ON "UploadSession"("status", "expiresAt");

CREATE INDEX "UploadSession_ownerUserId_status_terminalAt_idx"
ON "UploadSession"("ownerUserId", "status", "terminalAt");

CREATE INDEX "UploadSession_status_terminalAt_idx"
ON "UploadSession"("status", "terminalAt");

CREATE INDEX "UploadSession_stagingReleasedAt_idx"
ON "UploadSession"("stagingReleasedAt");

CREATE INDEX "UploadSession_committedFileId_idx"
ON "UploadSession"("committedFileId");

CREATE INDEX "UploadSession_staging_liability_owner_idx"
ON "UploadSession"("ownerUserId")
INCLUDE ("totalSizeBytes", "receivedBytes")
WHERE "stagingReleasedAt" IS NULL;

CREATE INDEX "UploadSession_staging_liability_status_idx"
ON "UploadSession"("status")
INCLUDE ("totalSizeBytes", "receivedBytes")
WHERE "stagingReleasedAt" IS NULL;

ALTER TABLE "UploadSession"
ADD CONSTRAINT "UploadSession_committedFileId_fkey"
FOREIGN KEY ("committedFileId") REFERENCES "File"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UploadSession"
ADD CONSTRAINT "UploadSession_totalSizeBytes_positive_check"
CHECK ("totalSizeBytes" > 0),
ADD CONSTRAINT "UploadSession_receivedBytes_range_check"
CHECK ("receivedBytes" >= 0 AND "receivedBytes" <= "totalSizeBytes"),
ADD CONSTRAINT "UploadSession_protocolVersion_positive_check"
CHECK ("protocolVersion" >= 1),
ADD CONSTRAINT "UploadSession_chunkSizeBytes_positive_check"
CHECK ("chunkSizeBytes" IS NULL OR "chunkSizeBytes" > 0),
ADD CONSTRAINT "UploadSession_cleanupAttemptCount_nonnegative_check"
CHECK ("cleanupAttemptCount" >= 0),
ADD CONSTRAINT "UploadSession_status_check"
CHECK (
  "status" IN (
    'allocating',
    'created',
    'receiving',
    'committing',
    'completed',
    'failed',
    'cancelled',
    'expired'
  )
),
ADD CONSTRAINT "UploadSession_terminalAt_status_check"
CHECK (
  (
    "status" IN ('allocating', 'created', 'receiving', 'committing')
    AND "terminalAt" IS NULL
  )
  OR
  (
    "status" IN ('completed', 'failed', 'cancelled', 'expired')
    AND "terminalAt" IS NOT NULL
  )
),
ADD CONSTRAINT "UploadSession_committedFile_status_check"
CHECK ("committedFileId" IS NULL OR "status" = 'completed');
