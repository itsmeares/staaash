import type { UserRole } from "@staaash/db/client";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredAuthUser = AuthUser & {
  passwordHash: string;
};

export type AuthSession = {
  id: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  user: AuthUser;
};

export type StoredAuthSession = AuthSession & {
  tokenHash: string;
  revokedAt: Date | null;
};

export type SetupState = {
  isBootstrapped: boolean;
  instanceName: string | null;
};

export type InviteStatus = "active" | "accepted" | "expired" | "revoked";

export type InviteSummary = {
  id: string;
  email: string;
  role: UserRole;
  invitedByUserId: string;
  acceptedByUserId: string | null;
  acceptedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  status: InviteStatus;
};

export type StoredInvite = Omit<InviteSummary, "status">;

export type PasswordResetStatus = "active" | "expired" | "redeemed" | "revoked";

export type PasswordResetSummary = {
  id: string;
  userId: string;
  issuedByUserId: string;
  expiresAt: Date;
  redeemedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  status: PasswordResetStatus;
};

export type StoredPasswordReset = Omit<PasswordResetSummary, "status">;

export type InviteRedemptionState =
  | {
      isRedeemable: true;
      invite: InviteSummary;
    }
  | {
      isRedeemable: false;
      invite: InviteSummary | null;
      reason: "invalid" | "accepted" | "expired" | "revoked";
    };

export type PasswordResetState =
  | {
      isRedeemable: true;
      reset: PasswordResetSummary;
      user: AuthUser;
    }
  | {
      isRedeemable: false;
      reset: PasswordResetSummary | null;
      user: AuthUser | null;
      reason: "invalid" | "expired" | "redeemed" | "revoked";
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

export type CreateInviteInput = {
  email: string;
};

export type RedeemInviteInput = {
  token: string;
  displayName?: string;
  password: string;
};

export type IssuePasswordResetInput = {
  userId: string;
};

export type RedeemPasswordResetInput = {
  token: string;
  password: string;
};
