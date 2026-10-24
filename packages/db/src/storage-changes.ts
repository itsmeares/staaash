import { Prisma } from "./client";

export const STORAGE_CHANGES_CHANNEL = "storage_changes";
export const STORAGE_CHANGE_RETENTION_DAYS = 90;
// One instance-wide key; pg_advisory_xact_lock takes a bigint.
const STORAGE_CHANGES_LOCK = 0x5354_4348n;

export type StorageChangeKind =
  | "created"
  | "updated"
  | "moved"
  | "trashed"
  | "restored"
  | "deleted";

type ItemState = {
  type: "file" | "folder";
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  deletedAt: Date | null;
  sizeBytes: bigint | null;
  contentChecksum: string | null;
  storageRevision: number;
  clientModifiedAt: Date | null;
};

export type StorageItemSnapshot = Map<string, ItemState>;

const keyOf = (type: string, id: string) => `${type}:${id}`;

/** Folder paths below the files root, keyed by folder id. */
const readFolderPaths = async (
  tx: Prisma.TransactionClient,
  folderIds: string[],
) => {
  if (folderIds.length === 0) return new Map<string, string>();
  const rows = await tx.$queryRaw<{ id: string; path: string | null }[]>`
    WITH RECURSIVE up AS (
      SELECT id AS start, id, "parentId", name, "isFilesRoot", 0 AS depth
      FROM "Folder" WHERE id = ANY(${folderIds}::text[])
      UNION ALL
      SELECT up.start, f.id, f."parentId", f.name, f."isFilesRoot", up.depth + 1
      FROM "Folder" f JOIN up ON f.id = up."parentId"
      WHERE up.depth < 1000
    )
    SELECT start AS id,
      string_agg(name, '/' ORDER BY depth DESC) FILTER (WHERE NOT "isFilesRoot") AS path
    FROM up GROUP BY start
  `;
  return new Map(rows.map((row) => [row.id, row.path ?? ""]));
};

const join = (parent: string | undefined, name: string) =>
  parent ? `${parent}/${name}` : name;

/** Reads the files and folders a mutation touches, with their logical paths. */
export const readStorageItemSnapshot = async (
  tx: Prisma.TransactionClient,
  mutationId: string,
): Promise<StorageItemSnapshot> => {
  const entities = await tx.storageMutationEntity.findMany({
    where: { mutationId, entityType: { in: ["file", "folder"] } },
    select: { entityType: true, entityId: true },
  });
  const ids = (type: string) =>
    entities.filter((e) => e.entityType === type).map((e) => e.entityId);
  const [files, folders] = await Promise.all([
    tx.file.findMany({
      where: { id: { in: ids("file") } },
      select: {
        id: true,
        folderId: true,
        originalName: true,
        deletedAt: true,
        sizeBytes: true,
        contentChecksum: true,
        storageRevision: true,
        clientModifiedAt: true,
      },
    }),
    tx.folder.findMany({
      where: { id: { in: ids("folder") }, isFilesRoot: false },
      select: {
        id: true,
        parentId: true,
        name: true,
        deletedAt: true,
        storageRevision: true,
      },
    }),
  ]);
  const paths = await readFolderPaths(tx, [
    ...new Set([
      ...folders.map((folder) => folder.id),
      ...files.flatMap((file) => (file.folderId ? [file.folderId] : [])),
    ]),
  ]);
  const snapshot: StorageItemSnapshot = new Map();
  for (const folder of folders) {
    snapshot.set(keyOf("folder", folder.id), {
      type: "folder",
      id: folder.id,
      parentId: folder.parentId,
      name: folder.name,
      path: paths.get(folder.id) ?? folder.name,
      deletedAt: folder.deletedAt,
      sizeBytes: null,
      contentChecksum: null,
      storageRevision: folder.storageRevision,
      clientModifiedAt: null,
    });
  }
  for (const file of files) {
    snapshot.set(keyOf("file", file.id), {
      type: "file",
      id: file.id,
      parentId: file.folderId,
      name: file.originalName,
      path: join(
        file.folderId ? paths.get(file.folderId) : undefined,
        file.originalName,
      ),
      deletedAt: file.deletedAt,
      sizeBytes: file.sizeBytes,
      contentChecksum: file.contentChecksum,
      storageRevision: file.storageRevision,
      clientModifiedAt: file.clientModifiedAt,
    });
  }
  return snapshot;
};

