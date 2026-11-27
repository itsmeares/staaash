-- API keys are sessions made by hand in Settings. Existing sessions are not keys.
ALTER TABLE "Session" ADD COLUMN "keyUse" TEXT,
ADD COLUMN "keyReadOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "keyFolderId" TEXT,
ADD COLUMN "keyNoEnd" BOOLEAN NOT NULL DEFAULT false;
