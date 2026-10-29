BEGIN;

CREATE INDEX "File_live_name_idx" ON "File" ("ownerUserId", "folderId", "originalName")
WHERE "deletedAt" IS NULL;

ANALYZE "File";

COMMIT;