// One check per kind, in priority order; splitting them hides the order.
// fallow-ignore-next-line complexity
const kindOf = (
  before: ItemState | undefined,
  after: ItemState | undefined,
): StorageChangeKind | null => {
  if (!before) return after && !after.deletedAt ? "created" : null;
  if (!after) return "deleted";
  if (!before.deletedAt && after.deletedAt) return "trashed";
  if (before.deletedAt && !after.deletedAt) return "restored";
  if (after.deletedAt) return null;
  if (before.parentId !== after.parentId || before.name !== after.name) {
    return "moved";
  }
  // A folder rename moves its files on disk too; only new bytes count.
  if (
    before.contentChecksum !== after.contentChecksum ||
    before.sizeBytes !== after.sizeBytes
  ) {
    return "updated";
  }
  return null;
};

/** Appends one change per top-level item the mutation touched. */
export const appendStorageChanges = async (
  tx: Prisma.TransactionClient,
  {
    mutationId,
    ownerUserId,
    before,
  }: { mutationId: string; ownerUserId: string; before: StorageItemSnapshot },
) => {
  const after = await readStorageItemSnapshot(tx, mutationId);
  const kinds = new Map<string, StorageChangeKind>();
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const kind = kindOf(before.get(key), after.get(key));
    if (kind) kinds.set(key, kind);
  }
  // A child that moved, trashed, restored, or vanished with its folder is
  // covered by the folder's entry.
  const coveredByParent = (
    kind: StorageChangeKind,
    previous: ItemState | undefined,
    current: ItemState,
  ) =>
    kind !== "created" &&
    kind !== "updated" &&
    previous?.parentId === current.parentId &&
    kinds.get(keyOf("folder", current.parentId ?? "")) === kind;
  const changes = [...kinds].flatMap(([key, kind]) => {
    const previous = before.get(key);
    const current = after.get(key) ?? previous!;
    return coveredByParent(kind, previous, current)
      ? []
      : [{ kind, previous, current }];
  });
  if (changes.length === 0) return;
  // Parents come before their children, so a client can apply entries in order.
  changes.sort(
    (a, b) =>
      a.current.path.split("/").length - b.current.path.split("/").length,
  );
  // seq order is commit order: the lock holds until commit, so a reader that
  // sees seq N has already seen every smaller seq that will ever exist.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${STORAGE_CHANGES_LOCK})`;
  const mutation = await tx.storageMutation.findUnique({
    where: { id: mutationId },
    select: { originDeviceId: true },
  });
  const inserted = await tx.storageChange.createManyAndReturn({
    select: { seq: true },
    data: changes.map(({ kind, previous, current }) => ({
      ownerUserId,
      mutationId,
      kind,
      itemType: current.type,
      itemId: current.id,
      parentId: current.parentId,
      previousParentId:
        previous && previous.parentId !== current.parentId
          ? previous.parentId
          : null,
      path: current.path,
      previousPath:
        previous && previous.path !== current.path ? previous.path : null,
      name: current.name,
      sizeBytes: current.sizeBytes,
      contentChecksum: current.contentChecksum,
      storageRevision: current.storageRevision,
      clientModifiedAt: current.clientModifiedAt,
      originDeviceId: mutation?.originDeviceId ?? null,
    })),
  });
  const latestSeq = inserted.reduce(
    (max, row) => (row.seq > max ? row.seq : max),
    0n,
  );
  await tx.$executeRaw`SELECT pg_notify(${STORAGE_CHANGES_CHANNEL}, ${JSON.stringify({ ownerUserId, latestSeq: String(latestSeq) })})`;
};

type ChangeClient = Pick<Prisma.TransactionClient, "storageChange">;

const globalSeq = async (client: ChangeClient, order: "asc" | "desc") =>
  (
    await client.storageChange.findFirst({
      orderBy: { seq: order },
      select: { seq: true },
    })
  )?.seq ?? null;

/** The cursor for "everything up to now". Cursors are instance-wide seqs. */
export const currentStorageChangeCursor = async (client: ChangeClient) =>
  (await globalSeq(client, "desc")) ?? 0n;

export class StorageChangesExpiredError extends Error {
  constructor() {
    super("The change log no longer reaches back to this cursor.");
  }
}

