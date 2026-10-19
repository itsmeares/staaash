import { storageReadPredicate } from "@/server/storage-read-guard";
import { Prisma, getPrisma } from "@staaash/db/client";
import { normalizeSearchText } from "@/server/search";
import type { SearchMatchKind } from "@/server/types";
import { hydrateRetrievalPage } from "./page";

export async function getSearchPage(
  userId: string,
  text: string,
  {
    offset = 0,
    limit = 50,
    kind,
    usableOnly = false,
  }: {
    offset?: number;
    limit?: number;
    kind?: "folder" | "file";
    usableOnly?: boolean;
  } = {},
) {
  const query = normalizeSearchText(text);
  if (!query) return { items: [], total: 0 };
  const pattern = query
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[σς]/g, "[σς]");
  const rows = await getPrisma().$queryRaw<
    { id: string; kind: "folder" | "file"; rank: number; total: bigint }[]
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
    ), candidates AS (
      SELECT f.id, 'folder'::text AS kind, f.name, COALESCE(p.path, 'Files / ' || f.name) AS path, f."updatedAt" AS updated
      FROM "Folder" f LEFT JOIN paths p ON p.id = f.id
      WHERE ${kind !== "file"} AND f."ownerUserId" = ${userId} AND NOT f."isFilesRoot" AND f."deletedAt" IS NULL
      UNION ALL
      SELECT f.id, 'file', f."originalName", COALESCE(p.path, 'Files') || ' / ' || f."originalName", f."updatedAt"
      FROM "File" f JOIN file_ids selected ON selected.id = f.id LEFT JOIN paths p ON p.id = f."folderId"
      WHERE ${kind !== "folder"} AND f."ownerUserId" = ${userId} AND f."deletedAt" IS NULL AND f."storageStatus" = 'available'
    ), normalized AS MATERIALIZED (
      SELECT *, staaash_list_search_text(name) AS n, staaash_list_search_text(path) AS p FROM candidates
    ), ranked AS (
      SELECT *, CASE
        WHEN n = ${query} OR ${query} = ANY(regexp_split_to_array(n || ' ' || p, '[^a-z0-9]+')) THEN 0
        WHEN starts_with(n, ${query}) OR starts_with(p, ${query}) OR EXISTS (
          SELECT 1 FROM unnest(regexp_split_to_array(n || ' ' || p, '[^a-z0-9]+')) token WHERE starts_with(token, ${query})
        ) THEN 1 ELSE 2 END AS rank
      FROM normalized WHERE (position(${query} in n) > 0 OR position(${query} in p) > 0)
      ${kind ? Prisma.sql`AND kind = ${kind}` : Prisma.empty}
      ${usableOnly ? Prisma.sql`AND (${storageReadPredicate(userId, Prisma.sql`normalized.id`, Prisma.sql`normalized.kind`)})` : Prisma.empty}
    )
    SELECT page.*, totals.total FROM (SELECT COUNT(*) AS total FROM ranked) totals
    LEFT JOIN LATERAL (
      SELECT id, kind, rank FROM ranked ORDER BY rank, updated DESC, p COLLATE "en-US-x-icu", n COLLATE "en-US-x-icu", id COLLATE "en-US-x-icu"
      OFFSET ${Math.max(0, Math.trunc(offset))} LIMIT ${Math.max(1, Math.min(50, Math.trunc(limit)))}
    ) page ON TRUE`);
  const refs = rows.filter((row) => row.id !== null);
  const page = await hydrateRetrievalPage(userId, {
    items: refs,
    total: Number(rows[0]?.total ?? 0),
  });
  const ranks = new Map(refs.map((row) => [row.id, row.rank]));
  return {
    ...page,
    items: page.items.map((item) => ({
      ...item,
      matchKind: (["exact", "prefix", "substring"] satisfies SearchMatchKind[])[
        ranks.get(item.id) ?? 2
      ],
    })),
  };
}
