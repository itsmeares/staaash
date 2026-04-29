-- AlterTable
ALTER TABLE "Instance" ADD COLUMN     "authSecret" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "storageLimitBytes" BIGINT;

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "showUpdateNotifications" BOOLEAN NOT NULL DEFAULT true,
    "enableVersionChecks" BOOLEAN NOT NULL DEFAULT true,
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
