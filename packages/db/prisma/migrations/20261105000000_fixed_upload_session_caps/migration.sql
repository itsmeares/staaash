-- Open upload counts become fixed caps in code. The staging byte limits
-- stay as settings: they are what protects the disk.
ALTER TABLE "SystemSettings"
DROP COLUMN "resumableMaxActiveSessionsPerUser",
DROP COLUMN "resumableMaxActiveSessionsInstance";
