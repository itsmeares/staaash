import { Prisma, getPrisma } from "@staaash/db/client";
import { parseListQuery, type ListQuery } from "@/server/list-window";
import { listTypeFilter } from "@/server/list-window";
import { sharingService } from "./service";
import type { FilesActor } from "@/server/files/types";

export async function getSharesPage(
  actor: FilesActor,
  baseUrl: string,
  active: boolean,
  query: ListQuery = {},
  all = false,
) {
  const q = parseListQuery(query);
  const rows = await getPrisma().$queryRaw<
    {
      id: string;
      fileId: string | null;
      folderId: string | null;
      total: bigint;
    }[]
  >(Prisma.sql`
    WITH RECURSIVE paths AS (
      SELECT id, "deletedAt" IS NOT NULL AS deleted, ARRAY[id] AS visited FROM "Folder"
      WHERE "ownerUserId" = ${actor.actorUserId} AND "isFilesRoot"
      UNION ALL SELECT child.id, paths.deleted OR child."deletedAt" IS NOT NULL, visited || child.id
      FROM paths JOIN "Folder" child ON child."parentId" = paths.id
      WHERE child."ownerUserId" = ${actor.actorUserId} AND NOT child.id = ANY(visited)
    ), items AS (
      SELECT s.id, s."fileId", s."folderId", s."updatedAt", s."targetType" AS kind,
        COALESCE(f."originalName", folder.name, 'Unavailable') AS name, COALESCE(f."mimeType", '') AS mime,
        s."revokedAt" IS NULL AND s."expiresAt" > NOW() AND CASE WHEN s."targetType" = 'file'
          THEN f.id IS NOT NULL AND f."deletedAt" IS NULL AND NOT COALESCE(parent.deleted, false)
          ELSE folder.id IS NOT NULL AND NOT COALESCE(own.deleted, folder."deletedAt" IS NOT NULL) END AS active
      FROM "ShareLink" s
      LEFT JOIN "File" f ON f.id = s."fileId" AND f."ownerUserId" = ${actor.actorUserId}
      LEFT JOIN "Folder" folder ON folder.id = s."folderId" AND folder."ownerUserId" = ${actor.actorUserId}
      LEFT JOIN paths parent ON parent.id = f."folderId"
      LEFT JOIN paths own ON own.id = folder.id
      WHERE s."createdByUserId" = ${actor.actorUserId}
    ), matches AS (
      SELECT * FROM items WHERE active = ${active} AND ${listTypeFilter(q.filter)}
      ${q.find.trim() ? Prisma.sql`AND position(staaash_list_search_text(${q.find.trim()}) in staaash_list_search_text(name)) > 0` : Prisma.empty}
    )
    SELECT page.*, totals.total FROM (SELECT COUNT(*) AS total FROM matches) totals
    LEFT JOIN LATERAL (SELECT id, "fileId", "folderId" FROM matches ORDER BY "updatedAt" DESC, id
      OFFSET ${q.offset} ${all ? Prisma.empty : Prisma.sql`LIMIT ${q.limit}`}) page ON TRUE`);
  const items = await hydrateShares(actor, baseUrl, rows);
  return {
    total: Number(rows[0]?.total ?? 0),
    items,
  };
}

async function hydrateShares(
  actor: FilesActor,
  baseUrl: string,
  rows: { id: string; fileId: string | null; folderId: string | null }[],
) {
  const ids = new Set(rows.flatMap((row) => (row.id ? [row.id] : [])));
  const map = new Map<
    string,
    Awaited<ReturnType<typeof sharingService.listOwnedShares>>["active"][number]
  >();
  for (let offset = 0; offset < rows.length; offset += 1000) {
    const chunk = rows.slice(offset, offset + 1000);
    const shares = await sharingService.listOwnedShares({
      ...actor,
      baseUrl,
      targets: {
        fileIds: chunk.flatMap((row) => (row.fileId ? [row.fileId] : [])),
        folderIds: chunk.flatMap((row) => (row.folderId ? [row.folderId] : [])),
      },
    });
    for (const share of [...shares.active, ...shares.inactive])
      if (ids.has(share.id)) map.set(share.id, share);
  }
  return rows.flatMap((row) => (map.has(row.id) ? [map.get(row.id)!] : []));
}
