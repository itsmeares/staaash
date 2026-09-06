import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/files/move/route";
import { getRequestSession } from "@/server/auth/guards";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  hash: vi.fn(),
  listRecent: vi.fn(),
  fileFindMany: vi.fn(),
  folderFindMany: vi.fn(),
  folderFindFirst: vi.fn(),
}));

vi.mock("@/server/durable-storage-mutation", () => ({
  hashDurableStorageRequest: mocks.hash,
  prepareDurableStorageMutationParent: mocks.prepare,
}));

vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({
    file: { findMany: mocks.fileFindMany },
    folder: {
      findMany: mocks.folderFindMany,
      findFirst: mocks.folderFindFirst,
    },
  }),
}));

vi.mock("@staaash/db/storage-mutations", () => ({
  listRecentBatchMoveMutations: mocks.listRecent,
}));

vi.mock("@/server/auth/guards", () => ({
  getRequestSession: vi.fn(),
}));

const request = (body: unknown, origin = "http://localhost:3000") =>
  new NextRequest("http://localhost:3000/api/files/move", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": "move-request-1",
      host: "localhost:3000",
      origin,
    },
    body: JSON.stringify(body),
  });

describe("batch move route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRequestSession).mockResolvedValue({
      user: { id: "user-1", role: "owner" },
    } as Awaited<ReturnType<typeof getRequestSession>>);
    mocks.hash.mockImplementation((value: unknown) => JSON.stringify(value));
    mocks.fileFindMany.mockResolvedValue([
      { id: "file-1", storageRevision: 4 },
    ]);
    mocks.folderFindMany.mockResolvedValue([
      { id: "folder-1", storageRevision: 2 },
    ]);
    mocks.folderFindFirst.mockResolvedValue({
      id: "folder-destination",
      storageRevision: 7,
    });
    mocks.prepare.mockResolvedValue({
      mutation: {
        id: "batch-parent-1",
        kind: "batch_move",
        parentId: null,
        ownerUserId: "user-1",
        status: "prepared",
        resultJson: { children: [] },
      },
      replayed: false,
    });
  });

  it("queues a move and records the affected items", async () => {
    const response = await POST(
      request({
        destinationFolderId: "folder-destination",
        items: [
          { id: "folder-1", kind: "folder" },
          { id: "file-1", kind: "file" },
        ],
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      operationId: "batch-parent-1",
      status: "queued",
    });
    expect(response.headers.get("X-Storage-Mutation-Id")).toBe(
      "batch-parent-1",
    );
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "batch_move",
        ownerUserId: "user-1",
        resourceKeys: [],
        entities: [
          {
            entityType: "file",
            entityId: "file-1",
            preRevision: 4,
            postRevision: 4,
          },
          {
            entityType: "folder",
            entityId: "folder-1",
            preRevision: 2,
            postRevision: 2,
          },
          {
            entityType: "folder",
            entityId: "folder-destination",
            preRevision: 7,
            postRevision: 7,
          },
        ],
      }),
      { allowInProgress: true },
    );
  });

  it("lists only the signed-in owner's recoverable move state", async () => {
    mocks.listRecent.mockResolvedValue([
      {
        id: "batch-parent-1",
        kind: "batch_move",
        status: "running",
        intentJson: {
          items: [{ id: "file-1", kind: "file" }],
          destinationFolderId: "folder-destination",
        },
        resultJson: { children: [] },
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/files/move", {
        headers: {
          accept: "application/json",
          host: "localhost:3000",
          origin: "http://localhost:3000",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.listRecent).toHaveBeenCalledWith({
      ownerUserId: "user-1",
    });
    await expect(response.json()).resolves.toMatchObject([
      {
        operationId: "batch-parent-1",
        status: "running",
        items: [{ id: "file-1", kind: "file" }],
        destinationFolderId: "folder-destination",
      },
    ]);
  });

  it("guards nested folders and files during a folder move", async () => {
    mocks.folderFindMany.mockResolvedValue([
      {
        id: "folder-1",
        parentId: "folder-root",
        deletedAt: null,
        storageRevision: 2,
      },
      {
        id: "folder-child",
        parentId: "folder-1",
        deletedAt: null,
        storageRevision: 3,
      },
    ]);
    mocks.fileFindMany.mockResolvedValue([
      { id: "file-child", storageRevision: 5 },
    ]);

    await POST(
      request({
        destinationFolderId: "folder-destination",
        items: [{ id: "folder-1", kind: "folder" }],
      }),
    );

    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: expect.arrayContaining([
          {
            entityType: "file",
            entityId: "file-child",
            preRevision: 5,
            postRevision: 5,
          },
          {
            entityType: "folder",
            entityId: "folder-1",
            preRevision: 2,
            postRevision: 2,
          },
          {
            entityType: "folder",
            entityId: "folder-child",
            preRevision: 3,
            postRevision: 3,
          },
        ]),
      }),
      { allowInProgress: true },
    );
  });

  it("returns the saved result when the same move is replayed", async () => {
    mocks.prepare.mockResolvedValueOnce({
      mutation: {
        id: "batch-parent-1",
        kind: "batch_move",
        parentId: null,
        ownerUserId: "user-1",
        status: "succeeded",
        resultJson: {
          movedCount: 1,
          failedCount: 0,
          results: [{ id: "file-1", kind: "file", status: "moved" }],
        },
      },
      replayed: true,
    });

    const response = await POST(
      request({
        destinationFolderId: "folder-destination",
        items: [{ id: "file-1", kind: "file" }],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      operationId: "batch-parent-1",
      status: "succeeded",
      response: {
        movedCount: 1,
        failedCount: 0,
        results: [{ id: "file-1", kind: "file", status: "moved" }],
      },
    });
  });

  it("rejects malformed and cross-origin requests", async () => {
    const malformed = await POST(
      request({ destinationFolderId: "", items: [] }),
    );
    expect(malformed.status).toBe(400);

    const crossOrigin = await POST(
      request(
        {
          destinationFolderId: "folder-destination",
          items: [{ id: "file-1", kind: "file" }],
        },
        "https://evil.example",
      ),
    );
    expect(crossOrigin.status).toBe(403);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
