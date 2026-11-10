import { getPrisma } from "@staaash/db/client";
import { storageMutationRejectionFromResult } from "@staaash/db/storage-mutations";

import type {
  FolderMutationResult,
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

const mutationOperation = (
  base: OperationBase,
  mutation: OperationMutation,
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
        response: readResponse(mutation.resultJson),
      };
    case "aborted": {
      const rejection = storageMutationRejectionFromResult(mutation.resultJson);
      return {
        ...base,
        status: "failed",
        error: {
          status: rejection.status,
          code: rejection.code,
          message: rejection.message,
          mutationKind: mutation.kind,
        },
      };
    }
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
  if (!mutation || mutation.ownerUserId !== ownerUserId) return null;
  const totalCount = await countJournalItems(operationId);
  const base = { operationId, totalCount, doneCount: 0 };
  return mutationOperation(base, mutation);
};

/** Accepts a background change only once worker recovery can finish it. */
export const startFolderOperation = async ({
  ownerUserId,
  run,
}: {
  ownerUserId: string;
  run: (
    onPrepared: (mutationId: string) => void,
  ) => Promise<FolderMutationResult>;
}) => {
  const mutationId = await new Promise<string>((resolve, reject) => {
    void run(resolve).then(
      () => reject(new Error("The folder change did not prepare a journal.")),
      reject,
    );
  });
  const operation = await readFolderOperation(mutationId, ownerUserId);
  if (!operation) throw new Error("The folder change journal is unavailable.");
  return operation;
};
