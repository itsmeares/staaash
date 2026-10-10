-- Updates follow Immich's model: the worker stores recent releases and the
-- app works out "update available" against the running version when shown.
ALTER TABLE "Instance"
  DROP COLUMN "updateCheckStatus",
  DROP COLUMN "updateCheckMessage",
  DROP COLUMN "latestAvailableVersion",
  DROP COLUMN "checkedVersion",
  ADD COLUMN "updateCheckError" TEXT,
  ADD COLUMN "updateReleases" JSONB;

-- No stored releases yet, so the worker checks again on its next start.
UPDATE "Instance" SET "lastUpdateCheckAt" = NULL;

-- Checks run hourly now; the interval setting goes. One switch turns them off.
ALTER TABLE "SystemSettings"
  DROP COLUMN "updateCheckIntervalHours",
  ADD COLUMN "updateCheckEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "updateChannel" TEXT;

-- The per-user "Version checks" preference was never read.
ALTER TABLE "UserPreference" DROP COLUMN "enableVersionChecks";
