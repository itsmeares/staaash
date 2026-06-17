import { describe, expect, it } from "vitest";

import {
  filterTrashItems,
  getTrashDateGroup,
  groupTrashItems,
  sortTrashItems,
  toTrashClientItem,
  toTrashClientItems,
  type TrashClientItem,
} from "@/app/(workspace)/trash/trash-helpers";
import type {
  FileSummary,
  FolderRestoreLocation,
  FolderSummary,
  TrashFileSummary,
  TrashFolderSummary,
  TrashListing,
} from "@/server/files/types";

const restoreLocation: FolderRestoreLocation = {
  folderId: "root",
  folderName: "Files",
  kind: "files-root",
  pathLabel: "Files",
};

const folderSummary = (
  overrides: Partial<FolderSummary> = {},
): FolderSummary => ({
  createdAt: new Date("2026-05-01T10:00:00.000Z"),
  deletedAt: new Date("2026-05-20T10:00:00.000Z"),
  id: "folder-1",
  isFilesRoot: false,
  name: "Archive",
  ownerUserId: "user-1",
  ownerStorageId: "ares",
  parentId: "root",
  updatedAt: new Date("2026-05-19T10:00:00.000Z"),
  ...overrides,
});

const fileSummary = (overrides: Partial<FileSummary> = {}): FileSummary => ({
  createdAt: new Date("2026-05-01T10:00:00.000Z"),
  deletedAt: new Date("2026-05-21T10:00:00.000Z"),
  folderId: "root",
  id: "file-1",
  mimeType: "application/pdf",
  name: "passport.pdf",
  ownerUserId: "user-1",
  ownerStorageId: "ares",
  sizeBytes: 2400000,
  updatedAt: new Date("2026-05-18T10:00:00.000Z"),
  viewerKind: null,
  ...overrides,
});

const trashFolder = (
  overrides: Partial<TrashFolderSummary> = {},
): TrashFolderSummary => ({
  folder: folderSummary(),
  originalPathLabel: "Files / Archive",
  restoreLocation,
  ...overrides,
});

const trashFile = (
  overrides: Partial<TrashFileSummary> = {},
): TrashFileSummary => ({
  file: fileSummary(),
  originalPathLabel: "Files / Identity / passport.pdf",
  restoreLocation,
  ...overrides,
});

const clientItem = (
  overrides: Partial<TrashClientItem> = {},
): TrashClientItem => ({
  deletedAt: "2026-05-21T10:00:00.000Z",
  id: "file-1",
  kind: "file",
  mimeType: "application/pdf",
  name: "passport.pdf",
  originalPathLabel: "Files / Identity / passport.pdf",
  restoreTargetLabel: "Files",
  sizeBytes: 2400000,
  ...overrides,
});

describe("trash page helpers", () => {
  it("serializes folder and file trash summaries", () => {
    expect(toTrashClientItem(trashFolder())).toMatchObject({
      deletedAt: "2026-05-20T10:00:00.000Z",
      id: "folder-1",
      kind: "folder",
      name: "Archive",
      originalPathLabel: "Files / Archive",
      restoreTargetLabel: "Files",
    });

    expect(toTrashClientItem(trashFile())).toMatchObject({
      deletedAt: "2026-05-21T10:00:00.000Z",
      id: "file-1",
      kind: "file",
      mimeType: "application/pdf",
      sizeBytes: 2400000,
    });
  });

  it("combines folders and files from a trash listing", () => {
    const listing: TrashListing = {
      filesRoot: folderSummary({
        id: "root",
        isFilesRoot: true,
        name: "Files",
      }),
      files: [trashFile()],
      items: [trashFolder()],
    };

    expect(toTrashClientItems(listing).map((item) => item.kind)).toEqual([
      "folder",
      "file",
    ]);
  });

  it("filters and sorts deleted items", () => {
    const items = [
      clientItem({ id: "new", name: "Zulu.pdf" }),
      clientItem({
        deletedAt: "2026-05-19T10:00:00.000Z",
        id: "old",
        name: "Alpha.pdf",
      }),
      clientItem({
        deletedAt: "2026-05-20T10:00:00.000Z",
        id: "folder",
        kind: "folder",
        mimeType: undefined,
        name: "Folder",
        sizeBytes: undefined,
      }),
    ];

    expect(filterTrashItems(items, "file").map((item) => item.id)).toEqual([
      "new",
      "old",
    ]);
    expect(sortTrashItems(items, "newest").map((item) => item.id)).toEqual([
      "new",
      "folder",
      "old",
    ]);
    expect(sortTrashItems(items, "oldest").map((item) => item.id)).toEqual([
      "old",
      "folder",
      "new",
    ]);
  });

  it("groups deleted items by deleted date and reverses for oldest first", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");
    const items = [
      clientItem({ id: "today", deletedAt: "2026-05-21T11:00:00.000Z" }),
      clientItem({
        id: "yesterday",
        deletedAt: "2026-05-20T11:00:00.000Z",
      }),
      clientItem({ id: "week", deletedAt: "2026-05-19T11:00:00.000Z" }),
      clientItem({ id: "month", deletedAt: "2026-05-01T11:00:00.000Z" }),
      clientItem({ id: "older", deletedAt: "2026-03-01T11:00:00.000Z" }),
    ];

    expect(
      groupTrashItems(items, "newest", now).map((group) => group.label),
    ).toEqual(["Today", "Yesterday", "This week", "This month", "Older"]);
    expect(
      groupTrashItems(items, "oldest", now).map((group) => group.label),
    ).toEqual(["Older", "This month", "This week", "Yesterday", "Today"]);
    expect(getTrashDateGroup("2026-05-21T00:10:00.000Z", now)).toBe("Today");
  });
});
