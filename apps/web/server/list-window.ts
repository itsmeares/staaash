import { storageReadPredicate } from "./storage-read-guard";
import { z } from "zod";
import { Prisma, getPrisma } from "@staaash/db/client";
import { fileMimeTypeSql } from "./file-types";

const LIST_BATCH_SIZE = 100;

export const listQuerySchema = z.object({
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(1000).default(LIST_BATCH_SIZE),
  sort: z
    .enum([
      "name",
      "size",
      "path",
      "at",
      "favoritedAt",
      "deletedAt",
      "left",
      "modified",
    ])
    .optional(),
  direction: z.enum(["asc", "desc"]).default("desc"),
  filter: z
    .enum([
      "all",
      "archive",
      "audio",
      "folder",
      "image",
      "pdf",
      "text",
      "video",
    ])
    .optional(),
  find: z.string().max(1024).default(""),
  pinnedOnly: z.boolean().default(false),
  liveOnly: z.boolean().default(false),
  filesOnly: z.boolean().default(false),
  usableOnly: z.boolean().default(false),
  viewerOnly: z.boolean().default(false),
  grouped: z.boolean().default(false),
});
export type ListQuery = z.input<typeof listQuerySchema>;
export const parseListQuery = (query: ListQuery) =>
  listQuerySchema.parse(query);

export type ListPage<T> = { items: T[]; total: number };
export type ListScope = "folder" | "favorites" | "recent" | "added" | "trash";

type WindowRow = {
  id: string;
  kind: "file" | "folder";
  total: bigint;
  position: bigint;
};

export const listTypeFilter = (filter: ListQuery["filter"]) =>
  !filter || filter === "all"
    ? Prisma.sql`TRUE`
    : Prisma.sql`
  CASE WHEN kind = 'folder' THEN 'folder'
    WHEN mime LIKE 'image/%' THEN 'image'
    WHEN mime LIKE 'video/%' THEN 'video'
    WHEN mime LIKE 'audio/%' THEN 'audio'
    WHEN mime LIKE '%pdf%' THEN 'pdf'
    WHEN mime LIKE 'text/%' OR mime LIKE '%typescript%' OR mime LIKE '%json%' OR mime LIKE '%document%' THEN 'text'
    WHEN mime LIKE '%zip%' OR mime LIKE '%archive%' OR mime LIKE '%tar%' OR mime LIKE '%gzip%' THEN 'archive'
    ELSE 'all' END = ${filter}`;

export const recentListOrder = (tied = Prisma.sql`TRUE`) => Prisma.sql`
  recent_at DESC,
  CASE WHEN ${tied} THEN staaash_list_search_text(path || ' / ' || name) END COLLATE "en-US-x-icu",
  CASE WHEN ${tied} THEN staaash_list_search_text(name) END COLLATE "en-US-x-icu",
  id COLLATE "en-US-x-icu"`;

function listOrder(scope: ListScope, query: ReturnType<typeof parseListQuery>) {
  const direction =
    query.direction === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const natural = Prisma.sql`name COLLATE staaash_natural`;
  const columns = {
    name: natural,
    size: Prisma.sql`size`,
    path: Prisma.sql`path COLLATE staaash_natural`,
    modified: Prisma.sql`modified`,
    favoritedAt: Prisma.sql`favorite_at`,
    deletedAt: Prisma.sql`deleted`,
    left: Prisma.sql`deleted`,
    at: Prisma.sql`created`,
  };
  const defaults = {
    folder: "name",
    favorites: "favoritedAt",
    recent: "at",
    added: "at",
    trash: "deletedAt",
  } as const;
  const key = columns[query.sort ?? defaults[scope]];
  const common = Prisma.sql`${key} ${direction}, ${natural} ${direction}, kind ${direction}, id ${direction}`;
  return {
    folder: Prisma.sql`kind DESC, ${key} ${direction}, ${natural} ${direction}, id ${direction}`,
    favorites: common,
    added: common,
    trash: common,
    recent: recentListOrder(),
  }[scope];
}

