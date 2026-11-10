-- A large folder change commits its metadata in chunks; this counts how many
-- operations already landed, so a retry resumes instead of starting over.
ALTER TABLE "StorageMutation" ADD COLUMN "metadataOperationsApplied" INTEGER NOT NULL DEFAULT 0;
