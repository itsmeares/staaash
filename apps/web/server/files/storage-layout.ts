import path from "node:path";

import {
  getActiveCommittedStorageKey,
  getActiveFolderStorageKey,
  getStoragePath,
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

const invalidSegmentCharacters = /[\u0000\\/<>\:"|?*]/;
export const maxFilesystemComponentBytes = 255;
// Linux PATH_MAX is 4096 bytes including the terminating NUL.
const maxFilesystemPathBytes = 4095;

export const takeUtf8Bytes = (value: string, maxBytes: number) => {
  let result = "";
  let usedBytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (usedBytes + characterBytes > maxBytes) break;
    result += character;
    usedBytes += characterBytes;
  }
  return result;
};

const truncateStorageComponentName = ({
  name,
  maxBytes,
  preserveExtension,
}: {
  name: string;
  maxBytes: number;
  preserveExtension: boolean;
}) => {
  if (Buffer.byteLength(name) <= maxBytes) return name;
  const extension = preserveExtension ? path.posix.extname(name) : "";
  const extensionBytes = Buffer.byteLength(extension);
  if (extension && extensionBytes < maxBytes) {
    return `${takeUtf8Bytes(name.slice(0, -extension.length), maxBytes - extensionBytes)}${extension}`;
  }
  return takeUtf8Bytes(name, maxBytes);
};

const segmentErrorCodes = {
  file: {
    required: "FILE_NAME_REQUIRED",
    invalidCharacter: "FILE_NAME_INVALID_CHARACTER",
    tooLong: "FILE_NAME_TOO_LONG",
    trailingSpaceOrDot: "FILE_NAME_TRAILING_SPACE_OR_DOT",
    reserved: "FILE_NAME_RESERVED",
  },
  folder: {
    required: "FOLDER_NAME_REQUIRED",
    invalidCharacter: "FOLDER_NAME_INVALID_CHARACTER",
    tooLong: "FOLDER_NAME_TOO_LONG",
    trailingSpaceOrDot: "FOLDER_NAME_TRAILING_SPACE_OR_DOT",
    reserved: "FOLDER_NAME_RESERVED",
  },
} as const;

const findSegmentError = (rawValue: string, value: string) => {
  if (value.length === 0) return "required";
  if (invalidSegmentCharacters.test(value)) return "invalidCharacter";
  // Filesystems limit a name component to 255 bytes, not characters.
  if (Buffer.byteLength(value) > maxFilesystemComponentBytes) return "tooLong";
  if (/[ .]$/.test(rawValue)) return "trailingSpaceOrDot";
  const reservedCandidate =
    value.split(".")[0]?.toUpperCase() ?? value.toUpperCase();
  if (reservedWindowsNames.has(reservedCandidate)) return "reserved";
  return null;
};

const validateSegment = (rawValue: string, kind: "file" | "folder") => {
  if (typeof rawValue !== "string") {
    throw new FilesError(segmentErrorCodes[kind].required);
  }
  const value = rawValue.trim();
  const error = findSegmentError(rawValue, value);
  if (error) throw new FilesError(segmentErrorCodes[kind][error]);
  return value;
};

export const assertStorageKeysFit = (storageKeys: Iterable<string>) => {
  for (const storageKey of storageKeys) {
    if (
      Buffer.byteLength(getStoragePath(storageKey)) > maxFilesystemPathBytes
    ) {
      throw new FilesError("STORAGE_PATH_TOO_LONG");
    }
  }
};

export const normalizeFolderName = (value: string) =>
  validateSegment(value, "folder");

export const normalizeFileName = (value: string) =>
  validateSegment(value, "file");

export const buildIsolatedTrashStorageKey = ({
  ownerStorageId,
  kind,
  name,
  deletedAt,
  trashEntryId,
}: {
  ownerStorageId: string;
  kind: "file" | "folder";
  name: string;
  deletedAt: Date;
  trashEntryId: string;
}) => {
  const timestamp = deletedAt
    .toISOString()
    .replace("T", " ")
    .replaceAll(":", "-")
    .replace("Z", " UTC");
  const collisionSuffix = ` (${BigInt(`0x${trashEntryId.replaceAll("-", "")}`)})`;
  const prefix = `${timestamp} - `;
  const safeName = truncateStorageComponentName({
    name,
    maxBytes:
      maxFilesystemComponentBytes -
      Buffer.byteLength(prefix) -
      Buffer.byteLength(collisionSuffix),
    preserveExtension: kind === "file",
  });
  return path.posix.join(
    ".trash",
    ownerStorageId,
    kind === "file" ? "files" : "folders",
    `${prefix}${safeName}${collisionSuffix}`,
  );
};

const buildFolderPathSegments = ({
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
        storageId: folder.ownerStorageId,
        folderPathSegments,
      })
    : getActiveFolderStorageKey({
        storageId: folder.ownerStorageId,
        folderPathSegments,
      });
};

export const buildFileStorageKey = ({
  file,
  folderMap,
  filesRoot,
  trashed,
}: {
  file: Pick<StoredFile, "ownerStorageId" | "folderId" | "name">;
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
        storageId: file.ownerStorageId,
        folderPathSegments,
        fileName: file.name,
      })
    : getActiveCommittedStorageKey({
        storageId: file.ownerStorageId,
        folderPathSegments,
        fileName: file.name,
      });
};
