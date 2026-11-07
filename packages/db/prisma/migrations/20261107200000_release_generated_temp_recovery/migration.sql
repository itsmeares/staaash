BEGIN;

-- Staging cleanup used to turn each abandoned preview or archive temp into an
-- account-wide recovery record that nothing could clear. Those temps are job
-- output no journal ever owned, so release the records. No file is touched
-- here; the next staging cleanup removes the temps past retention.
CREATE TEMP TABLE staaash_released_recovery ON COMMIT DROP AS
SELECT mutation.id FROM "StorageMutation" mutation
WHERE mutation.kind = 'legacy_recovery'
  AND mutation.status = 'recovery_required'
  AND mutation."intentJson"->>'reason' = 'Abandoned generated temp has no safely determined publish outcome.'
  AND NOT EXISTS (
    SELECT 1 FROM "StorageMutationStep" step
    WHERE step."mutationId" = mutation.id
      AND NOT (
        step.action = 'delete_file'
        AND step."targetKey" ~ '^tmp/(derivatives/[^/]+\.(jpg|mp4)|archives/[^/]+\.zip)\.tmp$'
      )
  );

UPDATE "StorageMutation" mutation SET
  status = 'aborted',
  "idempotencyKey" = NULL,
  "completedAt" = now(),
  "leaseOwner" = NULL,
  "leaseExpiresAt" = NULL,
  "nextAttemptAt" = NULL,
  "lastError" = 'Released: abandoned generated temps are removed by staging cleanup.',
  "updatedAt" = now()
FROM staaash_released_recovery released
WHERE mutation.id = released.id;

UPDATE "StorageMutationResource" resource SET "releasedAt" = now()
FROM staaash_released_recovery released
WHERE resource."mutationId" = released.id AND resource."releasedAt" IS NULL;

COMMIT;
