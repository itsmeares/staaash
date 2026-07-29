import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";

import { getRequestSession } from "@/server/auth/guards";
import {
  formErrorResponse,
  getSafeRedirectTarget,
  isSameOrigin,
  jsonErrorResponse,
  notSignedInResponse,
  readRequestBody,
  redirectWithMessage,
  wantsJson,
} from "@/server/auth/http";
import { filesService } from "@/server/files/service";
import {
  attachStorageMutationHeader,
  readStorageIdempotencyKey,
} from "@/server/storage-idempotency";
import { assertStorageMutationMayStart } from "@/server/durable-storage-mutation";
import {
  claimStorageMutation,
  completeStorageMutationParent,
  prepareStorageMutationParent,
} from "@staaash/db/storage-mutations";

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
  ReturnType<typeof prepareStorageMutationParent>
>;

const crossOriginResponse = (request: NextRequest) =>
  wantsJson(request)
    ? NextResponse.json(
        { error: "Cross-origin requests are not allowed." },
        { status: 403 },
      )
    : formErrorResponse(
        request,
        "/trash",
        new Error("Cross-origin requests are not allowed."),
      );

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
  prepareStorageMutationParent({
    kind: "clear_trash",
    ownerUserId: actor.actorUserId,
    idempotencyKey,
    requestHash: createHash("sha256")
      .update(JSON.stringify({ action: "clear_trash" }))
      .digest("hex"),
    intentJson: { version: 1, orderedItems },
  });

const recoveringClearTrashResponse = (mutationId: string) =>
  NextResponse.json(
    {
      error: "Clear trash is in progress or being recovered.",
      code: "STORAGE_MUTATION_RECOVERING",
    },
    {
      status: 503,
      headers: { "X-Storage-Mutation-Id": mutationId },
    },
  );

const clearTrashSuccessMessage = ({
  deletedFolderCount,
  deletedFileCount,
}: Awaited<ReturnType<typeof filesService.clearTrash>>) => {
  const folderLabel = `${deletedFolderCount} folder tree${
    deletedFolderCount === 1 ? "" : "s"
  }`;
  const fileLabel = `${deletedFileCount} file${
    deletedFileCount === 1 ? "" : "s"
  }`;
  return `Emptied trash. Removed ${folderLabel} and ${fileLabel}.`;
};

const clearTrashSuccessResponse = ({
  request,
  redirectTo,
  result,
  mutationId,
}: {
  request: NextRequest;
  redirectTo: string;
  result: Awaited<ReturnType<typeof filesService.clearTrash>>;
  mutationId: string;
}) => {
  const response = wantsJson(request)
    ? NextResponse.json(result, {
        headers: { "X-Storage-Mutation-Id": mutationId },
      })
    : redirectWithMessage(
        request,
        redirectTo,
        "success",
        clearTrashSuccessMessage(result),
      );
  response.headers.set("X-Storage-Mutation-Id", mutationId);
  return response;
};

const clearTrashErrorResponse = ({
  request,
  redirectTo,
  error,
}: {
  request: NextRequest;
  redirectTo: string;
  error: unknown;
}) =>
  wantsJson(request)
    ? jsonErrorResponse(error)
    : formErrorResponse(request, redirectTo, error);

const executePreparedClearTrash = async ({
  request,
  redirectTo,
  parent,
  actor,
  idempotencyKey,
  orderedItems,
}: {
  request: NextRequest;
  redirectTo: string;
  parent: PreparedClearTrash;
  actor: ClearTrashActor;
  idempotencyKey: string;
  orderedItems: ClearTrashOrderedItems;
}) => {
  if (parent.mutation.status === "succeeded") {
    return NextResponse.json(parent.mutation.resultJson, {
      headers: { "X-Storage-Mutation-Id": parent.mutation.id },
    });
  }
  const storedIntent = parent.mutation.intentJson as {
    orderedItems?: ClearTrashOrderedItems;
  };
  const leaseOwner = `web-clear-trash:${randomUUID()}`;
  const claimedParent = await claimStorageMutation({
    id: parent.mutation.id,
    leaseOwner,
  });
  if (!claimedParent) return recoveringClearTrashResponse(parent.mutation.id);
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
  return clearTrashSuccessResponse({
    request,
    redirectTo,
    result,
    mutationId: claimedParent.id,
  });
};

// Parent mutation routes intentionally share durable replay/error handling.
// fallow-ignore-next-line code-duplication
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return crossOriginResponse(request);
  }

  const body = await readRequestBody(request);
  const redirectTo = getSafeRedirectTarget(body.redirectTo, "/trash");
  const session = await getRequestSession(request);

  if (!session) {
    return notSignedInResponse(request, redirectTo);
  }

  let idempotencyKey: string | null = null;
  try {
    idempotencyKey = readStorageIdempotencyKey(request);
    await assertStorageMutationMayStart();
    const initialListing = await filesService.listTrashFolders({
      actorUserId: session.user.id,
      actorRole: session.user.role,
    });
    const orderedItems = buildClearTrashItems(initialListing);
    const actor = {
      actorUserId: session.user.id,
      actorRole: session.user.role,
    };
    const parent = await prepareClearTrash({
      actor,
      idempotencyKey,
      orderedItems,
    });
    return executePreparedClearTrash({
      request,
      redirectTo,
      parent,
      actor,
      idempotencyKey,
      orderedItems,
    });
  } catch (error) {
    return attachStorageMutationHeader(
      clearTrashErrorResponse({ request, redirectTo, error }),
      idempotencyKey ?? request.headers.get("Idempotency-Key"),
      session.user.id,
      error,
    );
  }
}
