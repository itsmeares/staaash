import type { UserRole } from "@/server/types";

export type UserPreferences = {
  theme: string;
  timeZone: string;
  showUpdateNotifications: boolean;
  showFolderPreviews: boolean;
  showPinsInSidebar: boolean;
  startPage: string;
  defaultView: string;
  clockFormat: string;
  onboardingCompletedAt: Date | null;
};

export type AuthUser = {
  id: string;
  email: string;
  storageId: string;
  displayName: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  role: UserRole;
  passwordChangeRequiredAt: Date | null;
  temporaryPasswordIssuedAt: Date | null;
  temporaryPasswordIssuedByUserId: string | null;
  storageLimitBytes: bigint | null;
  /** False for an account that only signs in through the OIDC provider. */
  hasPassword: boolean;
  oidcLinked: boolean;
  preferences: UserPreferences | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredAuthUser = AuthUser & {
  passwordHash: string | null;
};

/** Who the OIDC provider says signed in. `issuer` + `subject` is the identity. */
export type OidcIdentity = {
  issuer: string;
  subject: string;
  email: string | null;
  name: string | null;
  groups: string[];
};

export type AuthSession = {
  id: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
  lastSeenAt: Date | null;
  /** Set for a desktop device signed in with a device token. */
  deviceName: string | null;
  /** Set for an app window's browser session, opened by that device. */
  deviceSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: AuthUser;
};

export type StoredAuthSession = AuthSession & {
  tokenHash: string;
  revokedAt: Date | null;
};

export type SessionMetadata = {
  userAgent?: string | null;
  ipAddress?: string | null;
  deviceName?: string | null;
  deviceSessionId?: string | null;
};

export type SetupState = {
  isBootstrapped: boolean;
  instanceName: string | null;
};

export type BootstrapInput = {
  instanceName: string;
  email: string;
  displayName?: string;
  password: string;
};

export type SignInInput = {
  email: string;
  password: string;
};

export type AdminCreateUserInput = {
  email: string;
  /** "oidc": no password; they connect through a one-time sign-in link. */
  signInWith?: "password" | "oidc";
  temporaryPassword?: string;
  confirmTemporaryPassword?: string;
  generateTemporaryPassword?: boolean;
  storageLimitBytes?: bigint | null;
  isAdmin?: boolean;
  requirePasswordChange?: boolean;
};

export type AdminUpdateUserInput = {
  email?: string;
  displayName?: string | null;
  storageLimitBytes?: bigint | null;
  isAdmin?: boolean;
};

export type TemporaryPasswordInput = {
  temporaryPassword?: string;
  confirmTemporaryPassword?: string;
  generateTemporaryPassword?: boolean;
  requirePasswordChange?: boolean;
};

export type TemporaryPasswordResult = {
  user: AuthUser;
  temporaryPassword: string;
};

export type CreatedUserResult = {
  user: AuthUser;
  temporaryPassword: string | null;
};
