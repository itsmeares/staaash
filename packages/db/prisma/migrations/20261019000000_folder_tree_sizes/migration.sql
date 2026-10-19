BEGIN;

CREATE COLLATION staaash_natural (provider = icu, locale = 'en-u-kn-true-ks-level1', deterministic = false);

-- Match the app's NFKD, Unicode mark removal, and lowercase search rules.
CREATE FUNCTION staaash_list_search_text(value TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT lower(btrim(regexp_replace(normalize(value, NFKD), '[̀-ͯ҃-҉֑-ֽֿׁ-ׂׄ-ׇׅؐ-ًؚ-ٰٟۖ-ۜ۟-ۤۧ-۪ۨ-ܑۭܰ-݊ަ-ް߫-߽߳ࠖ-࠙ࠛ-ࠣࠥ-ࠧࠩ-࡙࠭-࡛ࢗ-࢟࣊-ࣣ࣡-ःऺ-़ा-ॏ॑-ॗॢ-ॣঁ-ঃ়া-ৄে-ৈো-্ৗৢ-ৣ৾ਁ-ਃ਼ਾ-ੂੇ-ੈੋ-੍ੑੰ-ੱੵઁ-ઃ઼ા-ૅે-ૉો-્ૢ-ૣૺ-૿ଁ-ଃ଼ା-ୄେ-ୈୋ-୍୕-ୗୢ-ୣஂா-ூெ-ைொ-்ௗఀ-ఄ఼ా-ౄె-ైొ-్ౕ-ౖౢ-ౣಁ-ಃ಼ಾ-ೄೆ-ೈೊ-್ೕ-ೖೢ-ೣೳഀ-ഃ഻-഼ാ-ൄെ-ൈൊ-്ൗൢ-ൣඁ-ඃ්ා-ුූෘ-ෟෲ-ෳัิ-ฺ็-๎ັິ-ຼ່-໎༘-༹༙༵༷༾-༿ཱ-྄྆-྇ྍ-ྗྙ-ྼ࿆ါ-ှၖ-ၙၞ-ၠၢ-ၤၧ-ၭၱ-ၴႂ-ႍႏႚ-ႝ፝-፟ᜒ-᜕ᜲ-᜴ᝒ-ᝓᝲ-ᝳ឴-៓៝᠋-᠍᠏ᢅ-ᢆᢩᤠ-ᤫᤰ-᤻ᨗ-ᨛᩕ-ᩞ᩠-᩿᩼᪰-᫝᫠-᫫ᬀ-ᬄ᬴-᭄᭫-᭳ᮀ-ᮂᮡ-ᮭ᯦-᯳ᰤ-᰷᳐-᳔᳒-᳨᳭᳴᳷-᳹᷀-᷿⃐-⃰⳯-⵿⳱ⷠ-〪ⷿ-゙〯-゚꙯-꙲ꙴ-꙽ꚞ-ꚟ꛰-꛱ꠂ꠆ꠋꠣ-ꠧ꠬ꢀ-ꢁꢴ-ꣅ꣠-꣱ꣿꤦ-꤭ꥇ-꥓ꦀ-ꦃ꦳-꧀ꧥꨩ-ꨶꩃꩌ-ꩍꩻ-ꩽꪰꪲ-ꪴꪷ-ꪸꪾ-꪿꫁ꫫ-ꫯꫵ-꫶ꯣ-ꯪ꯬-꯭ﬞ︀-️︠-𐇽𐋠︯𐍶-𐍺𐨁-𐨃𐨅-𐨆𐨌-𐨏𐨸-𐨿𐨺𐫥-𐫦𐴤-𐴧𐵩-𐵭𐺫-𐺬𐻺-𐻿𐽆-𐽐𐾂-𐾅𑀀-𑀂𑀸-𑁆𑁰𑁳-𑁴𑁿-𑂂𑂰-𑂺𑃂𑄀-𑄂𑄧-𑄴𑅅-𑅆𑅳𑆀-𑆂𑆳-𑇀𑇉-𑇌𑇎-𑇏𑈬-𑈷𑈾𑉁𑋟-𑋪𑌀-𑌃𑌻-𑌼𑌾-𑍄𑍇-𑍈𑍋-𑍍𑍗𑍢-𑍣𑍦-𑍬𑍰-𑍴𑎸-𑏀𑏅𑏅𑎸-𑏊𑏌-𑏐𑏒𑏡-𑏢𑐵-𑑆𑑞𑒰-𑓃𑖯-𑖵𑖸-𑗀𑗜-𑗝𑘰-𑙀𑚫-𑚷𑜝-𑜫𑠬-𑠺𑤰-𑤵𑤷-𑤸𑤻-𑤾𑥀𑥂-𑥃𑧑-𑧗𑧚-𑧠𑧤𑨁-𑨊𑨳-𑨹𑨻-𑨾𑩇𑩑-𑩛𑪊-𑪙𑭠-𑭧𑰯-𑰶𑰸-𑰿𑲒-𑲧𑲩-𑲶𑴱-𑴶𑴺𑴼-𑴽𑴿-𑵅𑵇𑶊-𑶎𑶐-𑶑𑶓-𑶗𑻳-𑻶𑼀-𑼁𑼃𑼴-𑼺𑼾-𑽂𑽚𓑀𓑇-𓑕𖄞-𖫰𖄯-𖫴𖬰-𖬶𖽏𖽑-𖾇𖾏-𖾒𖿤𖿰-𖿱𛲝-𛲞𜼀-𜼭𜼰-𜽆𝅥-𝅩𝅭-𝅲𝅻-𝆂𝆅-𝆋𝆪-𝆭𝉂-𝉄𝨀-𝨶𝨻-𝩬𝩵𝪄𝪛-𝪟𝪡-𝪯𞀀-𞀆𞀈-𞀘𞀛-𞀡𞀣-𞀤𞀦-𞀪𞂏𞄰-𞄶𞊮𞋬-𞋯𞓬-𞓯𞗮-𞗯𞛣𞛦𞛮-𞛯𞛵𞣐-𞣖𞥄-𞥊󠄀-󠇯]', '', 'g'), U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') COLLATE "en-US-x-icu");
$$;

LOCK TABLE "Folder", "File" IN ACCESS EXCLUSIVE MODE;
ALTER TABLE "Folder" ADD COLUMN "treeSizeBytes" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_treeSizeBytes_nonnegative" CHECK ("treeSizeBytes" >= 0);
CREATE INDEX "Folder_parentId_deletedAt_idx" ON "Folder" ("parentId", "deletedAt");
CREATE INDEX "File_live_folder_idx" ON "File" ("folderId") WHERE "deletedAt" IS NULL;

-- Use one lock mode before any row locks, including transactions that write
-- files before folders. Upgrading a shared lock here can deadlock two writers.
CREATE FUNCTION staaash_lock_folder_size_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staaash:folder-totals:hierarchy', 0));
  RETURN NULL;
END $$;
CREATE TRIGGER "File_lock_folder_sizes" BEFORE INSERT OR DELETE OR UPDATE OF "folderId", "sizeBytes", "deletedAt" ON "File"
FOR EACH STATEMENT EXECUTE FUNCTION staaash_lock_folder_size_hierarchy();
CREATE TRIGGER "Folder_lock_tree_sizes" BEFORE INSERT OR DELETE OR UPDATE OF "parentId", "deletedAt" ON "Folder"
FOR EACH STATEMENT EXECUTE FUNCTION staaash_lock_folder_size_hierarchy();

CREATE FUNCTION staaash_rebuild_folder_sizes(target_ids TEXT[]) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(array_length(target_ids, 1), 0) = 0 THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staaash:folder-totals:hierarchy', 0));
  PERFORM id FROM "Folder" WHERE id = ANY(target_ids) ORDER BY id FOR NO KEY UPDATE;
  WITH RECURSIVE tree(root_id, id) AS (
    SELECT id, id FROM "Folder" WHERE id = ANY(target_ids) AND "deletedAt" IS NULL
    UNION
    SELECT tree.root_id, child.id FROM tree JOIN "Folder" child ON child."parentId" = tree.id
    WHERE child."deletedAt" IS NULL
  ), totals AS (
    SELECT tree.root_id, SUM(file."sizeBytes") AS bytes FROM tree
    JOIN "File" file ON file."folderId" = tree.id AND file."deletedAt" IS NULL
    GROUP BY tree.root_id
  )
  UPDATE "Folder" folder SET "treeSizeBytes" = COALESCE(totals.bytes, 0)
  FROM (SELECT id FROM "Folder" WHERE id = ANY(target_ids)) targets
  LEFT JOIN totals ON totals.root_id = targets.id
  WHERE folder.id = targets.id;
END $$;

CREATE FUNCTION staaash_apply_folder_size_deltas(changes JSONB) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  WITH RECURSIVE ancestors(id, parent_id, bytes, visited) AS (
    SELECT folder.id, folder."parentId", change.bytes, ARRAY[folder.id]
    FROM jsonb_to_recordset(changes) AS change(folder_id TEXT, bytes BIGINT)
    JOIN "Folder" folder ON folder.id = change.folder_id AND folder."deletedAt" IS NULL
    WHERE change.bytes <> 0
    UNION ALL
    SELECT parent.id, parent."parentId", ancestors.bytes, ancestors.visited || parent.id
    FROM ancestors JOIN "Folder" parent ON parent.id = ancestors.parent_id
    WHERE parent."deletedAt" IS NULL AND NOT parent.id = ANY(ancestors.visited)
  ), deltas AS MATERIALIZED (
    SELECT id, SUM(bytes) AS bytes FROM ancestors GROUP BY id HAVING SUM(bytes) <> 0
  ), locked AS MATERIALIZED (
    SELECT folder.id FROM "Folder" folder JOIN deltas USING (id) ORDER BY folder.id FOR NO KEY UPDATE OF folder
  )
  UPDATE "Folder" folder SET "treeSizeBytes" = folder."treeSizeBytes" + delta.bytes
  FROM deltas delta JOIN locked USING (id) WHERE folder.id = delta.id;
END $$;

CREATE FUNCTION staaash_add_file_folder_sizes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changes JSONB;
BEGIN
  SELECT jsonb_agg(delta) INTO changes FROM (
    SELECT "folderId" AS folder_id, SUM("sizeBytes") AS bytes FROM new_files
    WHERE "deletedAt" IS NULL AND "folderId" IS NOT NULL GROUP BY "folderId"
  ) delta;
  PERFORM staaash_apply_folder_size_deltas(COALESCE(changes, '[]'::jsonb));
  RETURN NULL;
END $$;
CREATE TRIGGER "File_add_folder_sizes" AFTER INSERT ON "File"
REFERENCING NEW TABLE AS new_files FOR EACH STATEMENT EXECUTE FUNCTION staaash_add_file_folder_sizes();

CREATE FUNCTION staaash_remove_file_folder_sizes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changes JSONB;
BEGIN
  SELECT jsonb_agg(delta) INTO changes FROM (
    SELECT "folderId" AS folder_id, -SUM("sizeBytes") AS bytes FROM old_files
    WHERE "deletedAt" IS NULL AND "folderId" IS NOT NULL GROUP BY "folderId"
  ) delta;
  PERFORM staaash_apply_folder_size_deltas(COALESCE(changes, '[]'::jsonb));
  RETURN NULL;
END $$;
CREATE TRIGGER "File_remove_folder_sizes" AFTER DELETE ON "File"
REFERENCING OLD TABLE AS old_files FOR EACH STATEMENT EXECUTE FUNCTION staaash_remove_file_folder_sizes();

CREATE FUNCTION staaash_update_file_folder_sizes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changes JSONB;
BEGIN
  SELECT jsonb_agg(delta) INTO changes FROM (
    SELECT folder_id, SUM(bytes) AS bytes FROM (
      SELECT "folderId" AS folder_id, "sizeBytes" AS bytes FROM new_files WHERE "deletedAt" IS NULL
      UNION ALL
      SELECT "folderId", -"sizeBytes" FROM old_files WHERE "deletedAt" IS NULL
    ) changed WHERE folder_id IS NOT NULL GROUP BY folder_id HAVING SUM(bytes) <> 0
  ) delta;
  PERFORM staaash_apply_folder_size_deltas(COALESCE(changes, '[]'::jsonb));
  RETURN NULL;
END $$;
CREATE TRIGGER "File_update_folder_sizes" AFTER UPDATE ON "File"
REFERENCING OLD TABLE AS old_files NEW TABLE AS new_files FOR EACH STATEMENT EXECUTE FUNCTION staaash_update_file_folder_sizes();

-- Rebuild only changed folders and their old/new ancestors. This also handles
-- a whole branch changing deletion state before or after its file rows.
CREATE FUNCTION staaash_reparent_folder_sizes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE targets TEXT[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM old_folders before_rows JOIN new_folders after_rows USING (id)
    WHERE before_rows."parentId" IS DISTINCT FROM after_rows."parentId" OR before_rows."deletedAt" IS DISTINCT FROM after_rows."deletedAt"
  ) THEN RETURN NULL; END IF;
  WITH RECURSIVE changed AS (
    SELECT before_rows.id FROM old_folders before_rows JOIN new_folders after_rows USING (id)
    WHERE before_rows."parentId" IS DISTINCT FROM after_rows."parentId" OR before_rows."deletedAt" IS DISTINCT FROM after_rows."deletedAt"
  ), old_tree AS (
    SELECT id, "parentId" FROM old_folders
    UNION ALL SELECT folder.id, folder."parentId" FROM "Folder" folder
    WHERE NOT EXISTS (SELECT 1 FROM old_folders before_rows WHERE before_rows.id = folder.id)
  ), ancestors(id) AS (
    SELECT id FROM changed
    UNION
    SELECT parents.parent_id FROM ancestors JOIN LATERAL (
      SELECT "parentId" AS parent_id FROM old_tree WHERE id = ancestors.id
      UNION SELECT "parentId" FROM "Folder" WHERE id = ancestors.id
    ) parents ON parents.parent_id IS NOT NULL
  ) SELECT array_agg(id) INTO targets FROM ancestors;
  PERFORM staaash_rebuild_folder_sizes(targets);
  RETURN NULL;
END $$;
CREATE TRIGGER "Folder_reparent_tree_sizes" AFTER UPDATE ON "Folder"
REFERENCING OLD TABLE AS old_folders NEW TABLE AS new_folders FOR EACH STATEMENT EXECUTE FUNCTION staaash_reparent_folder_sizes();

CREATE FUNCTION staaash_delete_folder_sizes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE targets TEXT[];
BEGIN
  WITH RECURSIVE old_tree AS (
    SELECT id, "parentId" FROM old_folders
    UNION ALL SELECT folder.id, folder."parentId" FROM "Folder" folder
    WHERE NOT EXISTS (SELECT 1 FROM old_folders before_rows WHERE before_rows.id = folder.id)
  ), ancestors(id) AS (
    SELECT id FROM old_folders
    UNION SELECT old_tree."parentId" FROM ancestors JOIN old_tree ON old_tree.id = ancestors.id
    WHERE old_tree."parentId" IS NOT NULL
  ) SELECT array_agg(id) INTO targets FROM ancestors;
  PERFORM staaash_rebuild_folder_sizes(targets);
  RETURN NULL;
END $$;
CREATE TRIGGER "Folder_delete_tree_sizes" AFTER DELETE ON "Folder"
REFERENCING OLD TABLE AS old_folders FOR EACH STATEMENT EXECUTE FUNCTION staaash_delete_folder_sizes();

CREATE FUNCTION staaash_truncate_folder_sizes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Folder" SET "treeSizeBytes" = 0;
  RETURN NULL;
END $$;
CREATE TRIGGER "File_truncate_folder_sizes" AFTER TRUNCATE ON "File"
FOR EACH STATEMENT EXECUTE FUNCTION staaash_truncate_folder_sizes();

SELECT staaash_rebuild_folder_sizes(array_agg(id)) FROM "Folder";
COMMIT;
