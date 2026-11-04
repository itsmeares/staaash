BEGIN;

-- A folder's modified date moves when anything inside it, at any depth, is
-- added, removed, renamed, moved, replaced, trashed, or restored. The journal
-- writes rows with raw SQL, so Prisma's @updatedAt can't do this.

-- These writes now also lock ancestor rows, so they take the hierarchy lock
-- first, like size changes. Locking rows before it can deadlock two writers.
DROP TRIGGER "File_lock_folder_sizes" ON "File";
CREATE TRIGGER "File_lock_folder_sizes" BEFORE INSERT OR DELETE
OR UPDATE OF "folderId", "sizeBytes", "deletedAt", "originalName", "contentChecksum", "clientModifiedAt", "mimeType" ON "File"
FOR EACH STATEMENT EXECUTE FUNCTION staaash_lock_folder_size_hierarchy();
DROP TRIGGER "Folder_lock_tree_sizes" ON "Folder";
CREATE TRIGGER "Folder_lock_tree_sizes" BEFORE INSERT OR DELETE
OR UPDATE OF "parentId", "deletedAt", "name" ON "Folder"
FOR EACH STATEMENT EXECUTE FUNCTION staaash_lock_folder_size_hierarchy();

-- updatedAt is a UTC timestamp without a zone, like Prisma writes it.
-- GREATEST keeps a date from moving back when clocks or transactions disagree.
CREATE FUNCTION staaash_touch_folder_ancestors(folder_ids TEXT[]) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(array_length(folder_ids, 1), 0) = 0 THEN RETURN; END IF;
  WITH RECURSIVE ancestors(id, parent_id, visited) AS (
    SELECT id, "parentId", ARRAY[id] FROM "Folder"
    WHERE id = ANY(folder_ids) AND "deletedAt" IS NULL
    UNION ALL
    SELECT parent.id, parent."parentId", ancestors.visited || parent.id
    FROM ancestors JOIN "Folder" parent ON parent.id = ancestors.parent_id
    WHERE parent."deletedAt" IS NULL AND NOT parent.id = ANY(ancestors.visited)
  ), locked AS MATERIALIZED (
    SELECT folder.id FROM "Folder" folder WHERE folder.id IN (SELECT id FROM ancestors)
    ORDER BY folder.id FOR NO KEY UPDATE
  )
  UPDATE "Folder" folder SET "updatedAt" = GREATEST(folder."updatedAt", timezone('UTC', now()))
  FROM locked WHERE folder.id = locked.id;
END $$;

CREATE FUNCTION staaash_touch_file_folders() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT "folderId") INTO ids FROM new_files WHERE "deletedAt" IS NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT "folderId") INTO ids FROM old_files WHERE "deletedAt" IS NULL;
  ELSE
    WITH changed AS (
      SELECT before."folderId" AS old_id, before."deletedAt" AS old_deleted,
        after."folderId" AS new_id, after."deletedAt" AS new_deleted
      FROM old_files before JOIN new_files after USING (id)
      WHERE (before."folderId", before."originalName", before."deletedAt", before."sizeBytes", before."contentChecksum", before."clientModifiedAt", before."mimeType")
        IS DISTINCT FROM (after."folderId", after."originalName", after."deletedAt", after."sizeBytes", after."contentChecksum", after."clientModifiedAt", after."mimeType")
    )
    SELECT array_agg(DISTINCT folder_id) INTO ids FROM (
      SELECT old_id FROM changed WHERE old_deleted IS NULL
      UNION SELECT new_id FROM changed WHERE new_deleted IS NULL
    ) touched(folder_id);
  END IF;
  PERFORM staaash_touch_folder_ancestors(ids);
  RETURN NULL;
END $$;
CREATE TRIGGER "File_insert_folder_dates" AFTER INSERT ON "File"
REFERENCING NEW TABLE AS new_files FOR EACH STATEMENT EXECUTE FUNCTION staaash_touch_file_folders();
CREATE TRIGGER "File_delete_folder_dates" AFTER DELETE ON "File"
REFERENCING OLD TABLE AS old_files FOR EACH STATEMENT EXECUTE FUNCTION staaash_touch_file_folders();
CREATE TRIGGER "File_update_folder_dates" AFTER UPDATE ON "File"
REFERENCING OLD TABLE AS old_files NEW TABLE AS new_files FOR EACH STATEMENT EXECUTE FUNCTION staaash_touch_file_folders();

-- The ancestor update changes only updatedAt, so it finds nothing to do here.
CREATE FUNCTION staaash_touch_parent_folders() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT "parentId") INTO ids FROM new_folders WHERE "deletedAt" IS NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT "parentId") INTO ids FROM old_folders WHERE "deletedAt" IS NULL;
  ELSE
    WITH changed AS (
      SELECT before."parentId" AS old_id, before."deletedAt" AS old_deleted,
        after."parentId" AS new_id, after."deletedAt" AS new_deleted
      FROM old_folders before JOIN new_folders after USING (id)
      WHERE (before."parentId", before.name, before."deletedAt")
        IS DISTINCT FROM (after."parentId", after.name, after."deletedAt")
    )
    SELECT array_agg(DISTINCT folder_id) INTO ids FROM (
      SELECT old_id FROM changed WHERE old_deleted IS NULL
      UNION SELECT new_id FROM changed WHERE new_deleted IS NULL
    ) touched(folder_id);
  END IF;
  PERFORM staaash_touch_folder_ancestors(ids);
  RETURN NULL;
END $$;
CREATE TRIGGER "Folder_insert_folder_dates" AFTER INSERT ON "Folder"
REFERENCING NEW TABLE AS new_folders FOR EACH STATEMENT EXECUTE FUNCTION staaash_touch_parent_folders();
CREATE TRIGGER "Folder_delete_folder_dates" AFTER DELETE ON "Folder"
REFERENCING OLD TABLE AS old_folders FOR EACH STATEMENT EXECUTE FUNCTION staaash_touch_parent_folders();
CREATE TRIGGER "Folder_update_folder_dates" AFTER UPDATE ON "Folder"
REFERENCING OLD TABLE AS old_folders NEW TABLE AS new_folders FOR EACH STATEMENT EXECUTE FUNCTION staaash_touch_parent_folders();

-- Only a rename or move edits the folder itself. Prisma sends updatedAt = now()
-- on every update, so anything else, such as a color or icon or a same-value
-- write, keeps the stored date. That also stops a date read earlier from
-- being written back.
CREATE FUNCTION staaash_folder_own_date() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."parentId", NEW.name) IS DISTINCT FROM (OLD."parentId", OLD.name) THEN
    NEW."updatedAt" := GREATEST(OLD."updatedAt", timezone('UTC', now()));
  ELSE
    NEW."updatedAt" := OLD."updatedAt";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Folder_own_date" BEFORE UPDATE OF "parentId", "name", "color", "icon" ON "Folder"
FOR EACH ROW EXECUTE FUNCTION staaash_folder_own_date();

COMMIT;
