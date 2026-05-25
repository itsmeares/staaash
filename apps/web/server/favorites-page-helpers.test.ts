import { describe, expect, it } from "vitest";

import {
  filterFavoriteItems,
  formatFavoriteFileSize,
  formatFavoriteRelativeTime,
  getFavoriteLocationLabel,
  getFavoriteType,
  getQuickAccessFavorites,
  sortFavoriteItems,
  toFavoriteClientItem,
  type FavoriteClientItem,
} from "@/app/(workspace)/favorites/favorites-helpers";
import type { FavoriteRetrievalItem } from "@/server/retrieval/types";

const makeFile = (
  overrides: Partial<Extract<FavoriteRetrievalItem, { kind: "file" }>> = {},
): Extract<FavoriteRetrievalItem, { kind: "file" }> => ({
  favoritedAt: new Date("2026-05-19T12:00:00.000Z"),
  folderId: "folder-1",
  href: "/files/view/file-1",
  id: "file-1",
  isFavorite: true,
  kind: "file",
  mimeType: "image/png",
  name: "hero.png",
  pathLabel: "Files / Design / hero.png",
  quickAccessPinnedAt: null,
  sizeBytes: 2400000,
  updatedAt: new Date("2026-05-19T10:00:00.000Z"),
  deletedAt: null,
  ...overrides,
});

const makeFolder = (
  overrides: Partial<Extract<FavoriteRetrievalItem, { kind: "folder" }>> = {},
): Extract<FavoriteRetrievalItem, { kind: "folder" }> => ({
  favoritedAt: new Date("2026-05-18T12:00:00.000Z"),
  href: "/files/f/folder-1",
  id: "folder-1",
  isFavorite: true,
  kind: "folder",
  name: "Design",
  parentId: "root",
  pathLabel: "Files / Design",
  quickAccessPinnedAt: null,
  updatedAt: new Date("2026-05-19T09:00:00.000Z"),
  deletedAt: null,
  ...overrides,
});

const clientItem = (
  overrides: Partial<FavoriteClientItem> = {},
): FavoriteClientItem => ({
  favoritedAt: "2026-05-19T12:00:00.000Z",
  href: "/files/view/file-1",
  id: "file-1",
  kind: "file",
  locationLabel: "Design",
  mimeType: "image/png",
  name: "hero.png",
  quickAccessPinnedAt: null,
  sizeBytes: 2400000,
  ...overrides,
});

describe("favorites page helpers", () => {
  it("serializes retrieval items with favorite time and compact location", () => {
    expect(getFavoriteLocationLabel(makeFile())).toBe("Design");
    expect(getFavoriteLocationLabel(makeFolder())).toBe("/");

    expect(
      toFavoriteClientItem(
        makeFile({
          favoritedAt: new Date("2026-05-20T11:30:00.000Z"),
          mimeType: "application/pdf",
          name: "Q1.pdf",
          pathLabel: "Files / Client / Reports / Q1.pdf",
          quickAccessPinnedAt: new Date("2026-05-20T11:45:00.000Z"),
        }),
      ),
    ).toMatchObject({
      favoritedAt: "2026-05-20T11:30:00.000Z",
      kind: "file",
      locationLabel: "Client / Reports",
      mimeType: "application/pdf",
      quickAccessPinnedAt: "2026-05-20T11:45:00.000Z",
    });
  });

  it("maps file and folder types for filters", () => {
    expect(
      getFavoriteType(clientItem({ kind: "folder", mimeType: undefined })),
    ).toBe("folder");
    expect(getFavoriteType(clientItem({ mimeType: "image/png" }))).toBe(
      "image",
    );
    expect(getFavoriteType(clientItem({ mimeType: "video/mp4" }))).toBe(
      "video",
    );
    expect(getFavoriteType(clientItem({ mimeType: "audio/wav" }))).toBe(
      "audio",
    );
    expect(getFavoriteType(clientItem({ mimeType: "application/pdf" }))).toBe(
      "pdf",
    );
    expect(getFavoriteType(clientItem({ mimeType: "text/markdown" }))).toBe(
      "text",
    );
    expect(getFavoriteType(clientItem({ mimeType: "application/zip" }))).toBe(
      "archive",
    );
    expect(
      getFavoriteType(clientItem({ mimeType: "application/octet-stream" })),
    ).toBe("all");
  });

  it("filters, sorts, and picks quick access favorites", () => {
    const items = [
      clientItem({
        favoritedAt: "2026-05-19T09:00:00.000Z",
        id: "b",
        mimeType: "video/mp4",
        name: "Beta.mov",
        quickAccessPinnedAt: "2026-05-20T10:00:00.000Z",
        sizeBytes: 20,
      }),
      clientItem({
        favoritedAt: "2026-05-19T12:00:00.000Z",
        id: "a",
        mimeType: "image/png",
        name: "Alpha.png",
        sizeBytes: 10,
      }),
      clientItem({
        favoritedAt: "2026-05-18T12:00:00.000Z",
        id: "c",
        kind: "folder",
        locationLabel: "/",
        mimeType: undefined,
        name: "Client",
        quickAccessPinnedAt: "2026-05-20T09:00:00.000Z",
        sizeBytes: undefined,
      }),
      clientItem({
        favoritedAt: "2026-05-17T12:00:00.000Z",
        id: "d",
        mimeType: "application/pdf",
        name: "Deck.pdf",
        sizeBytes: 30,
      }),
    ];

    expect(filterFavoriteItems(items, "image").map((item) => item.id)).toEqual([
      "a",
    ]);
    expect(
      sortFavoriteItems(items, "name", "asc").map((item) => item.id),
    ).toEqual(["a", "b", "c", "d"]);
    expect(
      sortFavoriteItems(items, "size", "desc").map((item) => item.id),
    ).toEqual(["d", "b", "a", "c"]);
    expect(getQuickAccessFavorites(items).map((item) => item.id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("formats size and relative favorite time labels", () => {
    const now = new Date("2026-05-19T12:00:00.000Z");

    expect(formatFavoriteFileSize(undefined)).toBe("-");
    expect(formatFavoriteFileSize(400)).toBe("400 B");
    expect(formatFavoriteFileSize(4200)).toBe("4 KB");
    expect(formatFavoriteFileSize(2_400_000)).toBe("2.3 MB");
    expect(formatFavoriteFileSize(4_500_000_000)).toBe("4.2 GB");

    expect(formatFavoriteRelativeTime("2026-05-19T12:00:00.000Z", now)).toBe(
      "Just now",
    );
    expect(formatFavoriteRelativeTime("2026-05-19T11:55:00.000Z", now)).toBe(
      "5m ago",
    );
    expect(formatFavoriteRelativeTime("2026-05-19T10:00:00.000Z", now)).toBe(
      "2h ago",
    );
    expect(formatFavoriteRelativeTime("2026-05-18T10:00:00.000Z", now)).toBe(
      "Yesterday",
    );
  });
});
