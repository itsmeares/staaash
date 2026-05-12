-- Extend background job state for reliability, cancellation, and visibility.
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE "BackgroundJob"
  ADD COLUMN "queueName" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "progressJson" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "timeoutAt" TIMESTAMP(3),
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledByUserId" TEXT,
  ADD COLUMN "errorCode" TEXT;

UPDATE "BackgroundJob"
SET "leaseExpiresAt" = "lockedAt" + INTERVAL '60 seconds'
WHERE "status" = 'running' AND "lockedAt" IS NOT NULL AND "leaseExpiresAt" IS NULL;

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

ALTER TABLE "BackgroundJobEvent"
  ADD CONSTRAINT "BackgroundJobEvent_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "BackgroundJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "BackgroundJob_status_queueName_priority_runAt_idx" ON "BackgroundJob"("status", "queueName", "priority", "runAt");
CREATE INDEX "BackgroundJob_lockedBy_leaseExpiresAt_idx" ON "BackgroundJob"("lockedBy", "leaseExpiresAt");
CREATE INDEX "BackgroundJob_kind_status_runAt_idx" ON "BackgroundJob"("kind", "status", "runAt");
CREATE INDEX "WorkerInstance_status_idx" ON "WorkerInstance"("status");
CREATE INDEX "WorkerInstance_lastHeartbeatAt_idx" ON "WorkerInstance"("lastHeartbeatAt");
CREATE INDEX "BackgroundJobEvent_jobId_createdAt_idx" ON "BackgroundJobEvent"("jobId", "createdAt");
CREATE INDEX "BackgroundJobEvent_type_idx" ON "BackgroundJobEvent"("type");
