import { describe, expect, it } from "vite-plus/test";

import {
  toFavoriteClientItem,
  filterFavoriteItems,
  pinnedFavorites,
  sortFavoriteItems,
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
    expect(toFavoriteClientItem(makeFile()).locationLabel).toBe("Design");
    expect(toFavoriteClientItem(makeFolder()).locationLabel).toBe("Files");

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
    expect(pinnedFavorites(items).map((item) => item.id)).toEqual(["b", "c"]);
  });
});
