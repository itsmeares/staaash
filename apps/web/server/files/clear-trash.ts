import { randomUUID } from "node:crypto";

import { getPrisma } from "@staaash/db/client";
import {
  claimStorageMutation,
  completeStorageMutationParent,
} from "@staaash/db/storage-mutations";

import {
  findDurableStorageMutationReplay,
  hashDurableStorageRequest,
  prepareDurableStorageMutationParent,
} from "@/server/durable-storage-mutation";
import { operationStatus } from "@/server/files/move-operation";
import { filesService } from "@/server/files/service";
import type {
  ClearTrashOperationResponse,
  TrashClearResult,
} from "@/server/files/types";

type ClearTrashInput = Parameters<typeof filesService.clearTrash>[0];
type ClearTrashActor = Pick<ClearTrashInput, "actorUserId" | "actorRole">;
type ClearTrashOrderedItems = NonNullable<
  ClearTrashInput["storageMutationOrderedItems"]
>;
type ClearTrashPriorChildren = NonNullable<
  ClearTrashInput["storageMutationPriorChildren"]
>;
type TrashListing = Awaited<ReturnType<typeof filesService.listTrashFolders>>;
type PreparedClearTrash = Awaited<
  ReturnType<typeof prepareDurableStorageMutationParent>
>;

const CLEAR_TRASH_REQUEST_HASH = hashDurableStorageRequest({
  action: "clear_trash",
});

const buildClearTrashItems = (
  listing: TrashListing,
): ClearTrashOrderedItems => [
  ...listing.files.map((item) => ({
    kind: "file" as const,
    id: item.file.id,
    deletedAt: item.file.deletedAt!.toISOString(),
    storageRevision: item.file.storageRevision ?? 0,
    trashEntryId: item.file.trashEntryId ?? null,
  })),
  ...listing.items.map((item) => ({
    kind: "folder" as const,
    id: item.folder.id,
    deletedAt: item.folder.deletedAt!.toISOString(),
    storageRevision: item.folder.storageRevision ?? 0,
    trashEntryId: item.folder.trashEntryId ?? null,
  })),
];

const readClearTrashPriorChildren = (
  resultJson: unknown,
): ClearTrashPriorChildren => {
  if (
    !resultJson ||
    typeof resultJson !== "object" ||
    !Array.isArray((resultJson as { children?: unknown }).children)
  ) {
    return [];
  }
  return (resultJson as { children: ClearTrashPriorChildren }).children;
};

const prepareClearTrash = async ({
  actor,
  idempotencyKey,
  orderedItems,
}: {
  actor: ClearTrashActor;
  idempotencyKey: string;
  orderedItems: ClearTrashOrderedItems;
}) =>
  prepareDurableStorageMutationParent({
    kind: "clear_trash",
    ownerUserId: actor.actorUserId,
    idempotencyKey,
    requestHash: CLEAR_TRASH_REQUEST_HASH,
    intentJson: { version: 1, orderedItems },
  });

class ClearTrashRecoveringError extends Error {
  readonly status = 503;
  readonly code = "STORAGE_MUTATION_RECOVERING";
  readonly details = { mutationKind: "clear_trash" };
  constructor(readonly mutationId: string) {
    super("Clear trash is in progress or being recovered.");
  }
}

const executePreparedClearTrash = async ({
  parent,
  actor,
  idempotencyKey,
  orderedItems,
}: {
  parent: PreparedClearTrash;
  actor: ClearTrashActor;
  idempotencyKey: string;
  orderedItems: ClearTrashOrderedItems;
}) => {
  if (parent.mutation.status === "succeeded") {
    return {
      mutationId: parent.mutation.id,
      result: parent.mutation.resultJson as Awaited<
        ReturnType<typeof filesService.clearTrash>
      >,
    };
  }
  const storedIntent = parent.mutation.intentJson as {
    orderedItems?: ClearTrashOrderedItems;
  };
  const leaseOwner = `web-clear-trash:${randomUUID()}`;
  const claimedParent = await claimStorageMutation({
    id: parent.mutation.id,
    leaseOwner,
  });
  if (!claimedParent) throw new ClearTrashRecoveringError(parent.mutation.id);
  const result = await filesService.clearTrash({
    ...actor,
    idempotencyKey,
    storageMutationParentId: claimedParent.id,
    storageMutationParentLeaseOwner: leaseOwner,
    storageMutationParentLeaseToken: claimedParent.leaseToken,
    storageMutationOrderedItems: storedIntent.orderedItems ?? orderedItems,
    storageMutationPriorChildren: readClearTrashPriorChildren(
      parent.mutation.resultJson,
    ),
  });
  await completeStorageMutationParent({
    parentId: claimedParent.id,
    leaseOwner,
    leaseToken: claimedParent.leaseToken,
    resultJson: result,
  });
  return { mutationId: claimedParent.id, result };
};

