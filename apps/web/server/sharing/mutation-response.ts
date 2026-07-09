import type { StoredShareLink } from "./types";

export type ManagedShareStatus = "active" | "expired" | "revoked";

export type ManagedShareView = {
  id: string;
  shareUrl?: string;
  hasPassword: boolean;
  downloadDisabled: boolean;
  expiresAt: string;
  revokedAt: string | null;
  status: ManagedShareStatus;
};

const getManagedShareStatus = (
  share: StoredShareLink,
  now: Date,
): ManagedShareStatus => {
  if (share.revokedAt) return "revoked";
  if (share.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
};

export const toManagedShareView = (
  share: StoredShareLink,
  shareUrl?: string,
  now = new Date(),
): ManagedShareView => ({
  id: share.id,
  ...(shareUrl ? { shareUrl } : {}),
  hasPassword: Boolean(share.passwordHash),
  downloadDisabled: share.downloadDisabled,
  expiresAt: share.expiresAt.toISOString(),
  revokedAt: share.revokedAt?.toISOString() ?? null,
  status: getManagedShareStatus(share, now),
});
