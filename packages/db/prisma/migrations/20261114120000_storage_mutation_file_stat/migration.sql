-- The lstat fingerprint of a file whose checksum was just read, so a rename
-- step can skip reading it again on its first attempt.
ALTER TABLE "StorageMutationStep" ADD COLUMN "expectedFileStat" TEXT;
