BEGIN;

LOCK TABLE "User", "File" IN ACCESS EXCLUSIVE MODE;
ALTER TABLE "User" ADD COLUMN "committedStorageBytes" BIGINT DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_committedStorageBytes_nonnegative"
  CHECK ("committedStorageBytes" >= 0);

UPDATE "User" u SET "committedStorageBytes" = totals.bytes
FROM (SELECT "ownerUserId", SUM("sizeBytes") AS bytes FROM "File" GROUP BY "ownerUserId") totals
WHERE u.id = totals."ownerUserId";

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "User" u
    LEFT JOIN (SELECT "ownerUserId", SUM("sizeBytes") AS bytes FROM "File" GROUP BY "ownerUserId") totals
      ON totals."ownerUserId" = u.id
    WHERE u."committedStorageBytes" IS DISTINCT FROM COALESCE(totals.bytes, 0)
  ) THEN RAISE EXCEPTION 'Committed storage backfill does not match file metadata'; END IF;
END $$;

-- NULL quarantines an account after an audit finds inconsistent usage.
CREATE FUNCTION staaash_protect_storage_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."committedStorageBytes" := 0;
  ELSIF pg_trigger_depth() = 1 AND NEW."committedStorageBytes" IS NOT NULL
    AND NEW."committedStorageBytes" IS DISTINCT FROM OLD."committedStorageBytes" THEN
    RAISE EXCEPTION 'Committed storage usage is maintained by file metadata';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "User_protect_storage_usage"
BEFORE INSERT OR UPDATE OF "committedStorageBytes" ON "User"
FOR EACH ROW EXECUTE FUNCTION staaash_protect_storage_usage();

-- Statement triggers update each owner once, in stable order, for bulk writes.
CREATE FUNCTION staaash_add_file_storage_usage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE delta RECORD;
BEGIN
  FOR delta IN SELECT "ownerUserId", SUM("sizeBytes") AS bytes FROM new_files GROUP BY "ownerUserId" ORDER BY "ownerUserId" LOOP
    UPDATE "User" SET "committedStorageBytes" = "committedStorageBytes" + delta.bytes
      WHERE id = delta."ownerUserId" AND "committedStorageBytes" IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Committed storage usage is unavailable'; END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER "File_add_storage_usage" AFTER INSERT ON "File"
REFERENCING NEW TABLE AS new_files FOR EACH STATEMENT
EXECUTE FUNCTION staaash_add_file_storage_usage();

CREATE FUNCTION staaash_remove_file_storage_usage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE delta RECORD;
BEGIN
  FOR delta IN SELECT "ownerUserId", SUM("sizeBytes") AS bytes FROM old_files GROUP BY "ownerUserId" ORDER BY "ownerUserId" LOOP
    UPDATE "User" SET "committedStorageBytes" = "committedStorageBytes" - delta.bytes
      WHERE id = delta."ownerUserId" AND "committedStorageBytes" IS NOT NULL;
    IF NOT FOUND AND EXISTS (SELECT 1 FROM "User" WHERE id = delta."ownerUserId") THEN
      RAISE EXCEPTION 'Committed storage usage is unavailable';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER "File_remove_storage_usage" AFTER DELETE ON "File"
REFERENCING OLD TABLE AS old_files FOR EACH STATEMENT
EXECUTE FUNCTION staaash_remove_file_storage_usage();

CREATE FUNCTION staaash_update_file_storage_usage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE delta RECORD;
BEGIN
  FOR delta IN
    SELECT "ownerUserId", SUM(bytes) AS bytes FROM (
      SELECT "ownerUserId", "sizeBytes" AS bytes FROM new_files
      UNION ALL SELECT "ownerUserId", -"sizeBytes" AS bytes FROM old_files
    ) changes GROUP BY "ownerUserId" HAVING SUM(bytes) <> 0 ORDER BY "ownerUserId"
  LOOP
    UPDATE "User" SET "committedStorageBytes" = "committedStorageBytes" + delta.bytes
      WHERE id = delta."ownerUserId" AND "committedStorageBytes" IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Committed storage usage is unavailable'; END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER "File_update_storage_usage" AFTER UPDATE ON "File"
REFERENCING OLD TABLE AS old_files NEW TABLE AS new_files FOR EACH STATEMENT
EXECUTE FUNCTION staaash_update_file_storage_usage();

CREATE FUNCTION staaash_truncate_file_storage_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "User" SET "committedStorageBytes" = 0;
  RETURN NULL;
END $$;
CREATE TRIGGER "File_truncate_storage_usage" AFTER TRUNCATE ON "File"
FOR EACH STATEMENT EXECUTE FUNCTION staaash_truncate_file_storage_usage();

CREATE INDEX "UploadSession_unreleased_owner_idx" ON "UploadSession" ("ownerUserId") WHERE "stagingReleasedAt" IS NULL;
CREATE INDEX "UploadSession_terminal_owner_idx" ON "UploadSession" ("ownerUserId") WHERE "status" IN ('completed', 'failed', 'cancelled', 'expired');
CREATE INDEX "StorageMutation_reserved_owner_idx" ON "StorageMutation" ("ownerUserId") WHERE "reservedBytes" IS NOT NULL;
ANALYZE "User";
ANALYZE "UploadSession";
ANALYZE "StorageMutation";

COMMIT;
