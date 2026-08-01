ALTER TABLE "Instance"
ADD COLUMN "storageProtocolVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Instance"
ALTER COLUMN "storageProtocolVersion" SET DEFAULT 2;

ALTER TABLE "Folder"
ADD COLUMN "storageRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "trashEntryId" TEXT;

ALTER TABLE "File"
ADD COLUMN "storageRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "trashEntryId" TEXT;

ALTER TABLE "MediaDerivative"
ADD COLUMN "storageRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ZipArchive"
ADD COLUMN "storageRevision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "StorageMutation" (
  "id" TEXT NOT NULL,
  "parentId" TEXT,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "requestHash" TEXT,
  "intentJson" JSONB NOT NULL,
  "resultJson" JSONB,
  "leaseOwner" TEXT,
  "leaseToken" BIGINT NOT NULL DEFAULT 0,
  "leaseExpiresAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "metadataCommittedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "recoveryRequiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorageMutation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StorageMutationStep" (
  "id" TEXT NOT NULL,
  "mutationId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "sourceKey" TEXT,
  "targetKey" TEXT,
  "expectedNodeType" TEXT,
  "expectedSizeBytes" BIGINT,
  "expectedChecksum" TEXT,
  "treeManifestDigest" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorageMutationStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StorageMutationEntity" (
  "id" TEXT NOT NULL,
  "mutationId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "preRevision" INTEGER NOT NULL,
  "postRevision" INTEGER NOT NULL,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StorageMutationEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StorageMutationResource" (
  "id" TEXT NOT NULL,
  "resourceKey" TEXT NOT NULL,
  "mutationId" TEXT NOT NULL,
  "fenceToken" BIGINT NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "StorageMutationResource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrashEntry" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "rootKind" TEXT NOT NULL,
  "rootEntityId" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL,
  "storageRootKey" TEXT,
  "treeManifestDigest" TEXT,
  "layoutVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrashEntry_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "UploadSession" ADD COLUMN "storageMutationId" TEXT;

CREATE UNIQUE INDEX "StorageMutation_idempotencyKey_key" ON "StorageMutation"("idempotencyKey");
CREATE INDEX "StorageMutation_status_nextAttemptAt_idx" ON "StorageMutation"("status", "nextAttemptAt");
CREATE INDEX "StorageMutation_ownerUserId_status_idx" ON "StorageMutation"("ownerUserId", "status");
CREATE INDEX "StorageMutation_leaseExpiresAt_idx" ON "StorageMutation"("leaseExpiresAt");
CREATE INDEX "StorageMutation_parentId_idx" ON "StorageMutation"("parentId");
CREATE UNIQUE INDEX "StorageMutationStep_mutationId_ordinal_key" ON "StorageMutationStep"("mutationId", "ordinal");
CREATE INDEX "StorageMutationStep_mutationId_status_idx" ON "StorageMutationStep"("mutationId", "status");
CREATE UNIQUE INDEX "StorageMutationEntity_mutationId_entityType_entityId_key" ON "StorageMutationEntity"("mutationId", "entityType", "entityId");
CREATE INDEX "StorageMutationEntity_entityType_entityId_idx" ON "StorageMutationEntity"("entityType", "entityId");
CREATE INDEX "StorageMutationResource_resourceKey_releasedAt_idx" ON "StorageMutationResource"("resourceKey", "releasedAt");
CREATE INDEX "StorageMutationResource_mutationId_idx" ON "StorageMutationResource"("mutationId");
CREATE UNIQUE INDEX "StorageMutationResource_active_resource_key" ON "StorageMutationResource"("resourceKey") WHERE "releasedAt" IS NULL;
CREATE UNIQUE INDEX "TrashEntry_rootKind_rootEntityId_key" ON "TrashEntry"("rootKind", "rootEntityId");
CREATE UNIQUE INDEX "TrashEntry_isolated_storageRootKey_key"
ON "TrashEntry"("storageRootKey")
WHERE "layoutVersion" = 'isolated';
CREATE INDEX "TrashEntry_ownerUserId_deletedAt_idx" ON "TrashEntry"("ownerUserId", "deletedAt");
CREATE INDEX "Folder_trashEntryId_idx" ON "Folder"("trashEntryId");
CREATE INDEX "File_trashEntryId_idx" ON "File"("trashEntryId");
CREATE UNIQUE INDEX "UploadSession_storageMutationId_key" ON "UploadSession"("storageMutationId");

ALTER TABLE "StorageMutation" ADD CONSTRAINT "StorageMutation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "StorageMutation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StorageMutation" ADD CONSTRAINT "StorageMutation_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StorageMutationStep" ADD CONSTRAINT "StorageMutationStep_mutationId_fkey" FOREIGN KEY ("mutationId") REFERENCES "StorageMutation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorageMutationEntity" ADD CONSTRAINT "StorageMutationEntity_mutationId_fkey" FOREIGN KEY ("mutationId") REFERENCES "StorageMutation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorageMutationResource" ADD CONSTRAINT "StorageMutationResource_mutationId_fkey" FOREIGN KEY ("mutationId") REFERENCES "StorageMutation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrashEntry" ADD CONSTRAINT "TrashEntry_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_trashEntryId_fkey" FOREIGN KEY ("trashEntryId") REFERENCES "TrashEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "File" ADD CONSTRAINT "File_trashEntryId_fkey" FOREIGN KEY ("trashEntryId") REFERENCES "TrashEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_storageMutationId_fkey" FOREIGN KEY ("storageMutationId") REFERENCES "StorageMutation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StorageMutation" ADD CONSTRAINT "StorageMutation_status_check"
CHECK ("status" IN ('preparing', 'prepared', 'running', 'metadata_committed', 'finalizing', 'succeeded', 'retrying', 'recovery_required'));
ALTER TABLE "StorageMutationStep" ADD CONSTRAINT "StorageMutationStep_action_check"
CHECK ("action" IN ('mkdir', 'rename', 'delete_file', 'delete_tree', 'remove_empty_directory'));
ALTER TABLE "StorageMutationStep" ADD CONSTRAINT "StorageMutationStep_status_check"
CHECK ("status" IN ('pending', 'applied'));
ALTER TABLE "TrashEntry" ADD CONSTRAINT "TrashEntry_layoutVersion_check"
CHECK ("layoutVersion" IN ('legacy', 'isolated'));
ALTER TABLE "TrashEntry" ADD CONSTRAINT "TrashEntry_rootKind_check"
CHECK ("rootKind" IN ('file', 'folder'));
