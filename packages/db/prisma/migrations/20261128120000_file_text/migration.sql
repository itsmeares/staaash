BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gin;

ALTER TABLE "SystemSettings" ADD COLUMN "ocrMode" TEXT,
ADD COLUMN "ocrLanguages" TEXT[] DEFAULT ARRAY['eng']::TEXT[];

CREATE TYPE "FileTextStatus" AS ENUM ('pending', 'ready', 'failed', 'skipped');

CREATE TABLE "FileText" (
    "fileId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "sourceChecksum" TEXT,
    "sourceSize" BIGINT,
    "status" "FileTextStatus" NOT NULL,
    "source" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "words" tsvector,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "ocrPages" INTEGER[],
    "ocrDone" INTEGER NOT NULL DEFAULT 0,
    "ocrLanguages" TEXT[],
    "error" TEXT,
    "wantedAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileText_pkey" PRIMARY KEY ("fileId")
);

ALTER TABLE "FileText" ADD CONSTRAINT "FileText_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Words are runs of letters and digits, so invoice-2024 matches a search for
-- 2024. Accents are dropped and nothing is stemmed: a drive holds every
-- language.
CREATE TEXT SEARCH CONFIGURATION public.staaash_text (COPY = pg_catalog.simple);
ALTER TEXT SEARCH CONFIGURATION public.staaash_text
  ALTER MAPPING FOR asciiword, word, numword, asciihword, hword, numhword, hword_asciipart, hword_part, hword_numpart
  WITH public.unaccent, pg_catalog.simple;

CREATE FUNCTION staaash_text_clean(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(input, '[!-/:-@[-`{-~]+', ' ', 'g')
$$;

CREATE FUNCTION staaash_text_vector(input text) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT to_tsvector('public.staaash_text', staaash_text_clean(input))
$$;

-- Each word must start a word in the text, one-letter words are left out,
-- and each quoted phrase must appear in order. Null when nothing is left.
CREATE FUNCTION staaash_text_query(words text, phrases text[]) RETURNS tsquery
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN count(*) > 0 THEN to_tsquery('pg_catalog.simple', string_agg(part, ' & ')) END
  FROM (
    SELECT '''' || lexeme || ''':*' AS part
    FROM unnest(tsvector_to_array(staaash_text_vector(words))) lexeme
    WHERE length(lexeme) > 1
    UNION ALL
    SELECT '(' || query::text || ')'
    FROM unnest(phrases) phrase,
      phraseto_tsquery('public.staaash_text', staaash_text_clean(phrase)) query
    WHERE numnode(query) > 0
  ) parts
$$;

-- A tsvector holds at most 1 MB. Text full of unique long words, such as a
-- hex dump, passes that before the 1 MiB text limit, so it is cut instead.
CREATE FUNCTION staaash_sync_file_text_words() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  keep integer := length(NEW."text");
BEGIN
  LOOP
    BEGIN
      NEW."words" := staaash_text_vector(left(NEW."text", keep));
      EXIT;
    EXCEPTION WHEN program_limit_exceeded THEN
      keep := keep / 2;
      NEW."text" := left(NEW."text", keep);
      NEW."truncated" := true;
    END;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FileText_sync_words"
BEFORE INSERT OR UPDATE OF "text" ON "FileText"
FOR EACH ROW EXECUTE FUNCTION staaash_sync_file_text_words();

-- btree_gin puts the owner in the same index, so a common word does not
-- make PostgreSQL scan every drive.
CREATE INDEX "FileText_owner_words_idx" ON "FileText" USING GIN ("ownerUserId" text_ops, "words" tsvector_ops);

COMMIT;
