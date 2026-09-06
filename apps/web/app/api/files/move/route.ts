import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRequestSession } from "@/server/auth/guards";
import {
  isSameOrigin,
  jsonErrorResponse,
  jsonNotSignedInResponse,
} from "@/server/auth/http";
import { toBatchMoveOperationResponse } from "@/server/files/move-operation";
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
  listRecentBatchMoveMutations,
  type StorageMutationEntityInput,
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
  source: z.enum(["direct", "paste"]).default("direct"),
});

type BatchMoveRequest = z.infer<typeof requestSchema>;

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
  const [folders, destination] = await Promise.all([
    folderIds.length > 0
      ? getPrisma().folder.findMany({
          where: { ownerUserId },
          select: {
            id: true,
            parentId: true,
            deletedAt: true,
            storageRevision: true,
          },
        })
      : Promise.resolve([]),
    getPrisma().folder.findFirst({
      where: { id: request.destinationFolderId, ownerUserId },
      select: { id: true, storageRevision: true },
    }),
  ]);
  const childrenByParent = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.deletedAt) continue;
    const children = childrenByParent.get(folder.parentId ?? "") ?? [];
    children.push(folder.id);
    childrenByParent.set(folder.parentId ?? "", children);
  }
  const guardedFolderIds = new Set(folderIds);
  const pendingFolderIds = [...folderIds];
  while (pendingFolderIds.length > 0) {
    const parentId = pendingFolderIds.shift()!;
    for (const childId of childrenByParent.get(parentId) ?? []) {
      if (guardedFolderIds.has(childId)) continue;
      guardedFolderIds.add(childId);
      pendingFolderIds.push(childId);
    }
  }
  const files = await getPrisma().file.findMany({
    where: {
      ownerUserId,
      OR: [
        ...(fileIds.length > 0 ? [{ id: { in: fileIds } }] : []),
        ...(guardedFolderIds.size > 0
          ? [{ folderId: { in: [...guardedFolderIds] } }]
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
  for (const folder of folders) {
    if (guardedFolderIds.has(folder.id)) add("folder", folder);
  }
  if (destination) add("folder", destination);
  return [...entities.values()];
};

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
    const parent = await prepareDurableStorageMutationParent(
      {
        kind: "batch_move",
        ownerUserId: session.user.id,
        idempotencyKey,
        requestHash: hashDurableStorageRequest(body),
        intentJson: {
          version: 1,
          destinationFolderId: body.destinationFolderId,
          items: body.items,
          source: body.source,
        },
        resourceKeys: [],
        entities: await buildMoveGuardEntities(session.user.id, body),
      },
      { allowInProgress: true },
    );
    const response = toBatchMoveOperationResponse(parent.mutation);
    return NextResponse.json(response, {
      status:
        response.status === "queued" || response.status === "running"
          ? 202
          : 200,
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

export async function GET(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const session = await getRequestSession(request);
  if (!session) return jsonNotSignedInResponse();

  const mutations = await listRecentBatchMoveMutations({
    ownerUserId: session.user.id,
  });
  const operations = mutations
    .map(toBatchMoveOperationResponse)
    .filter(
      (operation) =>
        operation.status !== "succeeded" ||
        (operation.response?.failedCount ?? 0) > 0,
    );
  return NextResponse.json(operations, {
    headers: { "Cache-Control": "no-store" },
  });
}
