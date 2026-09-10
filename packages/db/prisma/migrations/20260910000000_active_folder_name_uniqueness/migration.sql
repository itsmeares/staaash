CREATE UNIQUE INDEX "Folder_ownerUserId_parentId_name_active_key"
ON "Folder" ("ownerUserId", "parentId", "name")
WHERE "deletedAt" IS NULL;
