-- Sync: device sessions, single-use device codes, the per-owner change log,
-- and the client's modified time.

ALTER TABLE "File" ADD COLUMN "clientModifiedAt" TIMESTAMP(3);

ALTER TABLE "UploadSession" ADD COLUMN "clientModifiedAt" TIMESTAMP(3);

ALTER TABLE "StorageMutation" ADD COLUMN "originDeviceId" TEXT;

ALTER TABLE "Session" ADD COLUMN "deviceName" TEXT,
ADD COLUMN "deviceSessionId" TEXT;

CREATE INDEX "Session_deviceSessionId_idx" ON "Session"("deviceSessionId");

ALTER TABLE "Session" ADD CONSTRAINT "Session_deviceSessionId_fkey" FOREIGN KEY ("deviceSessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DeviceAuthCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "codeChallenge" TEXT,
    "redirectUri" TEXT,
    "deviceName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceAuthCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceAuthCode_codeHash_key" ON "DeviceAuthCode"("codeHash");

CREATE INDEX "DeviceAuthCode_expiresAt_idx" ON "DeviceAuthCode"("expiresAt");

CREATE TABLE "StorageChange" (
    "seq" BIGSERIAL NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "mutationId" TEXT,
    "kind" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "parentId" TEXT,
    "previousParentId" TEXT,
    "path" TEXT NOT NULL,
    "previousPath" TEXT,
    "name" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "contentChecksum" TEXT,
    "storageRevision" INTEGER NOT NULL,
    "clientModifiedAt" TIMESTAMP(3),
    "originDeviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageChange_pkey" PRIMARY KEY ("seq")
);

CREATE INDEX "StorageChange_ownerUserId_seq_idx" ON "StorageChange"("ownerUserId", "seq");

CREATE INDEX "StorageChange_createdAt_idx" ON "StorageChange"("createdAt");
