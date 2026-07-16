import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/files/move/route";
import { getRequestSession } from "@/server/auth/guards";
import { FilesError } from "@/server/files/errors";
import { filesService } from "@/server/files/service";

vi.mock("@/server/auth/guards", () => ({
  getRequestSession: vi.fn(),
}));

vi.mock("@/server/files/service", () => ({
  filesService: {
    moveFile: vi.fn(),
    moveFolder: vi.fn(),
  },
}));

vi.mock("@/server/retrieval/recent-tracking", () => ({
  recordFileAccessBestEffort: vi.fn(),
  recordFolderAccessBestEffort: vi.fn(),
}));

const request = (body: unknown, origin = "http://localhost:3000") =>
  new NextRequest("http://localhost:3000/api/files/move", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
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
    vi.mocked(filesService.moveFile).mockResolvedValue({ file: undefined });
    vi.mocked(filesService.moveFolder).mockResolvedValue({
      folder: {} as never,
    });
  });

  it("moves mixed items and reports per-item success", async () => {
    const response = await POST(
      request({
        destinationFolderId: "folder-destination",
        items: [
          { id: "folder-1", kind: "folder" },
          { id: "file-1", kind: "file" },
        ],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      movedCount: 2,
      failedCount: 0,
      results: [
        { id: "folder-1", kind: "folder", status: "moved" },
        { id: "file-1", kind: "file", status: "moved" },
      ],
    });
    expect(filesService.moveFolder).toHaveBeenCalledWith({
      actorUserId: "user-1",
      actorRole: "owner",
      folderId: "folder-1",
      destinationFolderId: "folder-destination",
    });
    expect(filesService.moveFile).toHaveBeenCalledWith({
      actorUserId: "user-1",
      actorRole: "owner",
      fileId: "file-1",
      destinationFolderId: "folder-destination",
    });
  });

  it("keeps processing after an item fails", async () => {
    vi.mocked(filesService.moveFolder).mockRejectedValueOnce(
      new FilesError("FOLDER_MOVE_CYCLE"),
    );

    const response = await POST(
      request({
        destinationFolderId: "folder-destination",
        items: [
          { id: "folder-1", kind: "folder" },
          { id: "file-1", kind: "file" },
        ],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      movedCount: 1,
      failedCount: 1,
      results: [
        {
          id: "folder-1",
          kind: "folder",
          status: "failed",
          code: "FOLDER_MOVE_CYCLE",
          error:
            "A folder cannot be moved into itself or one of its descendants.",
        },
        { id: "file-1", kind: "file", status: "moved" },
      ],
    });
    expect(filesService.moveFile).toHaveBeenCalledOnce();
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
    expect(filesService.moveFile).not.toHaveBeenCalled();
  });
});
