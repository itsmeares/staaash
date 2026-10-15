import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  selection: vi.fn(),
  archive: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("@/server/auth/guards", () => ({ getRequestSession: mocks.session }));
vi.mock("@/server/files/repository", () => ({
  findArchiveSelectionItems: mocks.selection,
}));
vi.mock("@/server/settings", () => ({
  getSystemSettings: async () => ({ zipArchiveRetentionDays: 7 }),
}));
vi.mock("@staaash/db/jobs", () => ({
  scheduleZipArchiveGenerate: mocks.schedule,
}));
vi.mock("@staaash/db/zip-archives", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@staaash/db/zip-archives")>()),
  findOrCreateZipArchive: mocks.archive,
}));

const { POST } = await import("@/app/api/files/archives/route");
const item = (
  id: string,
  ownerUserId = "alice",
  deletedAt: Date | null = null,
) => ({ id, ownerUserId, deletedAt });
const request = (ids: string[]) =>
  POST(
    new NextRequest("http://localhost/api/files/archives", {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "alice", role: "member" } });
  mocks.selection.mockResolvedValue({ files: [], folders: [] });
  mocks.archive.mockResolvedValue({
    archive: { id: "zip", status: "queued" },
    created: true,
  });
});

describe("archive selection", () => {
  it("matches unordered query results by ID and retains duplicate selections", async () => {
    mocks.selection.mockResolvedValue({
      files: [item("b"), item("a")],
      folders: [item("folder")],
    });
    const response = await request(["a", "folder", "b", "a"]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      archiveId: "zip",
      status: "queued",
    });
    expect(mocks.archive).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "alice",
        idsJson: { fileIds: ["a", "b", "a"], folderIds: ["folder"] },
      }),
    );
    expect(mocks.schedule).toHaveBeenCalledWith({ archiveId: "zip" });
  });

  it.each(["owner", "admin", "member"])(
    "denies another user's file or folder to a %s",
    async (role) => {
      mocks.session.mockResolvedValue({ user: { id: "alice", role } });
      for (const kind of ["files", "folders"]) {
        mocks.selection.mockResolvedValue({
          files: [item("own")],
          folders: [],
          [kind]: [item("foreign", "bob")],
        });
        const response = await request(["foreign"]);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: "ACCESS_DENIED" });
      }
      expect(mocks.archive).not.toHaveBeenCalled();
      expect(mocks.schedule).not.toHaveBeenCalled();
    },
  );

  it.each(["missing", "deleted-file", "deleted-folder"])(
    "rejects the entire selection for a %s",
    async (kind) => {
      mocks.selection.mockResolvedValue({
        files: [
          item("own"),
          ...(kind === "deleted-file"
            ? [item("bad", "alice", new Date())]
            : []),
        ],
        folders:
          kind === "deleted-folder" ? [item("bad", "alice", new Date())] : [],
      });
      const response = await request(["own", "bad"]);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "FILE_NOT_FOUND" });
      expect(mocks.archive).not.toHaveBeenCalled();
      expect(mocks.schedule).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "preserves file/folder ID precedence when the file is deleted: %s",
    async (deleted) => {
      mocks.selection.mockResolvedValue({
        files: [item("same", "alice", deleted ? new Date() : null)],
        folders: [item("same")],
      });
      expect((await request(["same"])).status).toBe(200);
      expect(mocks.archive).toHaveBeenCalledWith(
        expect.objectContaining({
          idsJson: {
            fileIds: deleted ? [] : ["same"],
            folderIds: deleted ? ["same"] : [],
          },
        }),
      );
    },
  );
});
