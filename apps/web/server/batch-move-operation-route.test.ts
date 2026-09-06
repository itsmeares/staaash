import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/files/move/[mutationId]/route";
import { getRequestSession } from "@/server/auth/guards";

const mocks = vi.hoisted(() => ({
  findStorageMutation: vi.fn(),
}));

vi.mock("@staaash/db/storage-mutations", () => ({
  findStorageMutation: mocks.findStorageMutation,
}));

vi.mock("@/server/auth/guards", () => ({
  getRequestSession: vi.fn(),
}));

const request = (origin = "http://localhost:3000") =>
  new NextRequest("http://localhost:3000/api/files/move/move-parent-1", {
    headers: {
      accept: "application/json",
      host: "localhost:3000",
      origin,
    },
  });

describe("batch move operation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRequestSession).mockResolvedValue({
      user: { id: "user-1", role: "owner" },
    } as Awaited<ReturnType<typeof getRequestSession>>);
    mocks.findStorageMutation.mockResolvedValue({
      id: "move-parent-1",
      kind: "batch_move",
      parentId: null,
      ownerUserId: "user-1",
      status: "running",
      resultJson: { children: [] },
    });
  });

  it("returns the current operation status without caching it", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ mutationId: "move-parent-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      operationId: "move-parent-1",
      status: "running",
    });
  });

  it("does not expose another user's move", async () => {
    mocks.findStorageMutation.mockResolvedValueOnce({
      id: "move-parent-1",
      kind: "batch_move",
      parentId: null,
      ownerUserId: "user-2",
      status: "running",
      resultJson: { children: [] },
    });

    const response = await GET(request(), {
      params: Promise.resolve({ mutationId: "move-parent-1" }),
    });

    expect(response.status).toBe(404);
  });
});