export function buildListSource(
  userId: string,
  scope: ListScope,
  query: ListQuery = {},
  folderId?: string,
) {
  const q = parseListQuery(query);
  const folderScope = scope === "folder";
  const favorites = scope === "favorites";
  const recent = scope === "recent";
  const trash = scope === "trash";
  const active = folderScope || favorites || q.liveOnly;
  const needsPaths = q.sort === "path" || recent;
  const source = Prisma.sql`WITH RECURSIVE paths(id, path, visited) AS (
    SELECT f.id, CASE WHEN f."isFilesRoot" THEN f.name ELSE COALESCE((SELECT name FROM "Folder" WHERE "ownerUserId" = ${userId} AND "isFilesRoot" LIMIT 1), 'Files') || ' / ' || f.name END, ARRAY[f.id]
    FROM "Folder" f WHERE ${needsPaths} AND f."ownerUserId" = ${userId}
      AND (NOT ${favorites} OR f."deletedAt" IS NULL)
      AND (f."isFilesRoot" OR NOT EXISTS (SELECT 1 FROM "Folder" parent WHERE parent.id = f."parentId" AND parent."ownerUserId" = ${userId} AND (NOT ${favorites} OR parent."deletedAt" IS NULL)))
    UNION ALL
    SELECT child.id, paths.path || ' / ' || child.name, visited || child.id
    FROM paths JOIN "Folder" child ON child."parentId" = paths.id
    WHERE child."ownerUserId" = ${userId} AND NOT child.id = ANY(visited)
      AND (NOT ${favorites} OR child."deletedAt" IS NULL)
  ), items AS (
    SELECT f.id, 'folder'::text AS kind, f.name, ''::text AS mime, -1::bigint AS size,
      f."createdAt" AS created, f."updatedAt" AS modified, f."deletedAt" AS deleted,
      fav."createdAt" AS favorite_at, fav."quickAccessPinnedAt" AS pinned_at,
      r."lastInteractedAt" AS recent_at, f."parentId" AS parent_id, r."lastAction" AS action,
      COALESCE(p.path, 'Files') AS path, f."trashEntryId" AS trash_entry, TRUE AS available
    FROM "Folder" f
    LEFT JOIN "FavoriteFolder" fav ON fav."folderId" = f.id AND fav."userId" = ${userId}
    LEFT JOIN "RecentFolder" r ON r."folderId" = f.id AND r."userId" = ${userId}
    LEFT JOIN paths p ON p.id = f."parentId"
    WHERE f."ownerUserId" = ${userId} AND NOT f."isFilesRoot"
    UNION ALL
    SELECT f.id, 'file', f."originalName", ${fileMimeTypeSql(Prisma.sql`f."mimeType"`, Prisma.sql`f."originalName"`)}, f."sizeBytes", f."createdAt", COALESCE(f."clientModifiedAt", f."updatedAt"), f."deletedAt",
      fav."createdAt", fav."quickAccessPinnedAt", r."lastInteractedAt", f."folderId", r."lastAction",
      COALESCE(p.path, 'Files'), f."trashEntryId", f."storageStatus" = 'available'
    FROM "File" f
    LEFT JOIN "FavoriteFile" fav ON fav."fileId" = f.id AND fav."userId" = ${userId}
    LEFT JOIN "RecentFile" r ON r."fileId" = f.id AND r."userId" = ${userId}
    LEFT JOIN paths p ON p.id = f."folderId"
    WHERE f."ownerUserId" = ${userId}
  ), matches AS NOT MATERIALIZED (
    SELECT * FROM items WHERE ${listTypeFilter(q.filter)}
      AND (NOT ${folderScope} OR (parent_id = ${folderId ?? null} AND available))
      AND (NOT ${active} OR deleted IS NULL)
      AND (NOT ${favorites} OR favorite_at IS NOT NULL)
      AND (NOT ${recent} OR recent_at IS NOT NULL)
      AND (NOT ${q.pinnedOnly} OR pinned_at IS NOT NULL)
      AND (NOT ${q.filesOnly} OR kind = 'file')
      AND (NOT ${q.viewerOnly} OR (kind = 'file' AND mime ~ '^(image/|video/|audio/|text/|application/pdf)'))
      AND (${q.find} = '' OR position(staaash_list_search_text(${q.find}) in staaash_list_search_text(name)) > 0)
      AND (NOT ${q.usableOnly} OR (${storageReadPredicate(userId, Prisma.sql`items.id`, Prisma.sql`items.kind`)}))
      AND (NOT ${trash} OR (deleted IS NOT NULL AND CASE WHEN kind = 'folder' THEN NOT EXISTS (
        SELECT 1 FROM "Folder" parent WHERE parent.id = items.parent_id AND parent."deletedAt" IS NOT NULL
          AND parent."trashEntryId" IS NOT DISTINCT FROM items.trash_entry
      ) ELSE NOT EXISTS (
        WITH RECURSIVE ancestors AS (
          SELECT id, "parentId", "deletedAt", "trashEntryId", ARRAY[id] AS visited FROM "Folder" WHERE id = items.parent_id AND "ownerUserId" = ${userId}
          UNION ALL SELECT parent.id, parent."parentId", parent."deletedAt", parent."trashEntryId", ancestors.visited || parent.id
          FROM ancestors JOIN "Folder" parent ON parent.id = ancestors."parentId"
          WHERE parent."ownerUserId" = ${userId} AND NOT parent.id = ANY(ancestors.visited)
        ) SELECT 1 FROM ancestors WHERE "deletedAt" IS NOT NULL AND "trashEntryId" IS NOT DISTINCT FROM items.trash_entry
      ) END))
  )`;
  return { source, order: listOrder(scope, q) };
}

