-- A failed claim rolls back its own attempt count, so a mutation that can
-- never be claimed needs a counter written outside the claim transaction.
ALTER TABLE "StorageMutation" ADD COLUMN "claimFailureCount" INTEGER NOT NULL DEFAULT 0;
