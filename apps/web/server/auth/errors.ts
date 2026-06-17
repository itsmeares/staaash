export type AuthErrorCode =
  | "ACCESS_DENIED"
  | "INVALID_IDENTIFIER"
  | "INVALID_CREDENTIALS"
  | "NOT_SIGNED_IN"
  | "PASSWORD_INVALID"
  | "PASSWORD_CONFIRMATION_MISMATCH"
  | "PASSWORD_CHANGE_REQUIRED"
  | "SETUP_ALREADY_COMPLETED"
  | "SETUP_REQUIRED"
  | "STORAGE_ID_COLLISION"
  | "USER_ALREADY_EXISTS"
  | "USER_NOT_FOUND"
  | "USER_IS_OWNER"
  | "CURRENT_SESSION_REVOKE_BLOCKED";

const authErrorMessages: Record<AuthErrorCode, string> = {
  ACCESS_DENIED: "You do not have access to that surface.",
  INVALID_IDENTIFIER: "Enter a valid email address.",
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  NOT_SIGNED_IN: "Not signed in.",
  PASSWORD_INVALID: "Password must be 12-128 characters.",
  PASSWORD_CONFIRMATION_MISMATCH: "Passwords do not match.",
  PASSWORD_CHANGE_REQUIRED: "Change your password before continuing.",
  SETUP_ALREADY_COMPLETED: "Initial setup has already been completed.",
  SETUP_REQUIRED:
    "Initial setup must be completed before sign-in is available.",
  STORAGE_ID_COLLISION: "Could not allocate a storage ID. Please try again.",
  USER_ALREADY_EXISTS: "A user with that email already exists.",
  USER_NOT_FOUND: "That user does not exist.",
  USER_IS_OWNER: "Owner account cannot be changed here.",
  CURRENT_SESSION_REVOKE_BLOCKED: "You cannot revoke the current session.",
};

const authErrorStatuses: Record<AuthErrorCode, number> = {
  ACCESS_DENIED: 403,
  INVALID_IDENTIFIER: 400,
  INVALID_CREDENTIALS: 401,
  NOT_SIGNED_IN: 401,
  PASSWORD_INVALID: 400,
  PASSWORD_CONFIRMATION_MISMATCH: 400,
  PASSWORD_CHANGE_REQUIRED: 403,
  SETUP_ALREADY_COMPLETED: 409,
  SETUP_REQUIRED: 409,
  STORAGE_ID_COLLISION: 409,
  USER_ALREADY_EXISTS: 409,
  USER_NOT_FOUND: 404,
  USER_IS_OWNER: 403,
  CURRENT_SESSION_REVOKE_BLOCKED: 400,
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;

  constructor(code: AuthErrorCode, message = authErrorMessages[code]) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = authErrorStatuses[code];
  }
}

const isAuthError = (error: unknown): error is AuthError =>
  error instanceof AuthError;

const getAuthErrorMessage = (code: AuthErrorCode) => authErrorMessages[code];
