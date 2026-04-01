import { describe, expect, it } from "vitest";

import {
  buildFileStorageKey,
  buildFolderStorageKey,
  normalizeFileName,
  normalizeFolderName,
} from "@/server/library/storage-layout";

import type { LibraryFolderSummary } from "./types";

const libraryRoot: LibraryFolderSummary = {
  id: "root",
  ownerUserId: "user-1",
  ownerUsername: "johnsmith",
  parentId: null,
  name: "Library",
  isLibraryRoot: true,
  deletedAt: null,
  createdAt: new Date("2026-03-31T12:00:00.000Z"),
  updatedAt: new Date("2026-03-31T12:00:00.000Z"),
};

const photosFolder: LibraryFolderSummary = {
  id: "photos",
  ownerUserId: "user-1",
  ownerUsername: "johnsmith",
  parentId: "root",
  name: "Photos",
  isLibraryRoot: false,
  deletedAt: null,
  createdAt: new Date("2026-03-31T12:00:00.000Z"),
  updatedAt: new Date("2026-03-31T12:00:00.000Z"),
};

const tripsFolder: LibraryFolderSummary = {
  id: "trips",
  ownerUserId: "user-1",
  ownerUsername: "johnsmith",
  parentId: "photos",
  name: "Trips",
  isLibraryRoot: false,
  deletedAt: null,
  createdAt: new Date("2026-03-31T12:00:00.000Z"),
  updatedAt: new Date("2026-03-31T12:00:00.000Z"),
};

const folderMap = new Map([
  [libraryRoot.id, libraryRoot],
  [photosFolder.id, photosFolder],
  [tripsFolder.id, tripsFolder],
]);

const expectLibraryError = (callback: () => unknown, code: string) => {
  try {
    callback();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected LibraryError ${code} to be thrown.`);
};

describe("library storage layout", () => {
  it("preserves exact valid file and folder names", () => {
    expect(normalizeFolderName("Photos")).toBe("Photos");
    expect(normalizeFileName("my-photo.jpg")).toBe("my-photo.jpg");
  });

  it("rejects invalid Windows path characters", () => {
    expectLibraryError(
      () => normalizeFolderName("Trips:Paris"),
      "FOLDER_NAME_INVALID_CHARACTER",
    );
    expectLibraryError(
      () => normalizeFileName("my?photo.jpg"),
      "FILE_NAME_INVALID_CHARACTER",
    );
  });

  it("rejects reserved Windows device names and trailing dots", () => {
    expectLibraryError(
      () => normalizeFolderName("CON"),
      "FOLDER_NAME_RESERVED",
    );
    expectLibraryError(
      () => normalizeFileName("photo.jpg."),
      "FILE_NAME_TRAILING_SPACE_OR_DOT",
    );
  });

  it("builds visible active and hidden trash keys from folder ancestry", () => {
    expect(
      buildFolderStorageKey({
        folder: tripsFolder,
        folderMap,
        libraryRoot,
        trashed: false,
      }),
    ).toBe("library/johnsmith/Photos/Trips");

    expect(
      buildFileStorageKey({
        file: {
          ownerUsername: "johnsmith",
          folderId: "trips",
          name: "my-photo.jpg",
        },
        folderMap,
        libraryRoot,
        trashed: false,
      }),
    ).toBe("library/johnsmith/Photos/Trips/my-photo.jpg");

    expect(
      buildFileStorageKey({
        file: {
          ownerUsername: "johnsmith",
          folderId: "trips",
          name: "my-photo.jpg",
        },
        folderMap,
        libraryRoot,
        trashed: true,
      }),
    ).toBe(".trash/johnsmith/Photos/Trips/my-photo.jpg");
  });
});
