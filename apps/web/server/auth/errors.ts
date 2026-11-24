export type AuthErrorCode =
  | "ACCESS_DENIED"
  | "INVALID_IDENTIFIER"
  | "INVALID_CREDENTIALS"
  | "CURRENT_PASSWORD_WRONG"
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
  | "CURRENT_SESSION_REVOKE_BLOCKED"
  | "DEVICE_CODE_INVALID"
  | "DEVICE_REQUEST_INVALID"
  | "PASSWORD_LOGIN_DISABLED"
  | "OIDC_DISABLED"
  | "OIDC_FAILED"
  | "OIDC_ALREADY_LINKED"
  | "OIDC_CONNECT_FIRST"
  | "OIDC_NOT_INVITED"
  | "OIDC_INVITE_INVALID"
  | "OIDC_EMAIL_REQUIRED"
  | "OIDC_LAST_SIGN_IN";

const authErrorMessages: Record<AuthErrorCode, string> = {
  ACCESS_DENIED: "You do not have access to that surface.",
  INVALID_IDENTIFIER: "Enter a valid email address.",
  INVALID_CREDENTIALS: "That email and password don't match.",
  CURRENT_PASSWORD_WRONG: "That is not your current password.",
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
  DEVICE_CODE_INVALID: "That sign-in code is invalid, used, or expired.",
  DEVICE_REQUEST_INVALID: "That device sign-in request is invalid.",
  PASSWORD_LOGIN_DISABLED: "Passwords are turned off. Use single sign-on.",
  OIDC_DISABLED: "Single sign-on is not set up.",
  OIDC_FAILED: "Single sign-on did not finish. Try again.",
  OIDC_ALREADY_LINKED:
    "That single sign-on account is already connected to another account.",
  OIDC_CONNECT_FIRST:
    "An account with that email already exists. Sign in with your password, then press Connect in Settings.",
  OIDC_NOT_INVITED:
    "You don't have an account here. Ask the owner to invite you.",
  OIDC_INVITE_INVALID: "That invite link is used, expired, or replaced.",
  OIDC_EMAIL_REQUIRED:
    "Single sign-on did not share an email address, which a new account needs.",
  OIDC_LAST_SIGN_IN:
    "Set a password first, or this account would have no way to sign in.",
};

const authErrorStatuses: Record<AuthErrorCode, number> = {
  ACCESS_DENIED: 403,
  INVALID_IDENTIFIER: 400,
  INVALID_CREDENTIALS: 401,
  CURRENT_PASSWORD_WRONG: 400,
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
  DEVICE_CODE_INVALID: 400,
  DEVICE_REQUEST_INVALID: 400,
  PASSWORD_LOGIN_DISABLED: 403,
  OIDC_DISABLED: 404,
  OIDC_FAILED: 400,
  OIDC_ALREADY_LINKED: 409,
  OIDC_CONNECT_FIRST: 409,
  OIDC_NOT_INVITED: 403,
  OIDC_INVITE_INVALID: 400,
  OIDC_EMAIL_REQUIRED: 400,
  OIDC_LAST_SIGN_IN: 409,
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
