-- Direct uploads reserve quota while their durable mutation is in flight.
ALTER TABLE "StorageMutation" ADD COLUMN "reservedBytes" BIGINT;

-- Mutations rolled back before metadata commit end as 'aborted'.
ALTER TABLE "StorageMutation" DROP CONSTRAINT "StorageMutation_status_check";
ALTER TABLE "StorageMutation" ADD CONSTRAINT "StorageMutation_status_check"
CHECK ("status" IN ('preparing', 'prepared', 'running', 'metadata_committed', 'finalizing', 'succeeded', 'aborted', 'retrying', 'recovery_required'));

-- Before reservations, an over-quota direct upload promoted its bytes and then
-- failed the commit-time quota check as recovery_required. Requeue those
-- pre-commit uploads so the executor rolls them back and aborts them.
UPDATE "StorageMutation"
   SET "status" = 'retrying',
       "recoveryRequiredAt" = NULL,
       "nextAttemptAt" = CURRENT_TIMESTAMP,
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "status" = 'recovery_required'
   AND "metadataCommittedAt" IS NULL
   AND "parentId" IS NULL
   AND "kind" IN ('upload_create', 'upload_replace')
   AND "lastError" = 'Storage quota changed while mutation was running.';
