import { describe, expect, it, vi } from "vitest";

const recordFileAccess = vi.fn();
const recordFolderAccess = vi.fn();

vi.mock("@/server/retrieval/service", () => ({
  retrievalService: {
    recordFileAccess,
    recordFolderAccess,
  },
}));

describe("recent-tracking best-effort helpers", () => {
  it("swallows a rejected file recent write and logs once", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    recordFileAccess.mockRejectedValueOnce(new Error("db down"));

    const { recordFileAccessBestEffort } =
      await import("@/server/retrieval/recent-tracking");

    await expect(
      recordFileAccessBestEffort({
        actorUserId: "user-1",
        actorRole: "member",
        fileId: "file-1",
        source: "test-source",
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("recent-tracking"),
      expect.objectContaining({
        source: "test-source",
        targetKind: "file",
        targetId: "file-1",
        actorUserId: "user-1",
      }),
    );

    consoleSpy.mockRestore();
  });

  it("swallows a rejected folder recent write and logs once", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    recordFolderAccess.mockRejectedValueOnce(new Error("network error"));

    const { recordFolderAccessBestEffort } =
      await import("@/server/retrieval/recent-tracking");

    await expect(
      recordFolderAccessBestEffort({
        actorUserId: "user-1",
        actorRole: "member",
        folderId: "folder-1",
        source: "test-folder-source",
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("recent-tracking"),
      expect.objectContaining({
        source: "test-folder-source",
        targetKind: "folder",
        targetId: "folder-1",
        actorUserId: "user-1",
      }),
    );

    consoleSpy.mockRestore();
  });

  it("resolves without logging when recent write succeeds", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    recordFileAccess.mockResolvedValueOnce(undefined);

    const { recordFileAccessBestEffort } =
      await import("@/server/retrieval/recent-tracking");

    await expect(
      recordFileAccessBestEffort({
        actorUserId: "user-1",
        actorRole: "member",
        fileId: "file-1",
        source: "test-source",
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