/**
 * Empties the trash as one journal parent. A retry with the same key replays
 * the stored result or resumes the unfinished parent.
 */
export const clearTrash = async (
  actor: ClearTrashActor,
  idempotencyKey: string,
) => {
  const replay = await findDurableStorageMutationReplay({
    kind: "clear_trash",
    ownerUserId: actor.actorUserId,
    idempotencyKey,
    requestHash: CLEAR_TRASH_REQUEST_HASH,
  });
  if (replay) {
    return executePreparedClearTrash({
      parent: { mutation: replay, replayed: true },
      actor,
      idempotencyKey,
      orderedItems: [],
    });
  }
  const orderedItems = buildClearTrashItems(
    await filesService.listTrashFolders(actor),
  );
  const parent = await prepareClearTrash({
    actor,
    idempotencyKey,
    orderedItems,
  });
  return executePreparedClearTrash({
    parent,
    actor,
    idempotencyKey,
    orderedItems,
  });
};

const isTrashClearResult = (value: unknown): value is TrashClearResult =>
  Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as TrashClearResult).deletedFolderCount === "number" &&
    typeof (value as TrashClearResult).deletedFileCount === "number",
  );

export const toClearTrashOperationResponse = (mutation: {
  id: string;
  status: string;
  intentJson: unknown;
  resultJson: unknown;
}): ClearTrashOperationResponse => {
  const status = operationStatus(mutation.status);
  const doneCount = readClearTrashPriorChildren(mutation.resultJson).length;
  // Completion redacts the intent, so a finished run counts its children.
  const intent = mutation.intentJson as { orderedItems?: unknown } | null;
  const progress = {
    operationId: mutation.id,
    totalCount: Array.isArray(intent?.orderedItems)
      ? intent.orderedItems.length
      : doneCount,
    doneCount,
  };
  if (status === "succeeded") {
    // Results older than a week are pruned; the run still finished.
    const result = mutation.resultJson;
    return {
      ...progress,
      status,
      ...(isTrashClearResult(result)
        ? {
            response: {
              deletedFolderCount: result.deletedFolderCount,
              deletedFileCount: result.deletedFileCount,
            },
          }
        : {}),
    };
  }
  if (status === "recovery_required") {
    return {
      ...progress,
      status,
      error: "Empty trash could not finish. Check the trash.",
    };
  }
  return { ...progress, status };
};

const findUnfinishedClearTrash = (ownerUserId: string) =>
  getPrisma().storageMutation.findFirst({
    where: {
      ownerUserId,
      kind: "clear_trash",
      parentId: null,
      status: { in: ["prepared", "running", "retrying"] },
    },
    orderBy: { createdAt: "desc" },
  });

/**
 * Records Empty trash as one journal parent for the worker to run, so the
 * caller polls the operation. A second request while one runs follows that
 * run instead of queueing behind its locks.
 */
export const startClearTrash = async (
  actor: ClearTrashActor,
  idempotencyKey: string,
) => {
  const replay = await findDurableStorageMutationReplay(
    {
      kind: "clear_trash",
      ownerUserId: actor.actorUserId,
      idempotencyKey,
      requestHash: CLEAR_TRASH_REQUEST_HASH,
    },
    { allowInProgress: true },
  );
  const existing =
    replay ?? (await findUnfinishedClearTrash(actor.actorUserId));
  if (existing) return toClearTrashOperationResponse(existing);
  const parent = await prepareDurableStorageMutationParent(
    {
      kind: "clear_trash",
      ownerUserId: actor.actorUserId,
      idempotencyKey,
      requestHash: CLEAR_TRASH_REQUEST_HASH,
      intentJson: {
        version: 1,
        orderedItems: buildClearTrashItems(
          await filesService.listTrashFolders(actor),
        ),
      },
    },
    { allowInProgress: true },
  );
  return toClearTrashOperationResponse(parent.mutation);
};
