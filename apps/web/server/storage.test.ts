import path from "node:path";

import { describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "@staaash/config";

import {
  getActiveCommittedStorageKey,
  getActiveFolderStorageKey,
  getPendingDeleteBlobPath,
  getPendingDeleteManifestPath,
  getPreviewStorageKey,
  getStorageLockPath,
  getTrashedCommittedStorageKey,
  getTrashedFolderStorageKey,
  getUserLibraryRootStorageKey,
  getUserTrashRootStorageKey,
} from "@/server/storage";

describe("storage layout", () => {
  it("stores committed originals under the visible library tree", () => {
    expect(
      getActiveCommittedStorageKey({
        username: "johnsmith",
        folderPathSegments: ["Photos", "Trips", "Paris"],
        fileName: "my-photo.jpg",
      }),
    ).toBe("library/johnsmith/Photos/Trips/Paris/my-photo.jpg");
  });

  it("stores trashed originals under the hidden trash tree", () => {
    expect(
      getTrashedCommittedStorageKey({
        username: "johnsmith",
        folderPathSegments: ["Photos", "Trips", "Paris"],
        fileName: "my-photo.jpg",
      }),
    ).toBe(".trash/johnsmith/Photos/Trips/Paris/my-photo.jpg");
  });

  it("builds active and hidden folder roots per username", () => {
    expect(getUserLibraryRootStorageKey("johnsmith")).toBe(
      "library/johnsmith",
    );
    expect(getUserTrashRootStorageKey("johnsmith")).toBe(".trash/johnsmith");
    expect(
      getActiveFolderStorageKey({
        username: "johnsmith",
        folderPathSegments: ["Photos", "Trips"],
      }),
    ).toBe("library/johnsmith/Photos/Trips");
    expect(
      getTrashedFolderStorageKey({
        username: "johnsmith",
        folderPathSegments: ["Photos", "Trips"],
      }),
    ).toBe(".trash/johnsmith/Photos/Trips");
  });

  it("keeps previews under the internal preview layout", () => {
    expect(getPreviewStorageKey("user-1", "file-1", "image")).toBe(
      "previews/user-1/file-1/image.preview",
    );
  });

  it("resolves the same default files root from web and worker package directories", () => {
    const webStartDir = process.cwd();
    const workerStartDir = path.resolve(process.cwd(), "..", "worker");

    expect(resolveWorkspacePath("./.data/files", webStartDir)).toBe(
      resolveWorkspacePath("./.data/files", workerStartDir),
    );
  });

  it("builds internal lock and pending-delete paths under tmp", () => {
    expect(getStorageLockPath("abc123")).toContain(`${path.sep}tmp${path.sep}locks${path.sep}`);
    expect(getPendingDeleteBlobPath("op-1")).toContain(
      `${path.sep}tmp${path.sep}pending-delete${path.sep}op-1.bin`,
    );
    expect(getPendingDeleteManifestPath("op-1")).toContain(
      `${path.sep}tmp${path.sep}pending-delete${path.sep}op-1.json`,
    );
  });
});
