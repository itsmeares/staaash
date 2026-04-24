import {
  getActiveCommittedStorageKey,
  getActiveFolderStorageKey,
  getTrashedCommittedStorageKey,
  getTrashedFolderStorageKey,
} from "@/server/storage";

import { FilesError } from "./errors";
import type { FolderSummary, StoredFile } from "./types";

const reservedWindowsNames = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
  ".",
  "..",
]);

const invalidSegmentCharacters = /[\\/<>\:"|?*]/;

const validateSegment = (rawValue: string, kind: "file" | "folder") => {
  const value = rawValue.trim();

  if (value.length === 0) {
    throw new FilesError(
      kind === "file" ? "FILE_NAME_REQUIRED" : "FOLDER_NAME_REQUIRED",
    );
  }

  if (invalidSegmentCharacters.test(value)) {
    throw new FilesError(
      kind === "file"
        ? "FILE_NAME_INVALID_CHARACTER"
        : "FOLDER_NAME_INVALID_CHARACTER",
    );
  }

  if (/[ .]$/.test(rawValue)) {
    throw new FilesError(
      kind === "file"
        ? "FILE_NAME_TRAILING_SPACE_OR_DOT"
        : "FOLDER_NAME_TRAILING_SPACE_OR_DOT",
    );
  }

  const reservedCandidate =
    value.split(".")[0]?.toUpperCase() ?? value.toUpperCase();

  if (reservedWindowsNames.has(reservedCandidate)) {
    throw new FilesError(
      kind === "file" ? "FILE_NAME_RESERVED" : "FOLDER_NAME_RESERVED",
    );
  }

  return value;
};

export const normalizeFolderName = (value: string) =>
  validateSegment(value, "folder");

export const normalizeFileName = (value: string) =>
  validateSegment(value, "file");

export const buildFolderPathSegments = ({
  folder,
  folderMap,
  filesRoot,
}: {
  folder: FolderSummary;
  folderMap: Map<string, FolderSummary>;
  filesRoot: FolderSummary;
}) => {
  if (folder.id === filesRoot.id) {
    return [];
  }

  const segments: string[] = [];
  const visited = new Set<string>();
  let current: FolderSummary | undefined = folder;

  while (current && !visited.has(current.id) && current.id !== filesRoot.id) {
    visited.add(current.id);
    segments.unshift(current.name);
    current = current.parentId ? folderMap.get(current.parentId) : undefined;
  }

  return segments;
};

export const buildFolderStorageKey = ({
  folder,
  folderMap,
  filesRoot,
  trashed,
}: {
  folder: FolderSummary;
  folderMap: Map<string, FolderSummary>;
  filesRoot: FolderSummary;
  trashed: boolean;
}) => {
  const folderPathSegments = buildFolderPathSegments({
    folder,
    folderMap,
    filesRoot,
  });

  return trashed
    ? getTrashedFolderStorageKey({
        username: folder.ownerUsername,
        folderPathSegments,
      })
    : getActiveFolderStorageKey({
        username: folder.ownerUsername,
        folderPathSegments,
      });
};

export const buildFileStorageKey = ({
  file,
  folderMap,
  filesRoot,
  trashed,
}: {
  file: Pick<StoredFile, "ownerUsername" | "folderId" | "name">;
  folderMap: Map<string, FolderSummary>;
  filesRoot: FolderSummary;
  trashed: boolean;
}) => {
  const parentFolder = file.folderId
    ? (folderMap.get(file.folderId) ?? filesRoot)
    : filesRoot;
  const folderPathSegments = buildFolderPathSegments({
    folder: parentFolder,
    folderMap,
    filesRoot,
  });

  return trashed
    ? getTrashedCommittedStorageKey({
        username: file.ownerUsername,
        folderPathSegments,
        fileName: file.name,
      })
    : getActiveCommittedStorageKey({
        username: file.ownerUsername,
        folderPathSegments,
        fileName: file.name,
      });
};
