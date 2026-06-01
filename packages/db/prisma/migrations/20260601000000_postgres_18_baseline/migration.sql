-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- EnableExtension
CREATE EXTENSION IF NOT EXISTS unaccent;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'dead', 'cancelled');

-- CreateEnum
CREATE TYPE "RestoreReconciliationStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "ShareTargetType" AS ENUM ('file', 'folder');

-- CreateEnum
CREATE TYPE "FileStorageStatus" AS ENUM ('available', 'missing');

-- CreateTable
CREATE TABLE "Instance" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "name" TEXT NOT NULL,
    "authSecret" TEXT,
    "setupCompletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdateCheckAt" TIMESTAMP(3),
    "updateCheckStatus" TEXT,
    "updateCheckMessage" TEXT,
    "latestAvailableVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "sessionMaxAgeDays" INTEGER NOT NULL DEFAULT 30,
    "inviteMaxAgeDays" INTEGER NOT NULL DEFAULT 7,
    "passwordResetMaxAgeHours" INTEGER NOT NULL DEFAULT 4,
    "shareMaxAgeDays" INTEGER NOT NULL DEFAULT 30,
    "maxUploadBytes" BIGINT NOT NULL DEFAULT 10737418240,
    "uploadTimeoutMinutes" INTEGER NOT NULL DEFAULT 60,
    "uploadStagingRetentionHours" INTEGER NOT NULL DEFAULT 2,
    "previewMaxSourceBytes" INTEGER NOT NULL DEFAULT 26214400,
    "previewTextMaxBytes" INTEGER NOT NULL DEFAULT 65536,
    "workerHeartbeatMaxAgeSeconds" INTEGER NOT NULL DEFAULT 120,
    "updateCheckIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "updateCheckRepository" TEXT NOT NULL DEFAULT 'itsmeares/staaash',
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "maintenanceRunTime" TEXT NOT NULL DEFAULT '02:00',
    "mediaPreviewEnabled" BOOLEAN NOT NULL DEFAULT true,
    "mediaPreviewGenerateOnUpload" BOOLEAN NOT NULL DEFAULT false,
    "mediaPreviewThresholdBytes" BIGINT NOT NULL DEFAULT 367001600,
    "mediaPreviewRetentionDays" INTEGER NOT NULL DEFAULT 14,
    "mediaPreviewMaxHeight" INTEGER NOT NULL DEFAULT 1080,
    "zipArchiveRetentionDays" INTEGER NOT NULL DEFAULT 7,
    "mediaPreviewCrf" INTEGER NOT NULL DEFAULT 22,
    "mediaPreviewMaxConcurrentJobs" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'member',
    "storageLimitBytes" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "showUpdateNotifications" BOOLEAN NOT NULL DEFAULT true,
    "enableVersionChecks" BOOLEAN NOT NULL DEFAULT true,
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'member',
    "tokenHash" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issuedByUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "isFilesRoot" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "folderId" TEXT,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageStatus" "FileStorageStatus" NOT NULL DEFAULT 'available',
    "storageCheckedAt" TIMESTAMP(3),
    "storageMissingAt" TIMESTAMP(3),
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "contentChecksum" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavoriteFile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quickAccessPinnedAt" TIMESTAMP(3),

    CONSTRAINT "FavoriteFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavoriteFolder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quickAccessPinnedAt" TIMESTAMP(3),

    CONSTRAINT "FavoriteFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecentFile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "lastInteractedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecentFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecentFolder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "lastInteractedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecentFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "targetType" "ShareTargetType" NOT NULL,
    "fileId" TEXT,
    "folderId" TEXT,
    "tokenLookupKey" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "passwordHash" TEXT,
    "downloadDisabled" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "queueName" TEXT NOT NULL DEFAULT 'default',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "payloadJson" JSONB NOT NULL,
    "progressJson" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "timeoutAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerInstance" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "version" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "currentJobId" TEXT,
    "metadataJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJobEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "metadataJson" JSONB NOT NULL DEFAULT '{}',
    "workerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackgroundJobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestoreReconciliationRun" (
    "id" TEXT NOT NULL,
    "status" "RestoreReconciliationStatus" NOT NULL DEFAULT 'queued',
    "triggeredByUserId" TEXT,
    "backgroundJobId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "missingOriginalCount" INTEGER NOT NULL DEFAULT 0,
    "orphanedStorageCount" INTEGER NOT NULL DEFAULT 0,
    "detailsJson" JSONB,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestoreReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaDerivative" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "videoCodec" TEXT,
    "audioCodec" TEXT,
    "error" TEXT,
    "pinnedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastViewedAt" TIMESTAMP(3),
    "lastSharedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaDerivative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZipArchive" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentKey" TEXT NOT NULL,
    "idsJson" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "storageKey" TEXT,
    "fileName" TEXT,
    "sizeBytes" BIGINT,
    "fileCount" INTEGER,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZipArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "folderId" TEXT,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "totalSizeBytes" BIGINT NOT NULL,
    "receivedBytes" BIGINT NOT NULL DEFAULT 0,
    "expectedChecksum" TEXT,
    "tmpPath" TEXT NOT NULL,
    "conflictStrategy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- CreateIndex
CREATE INDEX "Invite_email_revokedAt_expiresAt_idx" ON "Invite"("email", "revokedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_revokedAt_expiresAt_idx" ON "PasswordReset"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "Folder_ownerUserId_isFilesRoot_idx" ON "Folder"("ownerUserId", "isFilesRoot");

-- CreateIndex
CREATE INDEX "Folder_ownerUserId_parentId_deletedAt_idx" ON "Folder"("ownerUserId", "parentId", "deletedAt");

-- CreateIndex
CREATE INDEX "Folder_ownerUserId_deletedAt_updatedAt_idx" ON "Folder"("ownerUserId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "File_storageKey_key" ON "File"("storageKey");

-- CreateIndex
CREATE INDEX "File_ownerUserId_folderId_deletedAt_idx" ON "File"("ownerUserId", "folderId", "deletedAt");

-- CreateIndex
CREATE INDEX "File_ownerUserId_folderId_deletedAt_storageStatus_idx" ON "File"("ownerUserId", "folderId", "deletedAt", "storageStatus");

-- CreateIndex
CREATE INDEX "FavoriteFile_userId_createdAt_idx" ON "FavoriteFile"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FavoriteFile_userId_quickAccessPinnedAt_idx" ON "FavoriteFile"("userId", "quickAccessPinnedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteFile_userId_fileId_key" ON "FavoriteFile"("userId", "fileId");

-- CreateIndex
CREATE INDEX "FavoriteFolder_userId_createdAt_idx" ON "FavoriteFolder"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FavoriteFolder_userId_quickAccessPinnedAt_idx" ON "FavoriteFolder"("userId", "quickAccessPinnedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteFolder_userId_folderId_key" ON "FavoriteFolder"("userId", "folderId");

-- CreateIndex
CREATE INDEX "RecentFile_userId_lastInteractedAt_idx" ON "RecentFile"("userId", "lastInteractedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecentFile_userId_fileId_key" ON "RecentFile"("userId", "fileId");

-- CreateIndex
CREATE INDEX "RecentFolder_userId_lastInteractedAt_idx" ON "RecentFolder"("userId", "lastInteractedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecentFolder_userId_folderId_key" ON "RecentFolder"("userId", "folderId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_tokenLookupKey_key" ON "ShareLink"("tokenLookupKey");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_tokenHash_key" ON "ShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ShareLink_createdByUserId_revokedAt_expiresAt_idx" ON "ShareLink"("createdByUserId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_fileId_key" ON "ShareLink"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_folderId_key" ON "ShareLink"("folderId");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_runAt_idx" ON "BackgroundJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_kind_dedupeKey_status_idx" ON "BackgroundJob"("kind", "dedupeKey", "status");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_queueName_priority_runAt_idx" ON "BackgroundJob"("status", "queueName", "priority", "runAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_lockedBy_leaseExpiresAt_idx" ON "BackgroundJob"("lockedBy", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_kind_status_runAt_idx" ON "BackgroundJob"("kind", "status", "runAt");

-- CreateIndex
CREATE INDEX "WorkerInstance_status_idx" ON "WorkerInstance"("status");

-- CreateIndex
CREATE INDEX "WorkerInstance_lastHeartbeatAt_idx" ON "WorkerInstance"("lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "BackgroundJobEvent_jobId_createdAt_idx" ON "BackgroundJobEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "BackgroundJobEvent_type_idx" ON "BackgroundJobEvent"("type");

-- CreateIndex
CREATE UNIQUE INDEX "RestoreReconciliationRun_backgroundJobId_key" ON "RestoreReconciliationRun"("backgroundJobId");

-- CreateIndex
CREATE INDEX "RestoreReconciliationRun_status_createdAt_idx" ON "RestoreReconciliationRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RestoreReconciliationRun_createdAt_idx" ON "RestoreReconciliationRun"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaDerivative_storageKey_key" ON "MediaDerivative"("storageKey");

-- CreateIndex
CREATE INDEX "MediaDerivative_status_updatedAt_idx" ON "MediaDerivative"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "MediaDerivative_pinnedByAdmin_lastViewedAt_idx" ON "MediaDerivative"("pinnedByAdmin", "lastViewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaDerivative_fileId_kind_profile_key" ON "MediaDerivative"("fileId", "kind", "profile");

-- CreateIndex
CREATE UNIQUE INDEX "ZipArchive_contentKey_key" ON "ZipArchive"("contentKey");

-- CreateIndex
CREATE UNIQUE INDEX "ZipArchive_storageKey_key" ON "ZipArchive"("storageKey");

-- CreateIndex
CREATE INDEX "ZipArchive_status_idx" ON "ZipArchive"("status");

-- CreateIndex
CREATE INDEX "ZipArchive_expiresAt_idx" ON "ZipArchive"("expiresAt");

-- CreateIndex
CREATE INDEX "UploadSession_ownerUserId_status_idx" ON "UploadSession"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "UploadSession_expiresAt_status_idx" ON "UploadSession"("expiresAt", "status");

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteFile" ADD CONSTRAINT "FavoriteFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteFile" ADD CONSTRAINT "FavoriteFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteFolder" ADD CONSTRAINT "FavoriteFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteFolder" ADD CONSTRAINT "FavoriteFolder_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentFile" ADD CONSTRAINT "RecentFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentFile" ADD CONSTRAINT "RecentFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentFolder" ADD CONSTRAINT "RecentFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentFolder" ADD CONSTRAINT "RecentFolder_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundJobEvent" ADD CONSTRAINT "BackgroundJobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BackgroundJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestoreReconciliationRun" ADD CONSTRAINT "RestoreReconciliationRun_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaDerivative" ADD CONSTRAINT "MediaDerivative_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZipArchive" ADD CONSTRAINT "ZipArchive_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
