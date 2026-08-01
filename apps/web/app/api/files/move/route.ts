import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { getRequestSession } from "@/server/auth/guards";
import {
  isSameOrigin,
  jsonErrorResponse,
  jsonNotSignedInResponse,
} from "@/server/auth/http";
import { filesService } from "@/server/files/service";
import type { BatchMoveResponse, BatchMoveResult } from "@/server/files/types";
import {
  recordFileAccessBestEffort,
  recordFolderAccessBestEffort,
} from "@/server/retrieval/recent-tracking";
import {
  attachStorageMutationHeader,
  readStorageIdempotencyKey,
} from "@/server/storage-idempotency";
import {
  hashDurableStorageRequest,
  prepareDurableStorageMutationParent,
} from "@/server/durable-storage-mutation";
import { getPrisma } from "@staaash/db/client";
import {
  completeStorageMutationParent,
  claimStorageMutation,
  recordStorageMutationParentChild,
  renewStorageMutationLease,
} from "@staaash/db/storage-mutations";

const requestSchema = z.object({
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
});

type BatchMoveItem = z.infer<typeof requestSchema>["items"][number];
type BatchMoveActor = Pick<
  Parameters<typeof filesService.moveFile>[0],
  "actorUserId" | "actorRole"
>;
type PreparedBatchMove = Awaited<
  ReturnType<typeof prepareDurableStorageMutationParent>
>;
type ClaimedBatchMove = NonNullable<
  Awaited<ReturnType<typeof claimStorageMutation>>
>;
type PriorBatchMoveChild = {
  ordinal: number;
  result: BatchMoveResult;
};

const EXPECTED_MOVE_FAILURE_CODES = new Set([
  "DESTINATION_FOLDER_NOT_FOUND",
  "FILE_NOT_FOUND",
  "FILE_MOVE_NOOP",
  "FILE_NAME_CONFLICT",
  "FOLDER_NOT_FOUND",
  "FOLDER_MOVE_NOOP",
  "FOLDER_MOVE_CYCLE",
  "FOLDER_NAME_CONFLICT",
]);

const normalizeMoveFailure = (
  item: BatchMoveItem,
  error: unknown,
): BatchMoveResult => {
  if (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return {
      ...item,
      status: "failed",
      code: (error as Error & { code: string }).code,
      error: error.message,
    };
  }

  return {
    ...item,
    status: "failed",
    code: "INTERNAL_ERROR",
    error: "Unexpected server error.",
  };
};

const getErrorCode = (error: unknown) =>
  error &&
  typeof error === "object" &&
  "code" in error &&
  typeof error.code === "string"
    ? error.code
    : null;

const isExpectedMoveFailure = (error: unknown) => {
  const code = getErrorCode(error);
  return code !== null && EXPECTED_MOVE_FAILURE_CODES.has(code);
};

const readPriorBatchMoveChildren = (
  resultJson: unknown,
): PriorBatchMoveChild[] => {
  if (
    !resultJson ||
    typeof resultJson !== "object" ||
    !Array.isArray((resultJson as { children?: unknown }).children)
  ) {
    return [];
  }
  return (resultJson as { children: PriorBatchMoveChild[] }).children;
};

const recordMovedItemAccess = (item: BatchMoveItem, actor: BatchMoveActor) => {
  if (item.kind === "folder") {
    void recordFolderAccessBestEffort({
      ...actor,
      folderId: item.id,
      source: "batch-move-route",
    });
    return;
  }
  void recordFileAccessBestEffort({
    ...actor,
    fileId: item.id,
    source: "batch-move-route",
  });
};

const moveBatchItem = async ({
  item,
  actor,
  destinationFolderId,
  idempotencyKey,
  parentId,
}: {
  item: BatchMoveItem;
  actor: BatchMoveActor;
  destinationFolderId: string;
  idempotencyKey: string;
  parentId: string;
}) => {
  if (item.kind === "folder") {
    await filesService.moveFolder({
      ...actor,
      folderId: item.id,
      destinationFolderId,
      idempotencyKey,
      storageMutationParentId: parentId,
    });
  } else {
    await filesService.moveFile({
      ...actor,
      fileId: item.id,
      destinationFolderId,
      idempotencyKey,
      storageMutationParentId: parentId,
    });
  }
  recordMovedItemAccess(item, actor);
};

const recordBatchMoveChild = async ({
  parent,
  claimedParent,
  leaseOwner,
  ordinal,
  result,
  childId,
}: {
  parent: PreparedBatchMove;
  claimedParent: ClaimedBatchMove;
  leaseOwner: string;
  ordinal: number;
  result: BatchMoveResult;
  childId: string | null;
}) =>
  recordStorageMutationParentChild({
    parentId: parent.mutation.id,
    childId,
    ordinal,
    result,
    leaseOwner,
    leaseToken: claimedParent.leaseToken,
  });

