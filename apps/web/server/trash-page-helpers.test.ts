import { describe, expect, it } from "vite-plus/test";

import {
  daysLeft,
  daysLeftLabel,
  sortTrashItems,
  toTrashClientItem,
  toTrashClientItems,
  type TrashClientItem,
  type TrashSortKey,
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
  locationLabel: "Files / Identity / passport.pdf",
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
      locationLabel: "Files / Archive",
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
      total: 0,
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

    const ids = (key: TrashSortKey, direction: "asc" | "desc") =>
      sortTrashItems(items, key, direction).map((item) => item.id);
    expect(ids("deletedAt", "desc")).toEqual(["new", "folder", "old"]);
    expect(ids("deletedAt", "asc")).toEqual(["old", "folder", "new"]);
    expect(ids("name", "asc")).toEqual(["old", "folder", "new"]);
    expect(ids("size", "desc")).toEqual(["new", "old", "folder"]);
  });

  it("counts whole days left before trash is emptied", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");
    const left = (deletedAt: string) => daysLeft(deletedAt, 30, now, "UTC");
    // Just deleted: the full 30 days.
    expect(left("2026-05-21T11:00:00.000Z")).toBe(30);
    // Goes tomorrow morning, then later today.
    expect(left("2026-04-22T09:00:00.000Z")).toBe(1);
    expect(left("2026-04-21T23:00:00.000Z")).toBe(0);
    expect(left("2026-03-01T00:00:00.000Z")).toBe(0);
    expect([0, 1, 12].map(daysLeftLabel)).toEqual([
      "Today",
      "Tomorrow",
      "12 days",
    ]);
  });
});
