import { Prisma, getPrisma } from "@staaash/db/client";
import {
  buildListSource,
  recentListOrder,
  parseListQuery,
  type ListQuery,
} from "@/server/list-window";
import { hydrateRetrievalPage } from "./page";
import {
  toActivityClientItem,
  type ActivityRow,
} from "@/app/(workspace)/recent/recent-helpers";

const activitySource = (userId: string, query: ListQuery) => {
  const { source } = buildListSource(userId, "recent", query);
  const order = recentListOrder(Prisma.sql`date_count > 1`);
  return Prisma.sql`${source}, dates AS (
    SELECT id, kind, mime, deleted, action, parent_id, recent_at, path, name,
      COUNT(*) OVER (PARTITION BY recent_at) AS date_count FROM matches
  ), ordered AS (
    SELECT id, kind, mime, deleted, action, parent_id, recent_at,
      row_number() OVER (ORDER BY ${order}) AS position,
      lag(deleted) OVER (ORDER BY ${order}) AS previous_deleted,
      lag(action) OVER (ORDER BY ${order}) AS previous_action,
      lag(parent_id) OVER (ORDER BY ${order}) AS previous_parent,
      lag(recent_at) OVER (ORDER BY ${order}) AS previous_at
    FROM dates
  ), marks AS (
    SELECT id, kind, mime, position, CASE WHEN deleted IS NULL AND previous_deleted IS NULL AND action IN ('uploaded', 'moved')
      AND action = previous_action AND parent_id IS NOT DISTINCT FROM previous_parent
      AND previous_at - recent_at <= INTERVAL '10 minutes' THEN 0 ELSE 1 END AS boundary
    FROM ordered
  ), members AS (
    SELECT id, kind, mime, position, SUM(boundary) OVER (ORDER BY position) AS run FROM marks
  ), runs AS (
    SELECT run, COUNT(*) AS size, MIN(position) AS first_position,
      (array_agg(id ORDER BY position))[1] AS head,
      (array_agg(id ORDER BY position))[1:5] AS samples,
      CASE WHEN bool_and(mime LIKE 'image/%') THEN 'photos'
        WHEN bool_and(mime LIKE 'video/%') THEN 'videos'
        WHEN bool_and(kind = 'file') THEN 'files' ELSE 'items' END AS noun
    FROM members GROUP BY run
  ), rows AS (
    SELECT members.id, members.kind, members.position,
      CASE WHEN runs.size >= 4 THEN runs.size ELSE 1 END AS size,
      CASE WHEN runs.size >= 4 THEN runs.samples ELSE ARRAY[members.id] END AS samples,
      runs.noun
    FROM members JOIN runs USING (run)
    WHERE runs.size < 4 OR members.position = runs.first_position
  )`;
};

export async function getActivityPage(
  userId: string,
  query: ListQuery = {},
  all = false,
) {
  query = parseListQuery(query);
  const rows = await getPrisma().$queryRaw<
    {
      id: string;
      kind: "file" | "folder";
      size: bigint;
      samples: string[];
      noun: string;
      total: bigint;
    }[]
  >(Prisma.sql`
    ${activitySource(userId, query)}
    SELECT page.*, totals.total FROM (SELECT COUNT(*) AS total FROM rows) totals
    LEFT JOIN LATERAL (SELECT * FROM rows ORDER BY position OFFSET ${query.offset ?? 0}
      ${all ? Prisma.empty : Prisma.sql`LIMIT ${Math.min(1000, query.limit ?? 100)}`}) page ON TRUE`);
  const sampleIds = rows.flatMap((row) => row.samples ?? []);
  const refs = await getPrisma().$queryRaw<
    { id: string; kind: "file" | "folder" }[]
  >(Prisma.sql`
    SELECT id, 'file'::text AS kind FROM "File" WHERE "ownerUserId" = ${userId} AND id = ANY(${sampleIds}::text[])
    UNION ALL SELECT id, 'folder' FROM "Folder" WHERE "ownerUserId" = ${userId} AND id = ANY(${sampleIds}::text[])`);
  const hydrated: Awaited<ReturnType<typeof hydrateRetrievalPage>>["items"] =
    [];
  for (let offset = 0; offset < refs.length; offset += 1000) {
    hydrated.push(
      ...(
        await hydrateRetrievalPage(userId, {
          items: refs.slice(offset, offset + 1000),
          total: refs.length,
        })
      ).items,
    );
  }
  const map = new Map(
    hydrated.map((item) => [item.id, toActivityClientItem(item)]),
  );
  const items: ActivityRow[] = rows.flatMap((row) => {
    const head = map.get(row.id);
    if (!head) return [];
    return Number(row.size) >= 4
      ? [
          {
            ...head,
            id: `batch:${row.id}`,
            batchAnchor: row.id,
            batchSize: Number(row.size),
            batchNoun: row.noun,
            batch: row.samples.flatMap((id) =>
              map.has(id) ? [map.get(id)!] : [],
            ),
          },
        ]
      : [head];
  });
  return { items, total: Number(rows[0]?.total ?? 0) };
}

export async function resolveActivitySelection(
  userId: string,
  query: ListQuery,
  ids: string[],
) {
  query = parseListQuery(query);
  const heads = ids
    .filter((id) => id.startsWith("batch:"))
    .map((id) => id.slice(6));
  const singles = ids.filter((id) => !id.startsWith("batch:"));
  const refs = await getPrisma().$queryRaw<
    { id: string; kind: "file" | "folder"; selection_id: string }[]
  >(Prisma.sql`
    ${activitySource(userId, query)}
    SELECT members.id, members.kind, CASE WHEN runs.size >= 4 THEN 'batch:' || runs.head ELSE members.id END AS selection_id
    FROM members JOIN runs USING (run)
    WHERE runs.head = ANY(${heads}::text[]) OR members.id = ANY(${singles}::text[])
    ORDER BY members.position`);
  const found = new Set(refs.map((ref) => ref.selection_id));
  if (ids.some((id) => !found.has(id)))
    throw new Error("Activity changed. Refresh the list and try again.");
  const items: Awaited<ReturnType<typeof hydrateRetrievalPage>>["items"] = [];
  for (let offset = 0; offset < refs.length; offset += 1000) {
    items.push(
      ...(
        await hydrateRetrievalPage(userId, {
          items: refs.slice(offset, offset + 1000),
          total: refs.length,
        })
      ).items,
    );
  }
  return items.map(toActivityClientItem);
}
