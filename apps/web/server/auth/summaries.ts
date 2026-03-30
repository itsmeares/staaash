import type { Invite, PasswordReset } from "@staaash/db/client";

import type {
  InviteSummary,
  PasswordResetSummary,
  StoredInvite,
  StoredPasswordReset,
} from "@/server/auth/types";

export const getInviteStatus = (
  invite: Pick<Invite | StoredInvite, "acceptedAt" | "revokedAt" | "expiresAt">,
  now: Date,
): InviteSummary["status"] => {
  if (invite.acceptedAt) {
    return "accepted";
  }

  if (invite.revokedAt) {
    return "revoked";
  }

  if (invite.expiresAt <= now) {
    return "expired";
  }

  return "active";
};

export const toStoredInvite = (
  invite: Invite | StoredInvite,
): StoredInvite => ({
  id: invite.id,
  email: invite.email,
  role: invite.role,
  invitedByUserId: invite.invitedByUserId,
  acceptedByUserId: invite.acceptedByUserId,
  acceptedAt: invite.acceptedAt,
  expiresAt: invite.expiresAt,
  revokedAt: invite.revokedAt,
  createdAt: invite.createdAt,
  updatedAt: invite.updatedAt,
});

export const toInviteSummary = (
  invite: Invite | StoredInvite,
  now: Date,
): InviteSummary => ({
  ...toStoredInvite(invite),
  status: getInviteStatus(invite, now),
});

export const getPasswordResetStatus = (
  reset: Pick<
    PasswordReset | StoredPasswordReset,
    "redeemedAt" | "revokedAt" | "expiresAt"
  >,
  now: Date,
): PasswordResetSummary["status"] => {
  if (reset.redeemedAt) {
    return "redeemed";
  }

  if (reset.revokedAt) {
    return "revoked";
  }

  if (reset.expiresAt <= now) {
    return "expired";
  }

  return "active";
};

export const toStoredPasswordReset = (
  reset: PasswordReset | StoredPasswordReset,
): StoredPasswordReset => ({
  id: reset.id,
  userId: reset.userId,
  issuedByUserId: reset.issuedByUserId,
  expiresAt: reset.expiresAt,
  redeemedAt: reset.redeemedAt,
  revokedAt: reset.revokedAt,
  createdAt: reset.createdAt,
  updatedAt: reset.updatedAt,
});

export const toPasswordResetSummary = (
  reset: PasswordReset | StoredPasswordReset,
  now: Date,
): PasswordResetSummary => ({
  ...toStoredPasswordReset(reset),
  status: getPasswordResetStatus(reset, now),
});
