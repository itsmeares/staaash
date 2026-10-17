import { describe, expect, it } from "vite-plus/test";

import {
  toRecentClientItem,
  filterRecentItems,
  batchActivity,
  batchLabel,
  sortRecentItems,
  type RecentClientItem,
} from "@/app/(workspace)/recent/recent-helpers";
import type { RetrievalItem } from "@/server/retrieval/types";

const makeFile = (
  overrides: Partial<Extract<RetrievalItem, { kind: "file" }>> = {},
): Extract<RetrievalItem, { kind: "file" }> => ({
  folderId: "folder-1",
  href: "/files/view/file-1",
  id: "file-1",
  isFavorite: false,
  kind: "file",
  mimeType: "image/png",
  name: "hero.png",
  pathLabel: "Files / Design / hero.png",
  sizeBytes: 2400000,
  updatedAt: new Date("2026-05-19T10:00:00.000Z"),
  deletedAt: null,
  ...overrides,
});

const makeFolder = (
  overrides: Partial<Extract<RetrievalItem, { kind: "folder" }>> = {},
): Extract<RetrievalItem, { kind: "folder" }> => ({
  href: "/files/f/folder-1",
  id: "folder-1",
  isFavorite: false,
  kind: "folder",
  name: "Design",
  parentId: "root",
  pathLabel: "Files / Design",
  updatedAt: new Date("2026-05-19T09:00:00.000Z"),
  deletedAt: null,
  ...overrides,
});

const clientItem = (
  overrides: Partial<RecentClientItem> = {},
): RecentClientItem => ({
  href: "/files/view/file-1",
  id: "file-1",
  isFavorite: false,
  kind: "file",
  locationLabel: "Design",
  mimeType: "image/png",
  name: "hero.png",
  sizeBytes: 2400000,
  at: "2026-05-19T10:00:00.000Z",
  deletedAt: null,
  ...overrides,
});

describe("recent page helpers", () => {
  it("serializes retrieval items with compact location labels", () => {
    expect(toRecentClientItem(makeFile()).locationLabel).toBe("Design");
    expect(toRecentClientItem(makeFolder()).locationLabel).toBe("Files");

    expect(
      toRecentClientItem(
        makeFile({
          deletedAt: new Date("2026-05-20T08:00:00.000Z"),
          pathLabel: "Files / Client / Reports / Q1.pdf",
          name: "Q1.pdf",
          mimeType: "application/pdf",
        }),
      ),
    ).toMatchObject({
      kind: "file",
      deletedAt: "2026-05-20T08:00:00.000Z",
      locationLabel: "Client / Reports",
      mimeType: "application/pdf",
      at: "2026-05-19T10:00:00.000Z",
    });
  });

  it("filters and sorts recent items", () => {
    const items = [
      clientItem({
        id: "b",
        name: "Beta.mov",
        mimeType: "video/mp4",
        sizeBytes: 20,
      }),
      clientItem({
        id: "a",
        name: "Alpha.png",
        mimeType: "image/png",
        sizeBytes: 10,
      }),
      clientItem({
        id: "c",
        kind: "folder",
        locationLabel: "/",
        mimeType: undefined,
        name: "Client",
        sizeBytes: undefined,
      }),
    ];

    expect(filterRecentItems(items, "image").map((item) => item.id)).toEqual([
      "a",
    ]);
    expect(
      sortRecentItems(items, "name", "asc").map((item) => item.id),
    ).toEqual(["a", "b", "c"]);
    expect(
      sortRecentItems(items, "size", "desc").map((item) => item.id),
    ).toEqual(["b", "a", "c"]);
  });

  it("folds bursts of uploads into one folder into one row", () => {
    const upload = (id: string, at: string, folderId = "photos") =>
      clientItem({
        id,
        at,
        folderId,
        lastAction: "uploaded",
        locationLabel: "Photos / Lisbon",
        mimeType: "image/jpeg",
      });
    const rows = batchActivity([
      clientItem({
        id: "opened",
        at: "2026-05-21T11:30:00.000Z",
        lastAction: "opened",
      }),
      upload("p1", "2026-05-21T11:00:00.000Z"),
      upload("p2", "2026-05-21T10:58:00.000Z"),
      upload("p3", "2026-05-21T10:55:00.000Z"),
      upload("p4", "2026-05-21T10:50:00.000Z"),
      // An hour later than the burst: its own row.
      upload("late", "2026-05-21T09:00:00.000Z"),
      // Three into another folder are not enough for a batch.
      upload("o1", "2026-05-21T08:00:00.000Z", "other"),
      upload("o2", "2026-05-21T07:59:00.000Z", "other"),
      upload("o3", "2026-05-21T07:58:00.000Z", "other"),
    ]);

    expect(rows.map((row) => row.id)).toEqual([
      "opened",
      "batch:p1",
      "late",
      "o1",
      "o2",
      "o3",
    ]);
    expect(rows[1]?.batch?.map((item) => item.id)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
    expect(batchLabel(rows[1]!)).toBe("Uploaded 4 photos to Lisbon");
  });
});
