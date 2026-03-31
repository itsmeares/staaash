export type LibraryErrorCode =
  | "ACCESS_DENIED"
  | "FOLDER_ALREADY_ACTIVE"
  | "FOLDER_MOVE_CYCLE"
  | "FOLDER_NAME_INVALID"
  | "FOLDER_NAME_REQUIRED"
  | "FOLDER_NOT_FOUND"
  | "FOLDER_ROOT_IMMUTABLE";

const libraryErrorMessages: Record<LibraryErrorCode, string> = {
  ACCESS_DENIED: "You do not have access to that folder.",
  FOLDER_ALREADY_ACTIVE: "That folder is already active.",
  FOLDER_MOVE_CYCLE:
    "A folder cannot be moved into itself or one of its descendants.",
  FOLDER_NAME_INVALID: "Folder names cannot contain forward or back slashes.",
  FOLDER_NAME_REQUIRED: "Folder name is required.",
  FOLDER_NOT_FOUND: "That folder does not exist.",
  FOLDER_ROOT_IMMUTABLE:
    "The library root cannot be renamed, moved, trashed, or restored.",
};

const libraryErrorStatuses: Record<LibraryErrorCode, number> = {
  ACCESS_DENIED: 403,
  FOLDER_ALREADY_ACTIVE: 409,
  FOLDER_MOVE_CYCLE: 409,
  FOLDER_NAME_INVALID: 400,
  FOLDER_NAME_REQUIRED: 400,
  FOLDER_NOT_FOUND: 404,
  FOLDER_ROOT_IMMUTABLE: 409,
};

export class LibraryError extends Error {
  readonly code: LibraryErrorCode;
  readonly status: number;

  constructor(code: LibraryErrorCode, message = libraryErrorMessages[code]) {
    super(message);
    this.name = "LibraryError";
    this.code = code;
    this.status = libraryErrorStatuses[code];
  }
}

export const isLibraryError = (error: unknown): error is LibraryError =>
  error instanceof LibraryError;
