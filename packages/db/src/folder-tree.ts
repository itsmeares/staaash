import { Prisma } from "./client";

type FolderQueryClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export const readFolderAncestorIds = (
  client: FolderQueryClient,
  ownerUserId: string,
  folderIds: string[],
) => client.$queryRaw<{ id: string }[]>`
  WITH RECURSIVE ancestors AS (
    SELECT id, "parentId" FROM "Folder"
    WHERE id = ANY(${folderIds}::text[]) AND "ownerUserId" = ${ownerUserId}
    UNION
    SELECT parent.id, parent."parentId" FROM "Folder" parent
    JOIN ancestors child ON parent.id = child."parentId"
    WHERE parent."ownerUserId" = ${ownerUserId}
  ) SELECT id FROM ancestors
`;

export const readFolderSubtreeIds = (
  client: FolderQueryClient,
  ownerUserId: string,
  folderId: string | string[],
  { includeDeleted = false, includeDeletedRoots = false } = {},
) => client.$queryRaw<{ id: string }[]>`
  WITH RECURSIVE subtree AS (
    SELECT id FROM "Folder"
    WHERE id = ANY(${typeof folderId === "string" ? [folderId] : folderId}::text[]) AND "ownerUserId" = ${ownerUserId}
      ${includeDeleted || includeDeletedRoots ? Prisma.empty : Prisma.sql`AND "deletedAt" IS NULL`}
    UNION
    SELECT child.id FROM "Folder" child
    JOIN subtree parent ON child."parentId" = parent.id
    WHERE child."ownerUserId" = ${ownerUserId}
      ${includeDeleted ? Prisma.empty : Prisma.sql`AND child."deletedAt" IS NULL`}
  ) SELECT id FROM subtree
`;
