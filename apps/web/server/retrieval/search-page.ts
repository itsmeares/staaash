import { storageReadPredicate } from "@/server/storage-read-guard";
import { Prisma, getPrisma } from "@staaash/db/client";
import { fileTextIsCurrent } from "@staaash/db/file-text";
import { normalizeSearchText, splitSearchWords } from "@/server/search";
import type { SearchMatchKind } from "@/server/types";
import { hydrateRetrievalPage } from "./page";

/** Only the newest text matches are ranked, so a common word stays fast. */
const RANKED_TEXT_MATCHES = 1000;
/** Snippets come from the start of the text; ts_headline reads every byte it gets. */
const SNIPPET_SOURCE_CHARS = 100_000;

export async function getSearchPage(
  userId: string,
  text: string,
  {
    offset = 0,
    limit = 50,
    kind,
    usableOnly = false,
    withinFolderId,
  }: {
    offset?: number;
    limit?: number;
    kind?: "folder" | "file";
    usableOnly?: boolean;
    /** Only what is inside this folder, not the folder itself. */
    withinFolderId?: string;
  } = {},
) {
  const { words, phrases } = splitSearchWords(text);
  const query = normalizeSearchText(text.replaceAll('"', ""));
  if (!query) return { items: [], total: 0 };
  const textQuery = Prisma.sql`staaash_text_query(${words}, ${phrases}::text[])`;
  // Paths run through folders above the limit, so they don't count.
  const nameHit = withinFolderId
    ? Prisma.sql`position(${query} in n) > 0`
    : Prisma.sql`(position(${query} in n) > 0 OR position(${query} in p) > 0)`;
  const pattern = query
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[σς]/g, "[σς]");
  const rows = await getPrisma().$queryRaw<
    {
      id: string;
      kind: "folder" | "file";
      rank: number;
      snippet: string | null;
      total: bigint;
    }[]
  >(Prisma.sql`
    WITH RECURSIVE paths(id, path, visited) AS (
      SELECT f.id, CASE WHEN f."isFilesRoot" THEN f.name ELSE COALESCE((SELECT name FROM "Folder" WHERE "ownerUserId" = ${userId} AND "isFilesRoot" LIMIT 1), 'Files') || ' / ' || f.name END, ARRAY[f.id]
      FROM "Folder" f WHERE f."ownerUserId" = ${userId} AND f."deletedAt" IS NULL
      AND (f."isFilesRoot" OR NOT EXISTS (SELECT 1 FROM "Folder" parent WHERE parent.id = f."parentId" AND parent."ownerUserId" = ${userId} AND parent."deletedAt" IS NULL))
      UNION ALL
      SELECT child.id, paths.path || ' / ' || child.name, visited || child.id
      FROM paths JOIN "Folder" child ON child."parentId" = paths.id
      WHERE child."ownerUserId" = ${userId} AND child."deletedAt" IS NULL AND NOT child.id = ANY(visited)
    ), path_matches(id) AS (
      SELECT id FROM "Folder" WHERE "ownerUserId" = ${userId} AND "deletedAt" IS NULL AND NOT "isFilesRoot"
      AND position(${query} in staaash_list_search_text(name)) > 0
      UNION
      SELECT child.id FROM path_matches JOIN "Folder" child ON child."parentId" = path_matches.id
      WHERE child."ownerUserId" = ${userId} AND child."deletedAt" IS NULL
    ), file_ids AS (
      SELECT id FROM "File" WHERE "ownerUserId" = ${userId} AND "deletedAt" IS NULL AND "storageStatus" = 'available'
      AND "searchName" ~* unaccent(lower(${pattern}))
      UNION
      SELECT id FROM "File" WHERE "ownerUserId" = ${userId} AND "deletedAt" IS NULL AND "storageStatus" = 'available'
      AND "folderId" IN (SELECT id FROM path_matches)
    ), text_hits AS MATERIALIZED (
      SELECT t."fileId" AS id, row_number() OVER (ORDER BY f."updatedAt" DESC, f.id) AS recency
      FROM "FileText" t JOIN "File" f ON f.id = t."fileId"
      WHERE ${kind !== "folder"} AND ${textQuery} IS NOT NULL
      AND t."ownerUserId" = ${userId} AND t.words @@ ${textQuery}
      AND f."ownerUserId" = ${userId} AND f."deletedAt" IS NULL AND f."storageStatus" = 'available'
      AND ${fileTextIsCurrent("t", "f")}
    ), text_ids AS (
      SELECT h.id, CASE WHEN h.recency <= ${RANKED_TEXT_MATCHES} THEN ts_rank(t.words, ${textQuery}) ELSE 0 END AS score
      FROM text_hits h JOIN "FileText" t ON t."fileId" = h.id
    )${
      withinFolderId
        ? Prisma.sql`, within(id) AS (
      SELECT id FROM "Folder" WHERE id = ${withinFolderId} AND "ownerUserId" = ${userId} AND "deletedAt" IS NULL
      UNION
      SELECT child.id FROM within JOIN "Folder" child ON child."parentId" = within.id
      WHERE child."ownerUserId" = ${userId} AND child."deletedAt" IS NULL
    )`
        : Prisma.empty
    }, candidates AS (
      SELECT f.id, 'folder'::text AS kind, f.name, COALESCE(p.path, 'Files / ' || f.name) AS path, f."updatedAt" AS updated, f."parentId" AS parent, NULL::real AS score
      FROM "Folder" f LEFT JOIN paths p ON p.id = f.id
      WHERE ${kind !== "file"} AND f."ownerUserId" = ${userId} AND NOT f."isFilesRoot" AND f."deletedAt" IS NULL
      UNION ALL
      SELECT f.id, 'file', f."originalName", COALESCE(p.path, 'Files') || ' / ' || f."originalName", f."updatedAt", f."folderId", t.score
      FROM (SELECT id FROM file_ids UNION SELECT id FROM text_ids) selected JOIN "File" f ON f.id = selected.id
      LEFT JOIN text_ids t ON t.id = f.id LEFT JOIN paths p ON p.id = f."folderId"
      WHERE ${kind !== "folder"} AND f."ownerUserId" = ${userId} AND f."deletedAt" IS NULL AND f."storageStatus" = 'available'
    ), normalized AS MATERIALIZED (
      SELECT *, staaash_list_search_text(name) AS n, staaash_list_search_text(path) AS p FROM candidates
    ), ranked AS (
      SELECT *, CASE
        WHEN NOT ${nameHit} THEN 3
        WHEN n = ${query} OR ${query} = ANY(regexp_split_to_array(n || ' ' || p, '[^a-z0-9]+')) THEN 0
        WHEN starts_with(n, ${query}) OR starts_with(p, ${query}) OR EXISTS (
          SELECT 1 FROM unnest(regexp_split_to_array(n || ' ' || p, '[^a-z0-9]+')) token WHERE starts_with(token, ${query})
        ) THEN 1 ELSE 2 END AS rank
      FROM normalized WHERE (${nameHit} OR score IS NOT NULL)
      ${kind ? Prisma.sql`AND kind = ${kind}` : Prisma.empty}
      ${withinFolderId ? Prisma.sql`AND parent IN (SELECT id FROM within)` : Prisma.empty}
      ${usableOnly ? Prisma.sql`AND (${storageReadPredicate(userId, Prisma.sql`normalized.id`, Prisma.sql`normalized.kind`)})` : Prisma.empty}
    )
    SELECT page.id, page.kind, page.rank, totals.total, CASE WHEN page.rank = 3 THEN (
      SELECT ts_headline('public.staaash_text', left(t.text, ${SNIPPET_SOURCE_CHARS}), ${textQuery},
        'MaxFragments=1, MaxWords=24, MinWords=10, StartSel="", StopSel=""')
      FROM "FileText" t WHERE t."fileId" = page.id
    ) END AS snippet
    FROM (SELECT COUNT(*) AS total FROM ranked) totals
    LEFT JOIN LATERAL (
      SELECT id, kind, rank FROM ranked
      ORDER BY rank, CASE WHEN rank = 3 THEN score END DESC NULLS LAST, updated DESC, p COLLATE "en-US-x-icu", n COLLATE "en-US-x-icu", id COLLATE "en-US-x-icu"
      OFFSET ${Math.max(0, Math.trunc(offset))} LIMIT ${Math.max(1, Math.min(50, Math.trunc(limit)))}
    ) page ON TRUE`);
  const refs = rows.filter((row) => row.id !== null);
  const page = await hydrateRetrievalPage(userId, {
    items: refs,
    total: Number(rows[0]?.total ?? 0),
  });
  const matches = new Map(refs.map((row) => [row.id, row]));
  return {
    ...page,
    items: page.items.map((item) => {
      const match = matches.get(item.id);
      return {
        ...item,
        matchKind: (
          ["exact", "prefix", "substring", "text"] satisfies SearchMatchKind[]
        )[match?.rank ?? 2],
        ...(match?.snippet ? { snippet: tidySnippet(match.snippet) } : {}),
      };
    }),
  };
}

const tidySnippet = (snippet: string) => snippet.replace(/\s+/g, " ").trim();
