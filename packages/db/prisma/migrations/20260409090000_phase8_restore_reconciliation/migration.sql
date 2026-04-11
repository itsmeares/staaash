-- CreateEnum
CREATE TYPE "RestoreReconciliationStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

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

-- CreateIndex
CREATE UNIQUE INDEX "RestoreReconciliationRun_backgroundJobId_key" ON "RestoreReconciliationRun"("backgroundJobId");

-- CreateIndex
CREATE INDEX "RestoreReconciliationRun_status_createdAt_idx" ON "RestoreReconciliationRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RestoreReconciliationRun_createdAt_idx" ON "RestoreReconciliationRun"("createdAt");

-- AddForeignKey
ALTER TABLE "RestoreReconciliationRun" ADD CONSTRAINT "RestoreReconciliationRun_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