/**
 * Changes after `after`, oldest first. Run it in one REPEATABLE READ
 * transaction so the returned cursor matches the rows.
 */
export const readStorageChanges = async (
  client: ChangeClient,
  {
    ownerUserId,
    after,
    limit,
  }: { ownerUserId: string; after: bigint; limit: number },
) => {
  const [oldest, head] = await Promise.all([
    globalSeq(client, "asc"),
    currentStorageChangeCursor(client),
  ]);
  // Anything between the cursor and the oldest kept row was pruned.
  if (oldest !== null && after < oldest - 1n) {
    throw new StorageChangesExpiredError();
  }
  const rows = await client.storageChange.findMany({
    where: { ownerUserId, seq: { gt: after, lte: head } },
    orderBy: { seq: "asc" },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const changes = rows.slice(0, limit);
  return {
    changes,
    hasMore,
    cursor: hasMore ? changes.at(-1)!.seq : head > after ? head : after,
  };
};

export const pruneStorageChanges = async (
  client: ChangeClient,
  now = new Date(),
) => {
  const newest = await globalSeq(client, "desc");
  if (newest === null) return { count: 0 };
  // The newest row stays so the table always marks how far back it reaches.
  return client.storageChange.deleteMany({
    where: {
      seq: { lt: newest },
      createdAt: {
        lt: new Date(
          now.getTime() - STORAGE_CHANGE_RETENTION_DAYS * 86_400_000,
        ),
      },
    },
  });
};

export type StorageSnapshotItem = {
  type: "folder" | "file";
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  sizeBytes: bigint | null;
  contentChecksum: string | null;
  storageRevision: number;
  clientModifiedAt: Date | null;
  updatedAt: Date;
};

/**
 * One page of the live tree under `folderId` (the files root when null),
 * folders first. `after` is the last item of the previous page.
 */
export const readStorageSnapshotPage = async (
  tx: Prisma.TransactionClient,
  {
    ownerUserId,
    folderId,
    after,
    limit,
  }: {
    ownerUserId: string;
    folderId: string | null;
    after: { type: "folder" | "file"; id: string } | null;
    limit: number;
  },
) => {
  const root = await tx.folder.findFirst({
    where: folderId
      ? { id: folderId, ownerUserId, deletedAt: null }
      : { ownerUserId, isFilesRoot: true },
    select: { id: true },
  });
  if (!root) return null;
  const rootPath = (await readFolderPaths(tx, [root.id])).get(root.id) ?? "";
  // "folder" sorts after "file", so DESC puts folders first.
  const rows = await tx.$queryRaw<StorageSnapshotItem[]>`
    WITH RECURSIVE tree AS (
      SELECT id, ${rootPath}::text AS path, 0 AS depth FROM "Folder" WHERE id = ${root.id}
      UNION ALL
      SELECT f.id,
        CASE WHEN tree.path = '' THEN f.name ELSE tree.path || '/' || f.name END,
        tree.depth + 1
      FROM "Folder" f JOIN tree ON f."parentId" = tree.id
      WHERE f."deletedAt" IS NULL AND f."ownerUserId" = ${ownerUserId} AND tree.depth < 1000
    ), items AS (
      SELECT 'folder' AS type, f.id, f."parentId", f.name, tree.path,
        NULL::bigint AS "sizeBytes", NULL::text AS "contentChecksum",
        f."storageRevision", NULL::timestamp AS "clientModifiedAt", f."updatedAt"
      FROM tree JOIN "Folder" f ON f.id = tree.id WHERE tree.depth > 0
      UNION ALL
      SELECT 'file', f.id, f."folderId", f."originalName",
        CASE WHEN tree.path = '' THEN f."originalName" ELSE tree.path || '/' || f."originalName" END,
        f."sizeBytes", f."contentChecksum", f."storageRevision", f."clientModifiedAt", f."updatedAt"
      FROM "File" f JOIN tree ON f."folderId" = tree.id
      WHERE f."deletedAt" IS NULL
    )
    SELECT * FROM items
    ${after ? Prisma.sql`WHERE (type < ${after.type}) OR (type = ${after.type} AND id > ${after.id})` : Prisma.empty}
    ORDER BY type DESC, id
    LIMIT ${limit + 1}
  `;
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
};
