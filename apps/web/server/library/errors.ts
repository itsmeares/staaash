export type LibraryErrorCode =
  | "ACCESS_DENIED"
  | "FILE_ALREADY_ACTIVE"
  | "FILE_DELETE_REQUIRES_TRASH"
  | "FILE_MOVE_NOOP"
  | "FILE_NAME_CONFLICT"
  | "FILE_NAME_INVALID"
  | "FILE_NAME_INVALID_CHARACTER"
  | "FILE_NAME_REQUIRED"
  | "FILE_NAME_RESERVED"
  | "FILE_NAME_TRAILING_SPACE_OR_DOT"
  | "FILE_NOT_FOUND"
  | "FOLDER_ALREADY_ACTIVE"
  | "FOLDER_MOVE_CYCLE"
  | "FOLDER_MOVE_NOOP"
  | "FOLDER_NAME_CONFLICT"
  | "FOLDER_NAME_INVALID"
  | "FOLDER_NAME_INVALID_CHARACTER"
  | "FOLDER_NAME_REQUIRED"
  | "FOLDER_NAME_RESERVED"
  | "FOLDER_NAME_TRAILING_SPACE_OR_DOT"
  | "FOLDER_NOT_FOUND"
  | "FOLDER_ROOT_IMMUTABLE";

const libraryErrorMessages: Record<LibraryErrorCode, string> = {
  ACCESS_DENIED: "You do not have access to that folder.",
  FILE_ALREADY_ACTIVE: "That file is already active.",
  FILE_DELETE_REQUIRES_TRASH:
    "Files must be moved to trash before they can be permanently deleted.",
  FILE_MOVE_NOOP: "That file is already in that location.",
  FILE_NAME_CONFLICT:
    "An active file or folder already uses that name in this location.",
  FILE_NAME_INVALID: "File names cannot contain forward or back slashes.",
  FILE_NAME_INVALID_CHARACTER:
    "File names cannot contain Windows-reserved path characters.",
  FILE_NAME_REQUIRED: "File name is required.",
  FILE_NAME_RESERVED:
    "That file name is reserved by Windows and cannot be used.",
  FILE_NAME_TRAILING_SPACE_OR_DOT:
    "File names cannot end with a space or a dot.",
  FILE_NOT_FOUND: "That file does not exist.",
  FOLDER_ALREADY_ACTIVE: "That folder is already active.",
  FOLDER_MOVE_CYCLE:
    "A folder cannot be moved into itself or one of its descendants.",
  FOLDER_MOVE_NOOP: "That folder is already in that location.",
  FOLDER_NAME_CONFLICT:
    "An active file or folder already uses that name in this location.",
  FOLDER_NAME_INVALID: "Folder names cannot contain forward or back slashes.",
  FOLDER_NAME_INVALID_CHARACTER:
    "Folder names cannot contain Windows-reserved path characters.",
  FOLDER_NAME_REQUIRED: "Folder name is required.",
  FOLDER_NAME_RESERVED:
    "That folder name is reserved by Windows and cannot be used.",
  FOLDER_NAME_TRAILING_SPACE_OR_DOT:
    "Folder names cannot end with a space or a dot.",
  FOLDER_NOT_FOUND: "That folder does not exist.",
  FOLDER_ROOT_IMMUTABLE:
    "The library root cannot be renamed, moved, trashed, or restored.",
};

const libraryErrorStatuses: Record<LibraryErrorCode, number> = {
  ACCESS_DENIED: 403,
  FILE_ALREADY_ACTIVE: 409,
  FILE_DELETE_REQUIRES_TRASH: 409,
  FILE_MOVE_NOOP: 409,
  FILE_NAME_CONFLICT: 409,
  FILE_NAME_INVALID: 400,
  FILE_NAME_INVALID_CHARACTER: 400,
  FILE_NAME_REQUIRED: 400,
  FILE_NAME_RESERVED: 400,
  FILE_NAME_TRAILING_SPACE_OR_DOT: 400,
  FILE_NOT_FOUND: 404,
  FOLDER_ALREADY_ACTIVE: 409,
  FOLDER_MOVE_CYCLE: 409,
  FOLDER_MOVE_NOOP: 409,
  FOLDER_NAME_CONFLICT: 409,
  FOLDER_NAME_INVALID: 400,
  FOLDER_NAME_REQUIRED: 400,
  FOLDER_NAME_INVALID_CHARACTER: 400,
  FOLDER_NAME_RESERVED: 400,
  FOLDER_NAME_TRAILING_SPACE_OR_DOT: 400,
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
