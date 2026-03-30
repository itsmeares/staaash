export type AuthErrorCode =
  | "ACCESS_DENIED"
  | "ACTIVE_INVITE_EXISTS"
  | "INVALID_CREDENTIALS"
  | "INVITE_ACCEPTED"
  | "INVITE_EXPIRED"
  | "INVITE_INVALID"
  | "INVITE_REVOKED"
  | "RESET_EXPIRED"
  | "RESET_INVALID"
  | "RESET_REDEEMED"
  | "RESET_REVOKED"
  | "SETUP_ALREADY_COMPLETED"
  | "SETUP_REQUIRED"
  | "USER_ALREADY_EXISTS"
  | "USER_NOT_FOUND";

const authErrorMessages: Record<AuthErrorCode, string> = {
  ACCESS_DENIED: "You do not have access to that surface.",
  ACTIVE_INVITE_EXISTS: "That email already has an active invite.",
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  INVITE_ACCEPTED: "That invite has already been used.",
  INVITE_EXPIRED: "That invite has expired.",
  INVITE_INVALID: "That invite is not valid.",
  INVITE_REVOKED: "That invite has been revoked.",
  RESET_EXPIRED: "That password reset link has expired.",
  RESET_INVALID: "That password reset link is not valid.",
  RESET_REDEEMED: "That password reset link has already been used.",
  RESET_REVOKED: "That password reset link has been revoked.",
  SETUP_ALREADY_COMPLETED: "Initial setup has already been completed.",
  SETUP_REQUIRED:
    "Initial setup must be completed before sign-in is available.",
  USER_ALREADY_EXISTS: "A user with that email already exists.",
  USER_NOT_FOUND: "That user does not exist.",
};

const authErrorStatuses: Record<AuthErrorCode, number> = {
  ACCESS_DENIED: 403,
  ACTIVE_INVITE_EXISTS: 409,
  INVALID_CREDENTIALS: 401,
  INVITE_ACCEPTED: 409,
  INVITE_EXPIRED: 410,
  INVITE_INVALID: 404,
  INVITE_REVOKED: 410,
  RESET_EXPIRED: 410,
  RESET_INVALID: 404,
  RESET_REDEEMED: 409,
  RESET_REVOKED: 410,
  SETUP_ALREADY_COMPLETED: 409,
  SETUP_REQUIRED: 409,
  USER_ALREADY_EXISTS: 409,
  USER_NOT_FOUND: 404,
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

export const isAuthError = (error: unknown): error is AuthError =>
  error instanceof AuthError;

export const getAuthErrorMessage = (code: AuthErrorCode) =>
  authErrorMessages[code];
