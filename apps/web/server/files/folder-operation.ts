import { createHash } from "node:crypto";

import { getPrisma } from "@staaash/db/client";
import { storageMutationRejectionFromResult } from "@staaash/db/storage-mutations";

import type {
  FolderMutationResult,
  FolderOperationError,
  FolderOperationResponse,
} from "@/server/files/types";

/**
 * Above this many files and folders, a folder change sent with
 * `Prefer: respond-async` answers 202 and finishes in the background. On a
 * two-core server, a tree this size still finishes in about two seconds in
 * the request.
 */
export const BACKGROUND_FOLDER_ITEMS = 2_000;

/** Files and folders in the tree, the folder itself included. */
export const countFolderTreeItems = async (
  ownerUserId: string,
  folderId: string,
) => {
  const [row] = await getPrisma().$queryRaw<Array<{ items: bigint }>>`
    WITH RECURSIVE tree AS (
      SELECT id FROM "Folder" WHERE id = ${folderId} AND "ownerUserId" = ${ownerUserId}
      UNION
      SELECT child.id FROM "Folder" child JOIN tree ON child."parentId" = tree.id
      WHERE child."ownerUserId" = ${ownerUserId}
    )
    SELECT (SELECT count(*) FROM tree)
      + (SELECT count(*) FROM "File" WHERE "ownerUserId" = ${ownerUserId}
          AND "folderId" IN (SELECT id FROM tree)) AS items
  `;
  return Number(row?.items ?? 0);
};

type Task = {
  ownerUserId: string;
  totalCount: number;
  result?: FolderMutationResult;
  error?: FolderOperationError;
};

// Changes this server is planning or running. The journal row takes over
// once it exists, so a restart only loses changes that had not begun.
const tasks = new Map<string, Task>();
const SETTLED_TASK_MS = 15 * 60_000;

/** The same request from the same account always names the same change. */
export const folderOperationId = ({
  ownerUserId,
  kind,
  folderId,
  idempotencyKey,
}: {
  ownerUserId: string;
  kind: string;
  folderId: string;
  idempotencyKey: string;
}) => {
  const hex = createHash("sha256")
    .update(`folder-operation:${ownerUserId}:${kind}:${folderId}`)
    .update(`\0${idempotencyKey}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const operationError = (error: unknown): FolderOperationError => {
  const known = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    details?: { mutationKind?: unknown };
  } | null;
  if (
    error instanceof Error &&
    typeof known?.status === "number" &&
    typeof known.code === "string"
  ) {
    const mutationKind = known.details?.mutationKind;
    return {
      status: known.status,
      code: known.code,
      message: error.message,
      ...(typeof mutationKind === "string" ? { mutationKind } : {}),
    };
  }
  console.error("[files] Background folder change failed.", error);
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Unexpected server error.",
  };
};

const readResponse = (resultJson: unknown) => {
  const response = (resultJson as { response?: unknown } | null)?.response;
  return response && typeof response === "object"
    ? (response as FolderMutationResult)
    : undefined;
};

const countJournalItems = (mutationId: string) =>
  getPrisma().storageMutationEntity.count({
    where: { mutationId, entityType: { in: ["file", "folder"] } },
  });

type OperationMutation = {
  kind: string;
  status: string;
  metadataOperationsApplied: number;
  resultJson: unknown;
};
type OperationBase = Pick<
  FolderOperationResponse,
  "operationId" | "totalCount" | "doneCount"
>;

// A replayed request finishes without a journal row of its own.
const taskOperation = (
  base: OperationBase,
  task: Task,
): FolderOperationResponse => {
  if (task.error) return { ...base, status: "failed", error: task.error };
  if (!task.result) return { ...base, status: "queued" };
  return {
    ...base,
    status: "succeeded",
    doneCount: base.totalCount,
    response: task.result,
  };
};

const mutationOperation = (
  base: OperationBase,
  mutation: OperationMutation,
  task: Task | undefined,
): FolderOperationResponse => {
  switch (mutation.status) {
    case "preparing":
    case "prepared":
      return { ...base, status: "queued" };
    case "succeeded":
      return {
        ...base,
        status: "succeeded",
        doneCount: base.totalCount,
        response: task?.result ?? readResponse(mutation.resultJson),
      };
    case "aborted":
      return {
        ...base,
        status: "failed",
        error: operationError(
          storageMutationRejectionFromResult(mutation.resultJson),
        ),
      };
    case "recovery_required":
      return {
        ...base,
        status: "recovery_required",
        error: {
          status: 503,
          code: "STORAGE_RECOVERY_REQUIRED",
          message: "Storage recovery has to check this folder first.",
          mutationKind: mutation.kind,
        },
      };
    default:
      return {
        ...base,
        status: "running",
        doneCount: Math.min(
          mutation.metadataOperationsApplied,
          base.totalCount,
        ),
      };
  }
};

export const readFolderOperation = async (
  operationId: string,
  ownerUserId: string,
): Promise<FolderOperationResponse | null> => {
  const task = tasks.get(operationId);
  const mutation = await getPrisma().storageMutation.findUnique({
    where: { id: operationId },
    select: {
      ownerUserId: true,
      kind: true,
      status: true,
      metadataOperationsApplied: true,
      resultJson: true,
    },
  });
  if ((mutation ?? task)?.ownerUserId !== ownerUserId) return null;
  const totalCount = task?.totalCount ?? (await countJournalItems(operationId));
  const base = { operationId, totalCount, doneCount: 0 };
  return mutation
    ? mutationOperation(base, mutation, task)
    : taskOperation(base, task!);
};

/**
 * Starts a folder change in the background and answers with its state. A
 * retry of the same request follows the change already under way.
 */
export const startFolderOperation = async ({
  operationId,
  ownerUserId,
  totalCount,
  run,
}: {
  operationId: string;
  ownerUserId: string;
  totalCount: number;
  run: (storageMutationId: string) => Promise<FolderMutationResult>;
}) => {
  const recorded =
    tasks.has(operationId) ||
    (await getPrisma().storageMutation.count({ where: { id: operationId } })) >
      0;
  if (!recorded && !tasks.has(operationId)) {
    const task: Task = { ownerUserId, totalCount };
    tasks.set(operationId, task);
    void run(operationId)
      .then(
        (result) => {
          task.result = result;
        },
        (error: unknown) => {
          task.error = operationError(error);
        },
      )
      .finally(() => {
        setTimeout(() => tasks.delete(operationId), SETTLED_TASK_MS).unref();
      });
  }
  return (await readFolderOperation(operationId, ownerUserId))!;
};
