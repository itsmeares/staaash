import type { UserRole } from "@/server/types";

export type UserPreferences = {
  theme: string;
  timeZone: string;
  showUpdateNotifications: boolean;
  enableVersionChecks: boolean;
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
  preferences: UserPreferences | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredAuthUser = AuthUser & {
  passwordHash: string;
};

export type AuthSession = {
  id: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
  lastSeenAt: Date | null;
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
