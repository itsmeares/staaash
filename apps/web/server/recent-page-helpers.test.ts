import { describe, expect, it } from "vitest";

import {
  filterRecentItems,
  formatRecentFileSize,
  formatRecentRelativeTime,
  getRecentDateGroup,
  getRecentLocationLabel,
  getRecentType,
  groupRecentItems,
  sortRecentItems,
  toRecentClientItem,
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
  uploadedAt: "2026-05-19T10:00:00.000Z",
  deletedAt: null,
  ...overrides,
});

describe("recent page helpers", () => {
  it("serializes retrieval items with compact location labels", () => {
    expect(getRecentLocationLabel(makeFile())).toBe("Design");
    expect(getRecentLocationLabel(makeFolder())).toBe("/");

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
      uploadedAt: "2026-05-19T10:00:00.000Z",
    });
  });

  it("maps file and folder types for filters", () => {
    expect(
      getRecentType(clientItem({ kind: "folder", mimeType: undefined })),
    ).toBe("folder");
    expect(getRecentType(clientItem({ mimeType: "image/png" }))).toBe("image");
    expect(getRecentType(clientItem({ mimeType: "video/mp4" }))).toBe("video");
    expect(getRecentType(clientItem({ mimeType: "audio/wav" }))).toBe("audio");
    expect(getRecentType(clientItem({ mimeType: "application/pdf" }))).toBe(
      "pdf",
    );
    expect(getRecentType(clientItem({ mimeType: "text/markdown" }))).toBe(
      "text",
    );
    expect(getRecentType(clientItem({ mimeType: "application/zip" }))).toBe(
      "archive",
    );
    expect(
      getRecentType(clientItem({ mimeType: "application/octet-stream" })),
    ).toBe("all");
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

  it("groups recent items into date buckets", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");
    const grouped = groupRecentItems(
      [
        clientItem({ id: "today", uploadedAt: "2026-05-21T11:00:00.000Z" }),
        clientItem({
          id: "yesterday",
          uploadedAt: "2026-05-20T11:00:00.000Z",
        }),
        clientItem({ id: "week", uploadedAt: "2026-05-19T11:00:00.000Z" }),
        clientItem({ id: "month", uploadedAt: "2026-05-01T11:00:00.000Z" }),
        clientItem({ id: "older", uploadedAt: "2026-03-01T11:00:00.000Z" }),
      ],
      now,
    );

    expect(grouped.map((group) => group.label)).toEqual([
      "Today",
      "Yesterday",
      "This week",
      "This month",
      "Older",
    ]);
    expect(getRecentDateGroup("2026-05-21T00:10:00.000Z", now)).toBe("Today");
  });

  it("formats size and relative time labels", () => {
    const now = new Date("2026-05-19T12:00:00.000Z");

    expect(formatRecentFileSize(undefined)).toBe("-");
    expect(formatRecentFileSize(400)).toBe("400 B");
    expect(formatRecentFileSize(4200)).toBe("4 KB");
    expect(formatRecentFileSize(2_400_000)).toBe("2.3 MB");
    expect(formatRecentFileSize(4_500_000_000)).toBe("4.2 GB");

    expect(formatRecentRelativeTime("2026-05-19T12:00:00.000Z", now)).toBe(
      "Just now",
    );
    expect(formatRecentRelativeTime("2026-05-19T11:55:00.000Z", now)).toBe(
      "5m ago",
    );
    expect(formatRecentRelativeTime("2026-05-19T10:00:00.000Z", now)).toBe(
      "2h ago",
    );
    expect(formatRecentRelativeTime("2026-05-18T10:00:00.000Z", now)).toBe(
      "Yesterday",
    );
  });
});
