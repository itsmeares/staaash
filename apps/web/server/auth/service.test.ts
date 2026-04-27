import { describe, expect, it } from "vitest";

import type { AuthCrypto } from "@/server/auth/crypto";
import { AuthError } from "@/server/auth/errors";
import type { AuthRepository } from "@/server/auth/repository";
import {
  getInviteStatus,
  getPasswordResetStatus,
  toInviteSummary,
} from "@/server/auth/summaries";
import { createAuthService } from "@/server/auth/service";
import type {
  AuthSession,
  AuthUser,
  InviteSummary,
  PasswordResetSummary,
  SetupState,
  StoredAuthSession,
  StoredAuthUser,
  StoredInvite,
  StoredPasswordReset,
} from "@/server/auth/types";

type MemoryState = {
  instanceName: string | null;
  users: StoredAuthUser[];
  sessions: StoredAuthSession[];
  invites: Array<StoredInvite & { tokenHash: string }>;
  resets: Array<StoredPasswordReset & { tokenHash: string }>;
  ids: number;
};

const createMemoryRepository = (): AuthRepository => {
  const state: MemoryState = {
    instanceName: null,
    users: [],
    sessions: [],
    invites: [],
    resets: [],
    ids: 0,
  };

  const nextId = (prefix: string) => `${prefix}-${++state.ids}`;

  const toUser = (user: StoredAuthUser): AuthUser => ({
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    storageLimitBytes: user.storageLimitBytes,
    preferences: user.preferences,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });

  const toSession = (session: StoredAuthSession): AuthSession => ({
    id: session.id,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    user: session.user,
  });

  const toPasswordResetSummary = (
    reset: StoredPasswordReset,
    now: Date,
  ): PasswordResetSummary => ({
    ...reset,
    status: getPasswordResetStatus(reset, now),
  });

  return {
    async getSetupState(): Promise<SetupState> {
      return {
        isBootstrapped:
          state.instanceName !== null ||
          state.users.some((user) => user.role === "owner"),
        instanceName: state.instanceName,
      };
    },

    async createBootstrap(params) {
      if (state.instanceName) {
        throw new AuthError("SETUP_ALREADY_COMPLETED");
      }

      const user: StoredAuthUser = {
        id: nextId("user"),
        email: params.email,
        username: params.username,
        displayName: params.displayName ?? null,
        avatarUrl: null,
        passwordHash: params.passwordHash,
        role: "owner",
        storageLimitBytes: null,
        preferences: null,
        createdAt: params.createdAt,
        updatedAt: params.createdAt,
      };

      state.instanceName = params.instanceName;
      state.users.push(user);

      return toUser(user);
    },

    async findUserByEmail(email) {
      return state.users.find((user) => user.email === email) ?? null;
    },

    async findUserByUsername(username) {
      return state.users.find((user) => user.username === username) ?? null;
    },

    async findUserById(id) {
      const user = state.users.find((candidate) => candidate.id === id);
      return user ? toUser(user) : null;
    },

    async listUsers() {
      return state.users.map(toUser);
    },

    async setUserStorageLimit(userId, limitBytes) {
      const user = state.users.find((u) => u.id === userId);
      if (!user) return null;
      user.storageLimitBytes = limitBytes;
      return toUser(user);
    },

    async createSession(params) {
      const user = state.users.find(
        (candidate) => candidate.id === params.userId,
      );

      if (!user) {
        throw new AuthError("USER_NOT_FOUND");
      }

      const session: StoredAuthSession = {
        id: nextId("session"),
        tokenHash: params.tokenHash,
        revokedAt: null,
        expiresAt: params.expiresAt,
        createdAt: params.expiresAt,
        updatedAt: params.expiresAt,
        user: toUser(user),
      };

      state.sessions.push(session);
      return toSession(session);
    },

    async findSessionByTokenHash(tokenHash) {
      return (
        state.sessions.find((session) => session.tokenHash === tokenHash) ??
        null
      );
    },

    async revokeSessionById(id, revokedAt) {
      const session = state.sessions.find((candidate) => candidate.id === id);

      if (session) {
        session.revokedAt = revokedAt;
      }
    },

    async findActiveInviteByEmail(email, now) {
      const invite = state.invites.find(
        (candidate) =>
          candidate.email === email &&
          candidate.acceptedAt === null &&
          candidate.revokedAt === null &&
          candidate.expiresAt > now,
      );

      return invite ? toInviteSummary(invite, now) : null;
    },

    async listInvites(now) {
      return state.invites.map((invite) => toInviteSummary(invite, now));
    },

    async findInviteById(id) {
      return state.invites.find((invite) => invite.id === id) ?? null;
    },

    async findInviteByTokenHash(tokenHash) {
      return (
        state.invites.find((invite) => invite.tokenHash === tokenHash) ?? null
      );
    },

    async createInvite(params, now) {
      const invite: StoredInvite & { tokenHash: string } = {
        id: nextId("invite"),
        email: params.email,
        role: params.role,
        tokenHash: params.tokenHash,
        invitedByUserId: params.invitedByUserId,
        acceptedByUserId: null,
        acceptedAt: null,
        expiresAt: params.expiresAt,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      state.invites.push(invite);
      return toInviteSummary(invite, now);
    },

    async revokeInvite(id, revokedAt, now) {
      const invite = state.invites.find((candidate) => candidate.id === id);

      if (!invite) {
        throw new AuthError("INVITE_INVALID");
      }

      invite.revokedAt = revokedAt;
      invite.updatedAt = revokedAt;

      return toInviteSummary(invite, now);
    },

    async consumeInvite(params) {
      const invite = state.invites.find(
        (candidate) =>
          candidate.id === params.inviteId &&
          candidate.acceptedAt === null &&
          candidate.revokedAt === null &&
          candidate.expiresAt > params.now,
      );

      if (!invite) {
        return null;
      }

      if (state.users.some((user) => user.email === invite.email)) {
        throw new AuthError("USER_ALREADY_EXISTS");
      }

      const user: StoredAuthUser = {
        id: nextId("user"),
        email: invite.email,
        username: params.username,
        displayName: params.displayName ?? null,
        avatarUrl: null,
        passwordHash: params.passwordHash,
        role: invite.role,
        storageLimitBytes: null,
        preferences: null,
        createdAt: params.now,
        updatedAt: params.now,
      };

      invite.acceptedAt = params.now;
      invite.acceptedByUserId = user.id;
      invite.updatedAt = params.now;
      state.users.push(user);

      return toUser(user);
    },

    async createPasswordReset(params, now) {
      for (const reset of state.resets) {
        if (
          reset.userId === params.userId &&
          reset.redeemedAt === null &&
          reset.revokedAt === null &&
          reset.expiresAt > params.now
        ) {
          reset.revokedAt = params.now;
          reset.updatedAt = params.now;
        }
      }

      const reset: StoredPasswordReset & { tokenHash: string } = {
        id: nextId("reset"),
        userId: params.userId,
        issuedByUserId: params.issuedByUserId,
        tokenHash: params.tokenHash,
        expiresAt: params.expiresAt,
        redeemedAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      state.resets.push(reset);
      return toPasswordResetSummary(reset, now);
    },

    async findPasswordResetByTokenHash(tokenHash) {
      const reset = state.resets.find(
        (candidate) => candidate.tokenHash === tokenHash,
      );

      if (!reset) {
        return null;
      }

      const user = state.users.find(
        (candidate) => candidate.id === reset.userId,
      );

      if (!user) {
        return null;
      }

      return {
        reset,
        user: toUser(user),
      };
    },

    async consumePasswordReset(params) {
      const reset = state.resets.find(
        (candidate) =>
          candidate.id === params.resetId &&
          candidate.redeemedAt === null &&
          candidate.revokedAt === null &&
          candidate.expiresAt > params.now,
      );

      if (!reset) {
        return null;
      }

      const user = state.users.find(
        (candidate) => candidate.id === reset.userId,
      );

      if (!user) {
        return null;
      }

      user.passwordHash = params.passwordHash;
      user.updatedAt = params.now;
      reset.redeemedAt = params.now;
      reset.updatedAt = params.now;

      for (const session of state.sessions) {
        if (session.user.id === user.id && session.revokedAt === null) {
          session.revokedAt = params.now;
        }
      }

      return toUser(user);
    },

    async savePreferences(params) {
      return {
        theme: params.theme,
        showUpdateNotifications: params.showUpdateNotifications,
        enableVersionChecks: params.enableVersionChecks,
        onboardingCompletedAt: params.onboardingCompletedAt ?? new Date(),
      };
    },
  };
};

const createFakeCrypto = (): AuthCrypto => {
  let tokenCounter = 0;

  return {
    hashOpaqueToken(token) {
      return `hash:${token}`;
    },
    issueOpaqueToken() {
      tokenCounter += 1;
      const token = `token-${tokenCounter}`;
      return {
        token,
        tokenHash: `hash:${token}`,
      };
    },
    async hashPassword(password) {
      return `password:${password}`;
    },
    async verifyPassword(password, passwordHash) {
      return passwordHash === `password:${password}`;
    },
  };
};

describe("auth service", () => {
  it("bootstraps the instance exactly once", async () => {
    const service = createAuthService({
      repo: createMemoryRepository(),
      crypto: createFakeCrypto(),
      now: () => new Date("2026-03-30T12:00:00.000Z"),
    });

    const firstBootstrap = await service.bootstrap({
      instanceName: "Home Drive",
      email: "owner@example.com",
      username: "owner",
      displayName: "Owner",
      password: "super-secure-password",
    });

    expect(firstBootstrap.user.role).toBe("owner");
    expect((await service.getSetupState()).isBootstrapped).toBe(true);

    await expect(
      service.bootstrap({
        instanceName: "Second Attempt",
        email: "other@example.com",
        username: "other",
        displayName: "Other",
        password: "another-super-secure-password",
      }),
    ).rejects.toMatchObject({
      code: "SETUP_ALREADY_COMPLETED",
    });
  });

  it("signs in, exposes the current session, and revokes it on sign out", async () => {
    const service = createAuthService({
      repo: createMemoryRepository(),
      crypto: createFakeCrypto(),
      now: () => new Date("2026-03-30T12:00:00.000Z"),
    });

    await service.bootstrap({
      instanceName: "Home Drive",
      email: "owner@example.com",
      username: "owner",
      password: "super-secure-password",
    });

    await expect(
      service.signIn({
        identifier: "owner@example.com",
        password: "wrong-password",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });

    const signIn = await service.signIn({
      identifier: "owner",
      password: "super-secure-password",
    });

    const currentSession = await service.getSession(signIn.sessionToken);
    expect(currentSession?.user.email).toBe("owner@example.com");

    await service.revokeSession(signIn.sessionToken);

    await expect(service.getSession(signIn.sessionToken)).resolves.toBeNull();
  });

  it("issues and redeems member invites", async () => {
    const service = createAuthService({
      repo: createMemoryRepository(),
      crypto: createFakeCrypto(),
      now: () => new Date("2026-03-30T12:00:00.000Z"),
    });

    const bootstrap = await service.bootstrap({
      instanceName: "Home Drive",
      email: "owner@example.com",
      username: "owner",
      password: "super-secure-password",
    });

    const invite = await service.createInvite(bootstrap.user.id, {
      email: "member@example.com",
    });

    expect(invite.invite.status).toBe("active");

    const redeemed = await service.redeemInvite({
      token: invite.token,
      username: "member",
      displayName: "Member",
      password: "member-secure-password",
    });

    expect(redeemed.user.role).toBe("member");
    expect(redeemed.user.email).toBe("member@example.com");

    const inviteState = await service.getInviteRedemptionState(invite.token);
    expect(inviteState).toMatchObject({
      isRedeemable: false,
      reason: "accepted",
    });
  });
});
