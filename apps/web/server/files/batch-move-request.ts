import { z } from "zod";

import { getPrisma } from "@staaash/db/client";
import { readFolderSubtreeIds } from "@staaash/db/folder-tree";
import type { StorageMutationEntityInput } from "@staaash/db/storage-mutations";

import {
  hashDurableStorageRequest,
  prepareDurableStorageMutationParent,
} from "@/server/durable-storage-mutation";
import { toBatchMoveOperationResponse } from "@/server/files/move-operation";

export const batchMoveRequestSchema = z.object({
  destinationFolderId: z.string().trim().min(1),
  items: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        kind: z.enum(["file", "folder"]),
      }),
    )
    .min(1)
    .max(500),
  source: z.enum(["direct", "paste"]).default("direct"),
});

export type BatchMoveRequest = z.infer<typeof batchMoveRequestSchema>;

// Folder moves also guard every descendant so nested reads wait for completion.
// fallow-ignore-next-line complexity
const buildMoveGuardEntities = async (
  ownerUserId: string,
  request: BatchMoveRequest,
): Promise<StorageMutationEntityInput[]> => {
  const fileIds = request.items
    .filter((item) => item.kind === "file")
    .map((item) => item.id);
  const folderIds = request.items
    .filter((item) => item.kind === "folder")
    .map((item) => item.id);
  const subtree = folderIds.length
    ? await readFolderSubtreeIds(getPrisma(), ownerUserId, folderIds, {
        includeDeletedRoots: true,
      })
    : [];
  const guardedFolderIds = subtree.map(({ id }) => id);
  const [folders, destination] = await Promise.all([
    guardedFolderIds.length > 0
      ? getPrisma().folder.findMany({
          where: { ownerUserId, id: { in: guardedFolderIds } },
          select: {
            id: true,
            storageRevision: true,
          },
        })
      : Promise.resolve([]),
    getPrisma().folder.findFirst({
      where: { id: request.destinationFolderId, ownerUserId },
      select: { id: true, storageRevision: true },
    }),
  ]);
  const files = await getPrisma().file.findMany({
    where: {
      ownerUserId,
      OR: [
        ...(fileIds.length > 0 ? [{ id: { in: fileIds } }] : []),
        ...(guardedFolderIds.length > 0
          ? [{ folderId: { in: guardedFolderIds } }]
          : []),
      ],
    },
    select: { id: true, storageRevision: true },
  });
  const entities = new Map<string, StorageMutationEntityInput>();
  const add = (
    entityType: "file" | "folder",
    row: { id: string; storageRevision: number },
  ) => {
    entities.set(`${entityType}:${row.id}`, {
      entityType,
      entityId: row.id,
      preRevision: row.storageRevision,
      postRevision: row.storageRevision,
    });
  };
  for (const file of files) add("file", file);
  for (const folder of folders) add("folder", folder);
  if (destination) add("folder", destination);
  return [...entities.values()];
};

/**
 * Records a batch move as one journal parent. The worker runs it, so the
 * caller polls the operation until it settles.
 */
export const startBatchMove = async ({
  ownerUserId,
  idempotencyKey,
  request,
}: {
  ownerUserId: string;
  idempotencyKey: string;
  request: BatchMoveRequest;
}) => {
  const parent = await prepareDurableStorageMutationParent(
    {
      kind: "batch_move",
      ownerUserId,
      idempotencyKey,
      requestHash: hashDurableStorageRequest(request),
      intentJson: {
        version: 1,
        destinationFolderId: request.destinationFolderId,
        items: request.items,
        source: request.source,
      },
      resourceKeys: [],
      entities: await buildMoveGuardEntities(ownerUserId, request),
    },
    { allowInProgress: true },
  );
  return {
    mutationId: parent.mutation.id,
    operation: toBatchMoveOperationResponse(parent.mutation),
  };
};