const executeBatchMoveItem = async ({
  item,
  ordinal,
  actor,
  destinationFolderId,
  parent,
  claimedParent,
  leaseOwner,
  idempotencyKey,
}: {
  item: BatchMoveItem;
  ordinal: number;
  actor: BatchMoveActor;
  destinationFolderId: string;
  parent: PreparedBatchMove;
  claimedParent: ClaimedBatchMove;
  leaseOwner: string;
  idempotencyKey: string;
}): Promise<BatchMoveResult> => {
  const childIdempotencyKey = `${idempotencyKey}:${ordinal}`;
  try {
    await moveBatchItem({
      item,
      actor,
      destinationFolderId,
      idempotencyKey: childIdempotencyKey,
      parentId: parent.mutation.id,
    });
    const result = { ...item, status: "moved" as const };
    const child = await getPrisma().storageMutation.findUnique({
      where: { idempotencyKey: childIdempotencyKey },
      select: { id: true },
    });
    await recordBatchMoveChild({
      parent,
      claimedParent,
      leaseOwner,
      ordinal,
      result,
      childId: child?.id ?? null,
    });
    return result;
  } catch (error) {
    if (!isExpectedMoveFailure(error)) throw error;
    const result = normalizeMoveFailure(item, error);
    await recordBatchMoveChild({
      parent,
      claimedParent,
      leaseOwner,
      ordinal,
      result,
      childId: null,
    });
    return result;
  }
};

const executeBatchMoveItems = async ({
  items,
  priorChildren,
  actor,
  destinationFolderId,
  parent,
  claimedParent,
  leaseOwner,
  idempotencyKey,
}: {
  items: BatchMoveItem[];
  priorChildren: PriorBatchMoveChild[];
  actor: BatchMoveActor;
  destinationFolderId: string;
  parent: PreparedBatchMove;
  claimedParent: ClaimedBatchMove;
  leaseOwner: string;
  idempotencyKey: string;
}) => {
  const results: BatchMoveResult[] = [];
  for (const [ordinal, item] of items.entries()) {
    await renewStorageMutationLease({
      id: claimedParent.id,
      leaseOwner,
      leaseToken: claimedParent.leaseToken,
    });
    const prior = priorChildren.find((child) => child.ordinal === ordinal);
    results.push(
      prior?.result ??
        (await executeBatchMoveItem({
          item,
          ordinal,
          actor,
          destinationFolderId,
          parent,
          claimedParent,
          leaseOwner,
          idempotencyKey,
        })),
    );
  }
  return results;
};

const buildBatchMoveResponse = (
  results: BatchMoveResult[],
): BatchMoveResponse => {
  const movedCount = results.filter(
    (result) => result.status === "moved",
  ).length;
  return {
    movedCount,
    failedCount: results.length - movedCount,
    results,
  };
};

const recoveringBatchMoveResponse = (mutationId: string) =>
  NextResponse.json(
    {
      error: "The batch move is in progress or being recovered.",
      code: "STORAGE_MUTATION_RECOVERING",
    },
    {
      status: 503,
      headers: { "X-Storage-Mutation-Id": mutationId },
    },
  );

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const session = await getRequestSession(request);
  if (!session) return jsonNotSignedInResponse();

  let idempotencyKey: string | null = null;
  try {
    const body = requestSchema.parse(await request.json());
    idempotencyKey = readStorageIdempotencyKey(request);
    const requestHash = hashDurableStorageRequest(body);
    const parent = await prepareDurableStorageMutationParent({
      kind: "batch_move",
      ownerUserId: session.user.id,
      idempotencyKey,
      requestHash,
      intentJson: {
        version: 1,
        destinationFolderId: body.destinationFolderId,
        items: body.items,
      },
    });
    if (parent.mutation.status === "succeeded") {
      return NextResponse.json(parent.mutation.resultJson, {
        headers: { "X-Storage-Mutation-Id": parent.mutation.id },
      });
    }
    const leaseOwner = `web-batch:${randomUUID()}`;
    const claimedParent = await claimStorageMutation({
      id: parent.mutation.id,
      leaseOwner,
    });
    if (!claimedParent) return recoveringBatchMoveResponse(parent.mutation.id);
    const results = await executeBatchMoveItems({
      items: body.items,
      priorChildren: readPriorBatchMoveChildren(parent.mutation.resultJson),
      actor: {
        actorUserId: session.user.id,
        actorRole: session.user.role,
      },
      destinationFolderId: body.destinationFolderId,
      parent,
      claimedParent,
      leaseOwner,
      idempotencyKey,
    });
    const response = buildBatchMoveResponse(results);

    await completeStorageMutationParent({
      parentId: parent.mutation.id,
      resultJson: response,
      leaseOwner,
      leaseToken: claimedParent.leaseToken,
    });
    return NextResponse.json(response, {
      headers: { "X-Storage-Mutation-Id": parent.mutation.id },
    });
  } catch (error) {
    return attachStorageMutationHeader(
      jsonErrorResponse(error),
      idempotencyKey ?? request.headers.get("Idempotency-Key"),
      session.user.id,
      error,
    );
  }
}
