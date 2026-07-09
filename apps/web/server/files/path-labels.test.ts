import { describe, expect, it } from "vitest";

import type { FileSummary, FolderSummary } from "./types";
import {
  buildFilePathLabel,
  buildFolderMap,
  buildFolderPathLabel,
} from "./path-labels";

const fixedNow = new Date("2026-07-09T12:00:00.000Z");

const makeFolder = (overrides: Partial<FolderSummary> = {}): FolderSummary => ({
  id: "folder-1",
  ownerUserId: "user-1",
  ownerStorageId: "owner",
  parentId: null,
  name: "Folder",
  isFilesRoot: false,
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
  ...overrides,
});

const makeFile = (overrides: Partial<FileSummary> = {}): FileSummary => ({
  id: "file-1",
  ownerUserId: "user-1",
  ownerStorageId: "owner",
  folderId: null,
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 1,
  viewerKind: null,
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
  ...overrides,
});

describe("file path labels", () => {
  it("builds labels from the files root through nested folders", () => {
    const filesRoot = makeFolder({
      id: "root",
      name: "Files",
      isFilesRoot: true,
    });
    const photos = makeFolder({
      id: "photos",
      name: "Photos",
      parentId: filesRoot.id,
    });
    const trips = makeFolder({
      id: "trips",
      name: "Trips",
      parentId: photos.id,
    });
    const folderMap = buildFolderMap([filesRoot, photos, trips]);

    expect(
      buildFolderPathLabel({
        folder: trips,
        folderMap,
        filesRoot,
      }),
    ).toBe("Files / Photos / Trips");
    expect(
      buildFilePathLabel({
        file: makeFile({ folderId: trips.id, name: "paris.jpg" }),
        folderMap,
        filesRoot,
      }),
    ).toBe("Files / Photos / Trips / paris.jpg");
  });

  it("falls back to the files root when a parent is absent", () => {
    const filesRoot = makeFolder({
      id: "root",
      name: "Files",
      isFilesRoot: true,
    });
    const orphan = makeFolder({
      id: "orphan",
      name: "Recovered",
      parentId: "missing",
    });

    expect(
      buildFolderPathLabel({
        folder: orphan,
        folderMap: buildFolderMap([filesRoot, orphan]),
        filesRoot,
      }),
    ).toBe("Files / Recovered");
  });

  it("terminates cyclic folder ancestry", () => {
    const filesRoot = makeFolder({
      id: "root",
      name: "Files",
      isFilesRoot: true,
    });
    const first = makeFolder({
      id: "first",
      name: "First",
      parentId: "second",
    });
    const second = makeFolder({
      id: "second",
      name: "Second",
      parentId: "first",
    });

    expect(
      buildFolderPathLabel({
        folder: first,
        folderMap: buildFolderMap([filesRoot, first, second]),
        filesRoot,
      }),
    ).toBe("Files / Second / First");
  });
});
