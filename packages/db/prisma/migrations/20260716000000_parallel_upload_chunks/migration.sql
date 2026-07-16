ALTER TABLE "UploadSession"
ADD COLUMN "protocolVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "chunkSizeBytes" BIGINT;

CREATE TABLE "UploadChunk" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "startByte" BIGINT NOT NULL,
    "endByte" BIGINT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UploadChunk_sessionId_chunkIndex_key"
ON "UploadChunk"("sessionId", "chunkIndex");

CREATE INDEX "UploadChunk_sessionId_idx"
ON "UploadChunk"("sessionId");

ALTER TABLE "UploadChunk"
ADD CONSTRAINT "UploadChunk_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "UploadSession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