/** Select IDs before fetching previews, paths, share state, or full records. */
export async function getListWindow({
  userId,
  scope,
  folderId,
  query = {},
  all = false,
  aroundId,
}: {
  userId: string;
  scope: ListScope;
  folderId?: string;
  query?: ListQuery;
  all?: boolean;
  aroundId?: string;
}) {
  const { offset, limit } = parseListQuery(query);
  const { source, order } = buildListSource(userId, scope, query, folderId);
  const cutoff = recentWindowCutoff(scope, all, offset, limit);
  const select = aroundId
    ? Prisma.sql`${source}, ordered AS (
    SELECT id, kind, row_number() OVER (ORDER BY ${order}) - 1 AS position FROM matches
  ) SELECT page.*, totals.total FROM (SELECT COUNT(*) AS total FROM matches) totals
    LEFT JOIN LATERAL (SELECT id, kind, position FROM ordered
      WHERE position >= GREATEST(0, COALESCE((SELECT position FROM ordered WHERE id = ${aroundId}), 0) - 10)
      ORDER BY position LIMIT ${limit}) page ON TRUE`
    : Prisma.sql`${source} SELECT page.*, totals.total FROM (SELECT COUNT(*) AS total FROM matches) totals
      LEFT JOIN LATERAL (SELECT id, kind, 0::bigint AS position FROM matches ${cutoff} ORDER BY ${order}
        OFFSET ${offset} ${all ? Prisma.empty : Prisma.sql`LIMIT ${limit}`}) page ON TRUE`;
  const rows = await getPrisma().$queryRaw<WindowRow[]>(select);
  const [first = { total: 0n, position: 0n }] = rows;
  return {
    items: rows
      .filter((row) => row.id !== null)
      .map(({ id, kind }) => ({ id, kind })),
    total: Number(first.total),
    ...(aroundId ? { start: Number(first.position) } : {}),
  };
}

function recentWindowCutoff(
  scope: ListScope,
  all: boolean,
  offset: number,
  limit: number,
) {
  // Name ties matter only within the last date needed by this window.
  return scope === "recent" && !all
    ? Prisma.sql`
    WHERE recent_at >= COALESCE((SELECT recent_at FROM matches ORDER BY recent_at DESC
      OFFSET ${offset + limit - 1} LIMIT 1), '-infinity'::timestamp)`
    : Prisma.empty;
}
