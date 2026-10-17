BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "File" ADD COLUMN "searchName" TEXT NOT NULL DEFAULT '';

-- The trigger covers journal, worker, restore, and direct metadata writers.
CREATE FUNCTION staaash_sync_file_search_name() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchName" := public.unaccent(lower(NEW."originalName"));
  RETURN NEW;
END;
$$;

CREATE TRIGGER "File_sync_search_name"
BEFORE INSERT OR UPDATE OF "originalName", "searchName" ON "File"
FOR EACH ROW EXECUTE FUNCTION staaash_sync_file_search_name();

UPDATE "File" SET "searchName" = public.unaccent(lower("originalName"));

CREATE INDEX "File_searchName_trgm_idx" ON "File"
USING GIN ("searchName" gin_trgm_ops)
WHERE "deletedAt" IS NULL AND "storageStatus" = 'available'::"FileStorageStatus";

ANALYZE "File";

COMMIT;
