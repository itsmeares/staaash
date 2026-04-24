import { describe, expect, it } from "vitest";

import {
  buildFileStorageKey,
  buildFolderStorageKey,
  normalizeFileName,
  normalizeFolderName,
} from "@/server/files/storage-layout";

import type { FolderSummary } from "./types";

const filesRoot: FolderSummary = {
  id: "root",
  ownerUserId: "user-1",
  ownerUsername: "johnsmith",
  parentId: null,
  name: "Files",
  isFilesRoot: true,
  deletedAt: null,
  createdAt: new Date("2026-03-31T12:00:00.000Z"),
  updatedAt: new Date("2026-03-31T12:00:00.000Z"),
};

const photosFolder: FolderSummary = {
  id: "photos",
  ownerUserId: "user-1",
  ownerUsername: "johnsmith",
  parentId: "root",
  name: "Photos",
  isFilesRoot: false,
  deletedAt: null,
  createdAt: new Date("2026-03-31T12:00:00.000Z"),
  updatedAt: new Date("2026-03-31T12:00:00.000Z"),
};

const tripsFolder: FolderSummary = {
  id: "trips",
  ownerUserId: "user-1",
  ownerUsername: "johnsmith",
  parentId: "photos",
  name: "Trips",
  isFilesRoot: false,
  deletedAt: null,
  createdAt: new Date("2026-03-31T12:00:00.000Z"),
  updatedAt: new Date("2026-03-31T12:00:00.000Z"),
};

const folderMap = new Map([
  [filesRoot.id, filesRoot],
  [photosFolder.id, photosFolder],
  [tripsFolder.id, tripsFolder],
]);

const expectFilesError = (callback: () => unknown, code: string) => {
  try {
    callback();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected FilesError ${code} to be thrown.`);
};

describe("files storage layout", () => {
  it("preserves exact valid file and folder names", () => {
    expect(normalizeFolderName("Photos")).toBe("Photos");
    expect(normalizeFileName("my-photo.jpg")).toBe("my-photo.jpg");
  });

  it("rejects invalid Windows path characters", () => {
    expectFilesError(
      () => normalizeFolderName("Trips:Paris"),
      "FOLDER_NAME_INVALID_CHARACTER",
    );
    expectFilesError(
      () => normalizeFileName("my?photo.jpg"),
      "FILE_NAME_INVALID_CHARACTER",
    );
  });

  it("rejects reserved Windows device names and trailing dots", () => {
    expectFilesError(() => normalizeFolderName("CON"), "FOLDER_NAME_RESERVED");
    expectFilesError(
      () => normalizeFileName("photo.jpg."),
      "FILE_NAME_TRAILING_SPACE_OR_DOT",
    );
  });

  it("builds visible active and hidden trash keys from folder ancestry", () => {
    expect(
      buildFolderStorageKey({
        folder: tripsFolder,
        folderMap,
        filesRoot,
        trashed: false,
      }),
    ).toBe("files/johnsmith/Photos/Trips");

    expect(
      buildFileStorageKey({
        file: {
          ownerUsername: "johnsmith",
          folderId: "trips",
          name: "my-photo.jpg",
        },
        folderMap,
        filesRoot,
        trashed: false,
      }),
    ).toBe("files/johnsmith/Photos/Trips/my-photo.jpg");

    expect(
      buildFileStorageKey({
        file: {
          ownerUsername: "johnsmith",
          folderId: "trips",
          name: "my-photo.jpg",
        },
        folderMap,
        filesRoot,
        trashed: true,
      }),
    ).toBe(".trash/johnsmith/Photos/Trips/my-photo.jpg");
  });
});
