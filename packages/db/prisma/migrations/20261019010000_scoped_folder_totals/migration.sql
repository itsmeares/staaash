BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('staaash:folder-totals:hierarchy', 0));

CREATE FUNCTION staaash_refresh_changed_folder_sizes(before_nodes JSONB, changed_ids TEXT[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE targets TEXT[];
BEGIN
  IF COALESCE(array_length(changed_ids, 1), 0) = 0 THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staaash:folder-totals:hierarchy', 0));
  WITH RECURSIVE before_parents AS MATERIALIZED (
    SELECT jsonb_object_agg(node->>'id', node->'parentId') AS nodes
    FROM jsonb_array_elements(before_nodes) node
  ), ancestors(id) AS (
    SELECT unnest(changed_ids)
    UNION
    SELECT parents.parent_id FROM ancestors CROSS JOIN before_parents JOIN LATERAL (
      SELECT before_parents.nodes->>ancestors.id AS parent_id
      UNION SELECT "parentId" FROM "Folder" WHERE id = ancestors.id
    ) parents ON parents.parent_id IS NOT NULL
  ) SELECT array_agg(id) INTO targets FROM ancestors;

  PERFORM id FROM "Folder" WHERE id = ANY(targets) ORDER BY id FOR NO KEY UPDATE;
  WITH RECURSIVE before_rows AS MATERIALIZED (
    SELECT * FROM jsonb_to_recordset(before_nodes)
      AS node(id TEXT, "parentId" TEXT, "deletedAt" TIMESTAMP, "treeSizeBytes" BIGINT)
  ), snapshot AS MATERIALIZED (
    SELECT selected.id,
      CASE WHEN before.id IS NOT NULL THEN before."parentId" ELSE current."parentId" END AS parent_id,
      CASE WHEN before.id IS NOT NULL THEN before."deletedAt" ELSE current."deletedAt" END AS deleted_at,
      COALESCE(before."treeSizeBytes", current."treeSizeBytes") AS bytes
    FROM unnest(targets) AS selected(id)
    LEFT JOIN before_rows before ON before.id = selected.id
    LEFT JOIN "Folder" current ON current.id = selected.id
    WHERE before.id IS NOT NULL OR current.id IS NOT NULL
  ), old_reach(root_id, id) AS (
    SELECT id, id FROM snapshot WHERE deleted_at IS NULL
    UNION
    SELECT old_reach.root_id, child.id FROM old_reach
    JOIN snapshot child ON child.parent_id = old_reach.id AND child.deleted_at IS NULL
  ), old_cycles AS MATERIALIZED (
    SELECT DISTINCT old_reach.root_id AS id FROM old_reach
    JOIN snapshot root ON root.id = old_reach.root_id AND root.parent_id = old_reach.id
  ), old_children AS (
    SELECT parent_id, SUM(bytes) AS bytes FROM snapshot
    WHERE deleted_at IS NULL GROUP BY parent_id
  ), detached_root AS MATERIALIZED (
    -- A cascading delete can unlink the surviving nodes of an old cycle.
    SELECT EXISTS (
      SELECT 1 FROM "Folder" current
      WHERE current.id = ANY(targets) AND current."parentId" IS NULL AND NOT current."isFilesRoot"
        AND NOT EXISTS (SELECT 1 FROM before_rows WHERE id = current.id)
        AND EXISTS (SELECT 1 FROM before_rows deleted WHERE NOT EXISTS (SELECT 1 FROM "Folder" WHERE id = deleted.id))
    ) AS needs_scan
  ), direct_nodes AS MATERIALIZED (
    SELECT current.id FROM "Folder" current JOIN snapshot before ON before.id = current.id
    WHERE current."deletedAt" IS NULL AND (
      before.deleted_at IS NOT NULL OR current.id IN (SELECT id FROM old_cycles)
      OR (SELECT needs_scan FROM detached_root)
    )
  ), direct_files AS MATERIALIZED (
    SELECT file."folderId" AS id, SUM(file."sizeBytes") AS bytes FROM "File" file
    WHERE EXISTS (SELECT 1 FROM direct_nodes)
      AND file."folderId" = ANY(ARRAY(SELECT id FROM direct_nodes)) AND file."deletedAt" IS NULL
    GROUP BY file."folderId"
  ), outside_children AS MATERIALIZED (
    SELECT child."parentId" AS id, SUM(child."treeSizeBytes") AS bytes FROM "Folder" child
    WHERE EXISTS (SELECT 1 FROM direct_nodes)
      AND child."parentId" = ANY(ARRAY(SELECT id FROM direct_nodes))
      AND child."deletedAt" IS NULL AND NOT child.id = ANY(targets)
    GROUP BY child."parentId"
  ), base AS MATERIALIZED (
    SELECT current.id, current."parentId" AS parent_id,
      CASE WHEN direct.id IS NOT NULL
        THEN COALESCE(files.bytes, 0) + COALESCE(outside.bytes, 0)
        ELSE before.bytes - COALESCE(children.bytes, 0)
      END AS bytes
    FROM "Folder" current JOIN snapshot before ON before.id = current.id
    LEFT JOIN old_children children ON children.parent_id = current.id
    LEFT JOIN direct_nodes direct ON direct.id = current.id
    LEFT JOIN direct_files files ON files.id = current.id
    LEFT JOIN outside_children outside ON outside.id = current.id
    WHERE current."deletedAt" IS NULL
  ), tree(root_id, id) AS (
    SELECT id, id FROM base
    UNION
    SELECT tree.root_id, child.id FROM tree JOIN base child ON child.parent_id = tree.id
  ), totals AS (
    SELECT tree.root_id, SUM(base.bytes) AS bytes FROM tree JOIN base ON base.id = tree.id GROUP BY tree.root_id
  )
  UPDATE "Folder" folder SET "treeSizeBytes" = COALESCE(totals.bytes, 0)
  FROM unnest(targets) AS selected(id) LEFT JOIN totals ON totals.root_id = selected.id
  WHERE folder.id = selected.id;
END $$;

CREATE OR REPLACE FUNCTION staaash_reparent_folder_sizes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_nodes JSONB; changed_ids TEXT[];
BEGIN
  SELECT array_agg(before.id) INTO changed_ids
  FROM old_folders before JOIN new_folders after USING (id)
  WHERE before."parentId" IS DISTINCT FROM after."parentId" OR before."deletedAt" IS DISTINCT FROM after."deletedAt";
  IF changed_ids IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_agg(to_jsonb(before)) INTO before_nodes FROM old_folders before;
  PERFORM staaash_refresh_changed_folder_sizes(before_nodes, changed_ids);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION staaash_delete_folder_sizes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_nodes JSONB; changed_ids TEXT[];
BEGIN
  SELECT jsonb_agg(to_jsonb(before)), array_agg(id) INTO before_nodes, changed_ids FROM old_folders before;
  PERFORM staaash_refresh_changed_folder_sizes(before_nodes, changed_ids);
  RETURN NULL;
END $$;

SELECT staaash_rebuild_folder_sizes(array_agg(id)) FROM "Folder";
COMMIT;
