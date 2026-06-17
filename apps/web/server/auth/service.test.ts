import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/server/auth/errors";
import { createAuthService } from "@/server/auth/service";
import type {
  AuthSession,
  AuthUser,
  StoredAuthSession,
  StoredAuthUser,
  UserPreferences,
} from "@/server/auth/types";
import type { AuthRepository } from "@/server/auth/repository";

vi.mock("@/server/storage", () => ({
  ensureUserCommittedStorageDirectories: vi.fn(),
}));

const now = new Date("2026-06-16T10:00:00.000Z");

type State = {
  users: StoredAuthUser[];
  sessions: StoredAuthSession[];
};

const prefs: UserPreferences = {
  theme: "system",
  timeZone: "UTC",
  showUpdateNotifications: true,
  enableVersionChecks: true,
  onboardingCompletedAt: now,
};

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

const toAuthUser = (user: StoredAuthUser): AuthUser => {
  const { passwordHash: _passwordHash, ...authUser } = user;
  return authUser;
};

const makeUser = (overrides: Partial<StoredAuthUser>): StoredAuthUser => {
  const isOwner = overrides.isOwner ?? false;
  const isAdmin = overrides.isAdmin ?? isOwner;

  return {
    id: overrides.id ?? nextId("user"),
    email: overrides.email ?? "member@example.com",
    storageId: overrides.storageId ?? nextId("user-storage"),
    displayName: overrides.displayName ?? null,
    avatarUrl: overrides.avatarUrl ?? null,
    isOwner,
    isAdmin,
    role: isOwner ? "owner" : isAdmin ? "admin" : "member",
    passwordChangeRequiredAt: overrides.passwordChangeRequiredAt ?? null,
    temporaryPasswordIssuedAt: overrides.temporaryPasswordIssuedAt ?? null,
    temporaryPasswordIssuedByUserId:
      overrides.temporaryPasswordIssuedByUserId ?? null,
    storageLimitBytes: overrides.storageLimitBytes ?? null,
    preferences: overrides.preferences ?? prefs,
    passwordHash: overrides.passwordHash ?? "hash",
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
};

const createRepo = (state: State): AuthRepository => ({
  async getSetupState() {
    return {
      isBootstrapped: state.users.some((user) => user.isOwner),
      instanceName: "Test Staaash",
    };
  },
  async createBootstrap(params) {
    const user = makeUser({
      email: params.email,
      storageId: params.storageId,
      displayName: params.displayName ?? null,
      passwordHash: params.passwordHash,
      isOwner: true,
      isAdmin: true,
      preferences: null,
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
    });
    state.users.push(user);
    return toAuthUser(user);
  },
  async createUser(params) {
    if (state.users.some((user) => user.email === params.email)) {
      throw new AuthError("USER_ALREADY_EXISTS");
    }

    const user = makeUser({
      email: params.email,
      storageId: params.storageId,
      passwordHash: params.passwordHash,
      isAdmin: params.isAdmin,
      preferences: null,
      storageLimitBytes: params.storageLimitBytes,
      passwordChangeRequiredAt: params.passwordChangeRequiredAt,
      temporaryPasswordIssuedAt: params.temporaryPasswordIssuedAt,
      temporaryPasswordIssuedByUserId: params.temporaryPasswordIssuedByUserId,
    });
    state.users.push(user);
    return toAuthUser(user);
  },
  async updateUser(params) {
    const user = state.users.find(
      (candidate) => candidate.id === params.userId,
    );
    if (!user) return null;
    if (params.email !== undefined) user.email = params.email;
    if (params.displayName !== undefined) {
      user.displayName = params.displayName;
    }
    if (params.storageLimitBytes !== undefined) {
      user.storageLimitBytes = params.storageLimitBytes;
    }
    if (params.isAdmin !== undefined) {
      user.isAdmin = params.isAdmin;
      user.role = user.isOwner ? "owner" : user.isAdmin ? "admin" : "member";
    }
    return toAuthUser(user);
  },
  async findUserByEmail(email) {
    return state.users.find((user) => user.email === email) ?? null;
  },
  async findUserById(id) {
    const user = state.users.find((candidate) => candidate.id === id);
    return user ? toAuthUser(user) : null;
  },
  async listUsers() {
    return state.users.map(toAuthUser);
  },
  async setUserStorageLimit(userId, limitBytes) {
    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) return null;
    user.storageLimitBytes = limitBytes;
    return toAuthUser(user);
  },
  async setTemporaryPassword(params) {
    const user = state.users.find(
      (candidate) => candidate.id === params.userId,
    );
    if (!user) throw new AuthError("USER_NOT_FOUND");
    user.passwordHash = params.passwordHash;
    user.passwordChangeRequiredAt = params.requirePasswordChange
      ? params.now
      : null;
    user.temporaryPasswordIssuedAt = params.now;
    user.temporaryPasswordIssuedByUserId = params.issuedByUserId;
    for (const session of state.sessions) {
      if (session.user.id === user.id) session.revokedAt = params.now;
    }
    return toAuthUser(user);
  },
  async changeRequiredPassword(userId, passwordHash) {
    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) return null;
    user.passwordHash = passwordHash;
    user.passwordChangeRequiredAt = null;
    user.temporaryPasswordIssuedAt = null;
    user.temporaryPasswordIssuedByUserId = null;
    return toAuthUser(user);
  },
  async createSession(params) {
    const user = state.users.find(
      (candidate) => candidate.id === params.userId,
    );
    if (!user) throw new AuthError("USER_NOT_FOUND");
    const session: StoredAuthSession = {
      id: nextId("session"),
      user: toAuthUser(user),
      tokenHash: params.tokenHash,
      expiresAt: params.expiresAt,
      revokedAt: null,
      userAgent: params.metadata?.userAgent ?? null,
      ipAddress: params.metadata?.ipAddress ?? null,
      lastSeenAt: params.now,
      createdAt: params.now,
      updatedAt: params.now,
    };
    state.sessions.push(session);
    return session;
  },
  async findSessionByTokenHash(tokenHash) {
    return (
      state.sessions.find((session) => session.tokenHash === tokenHash) ?? null
    );
  },
  async listUserSessions(userId) {
    return state.sessions.filter(
      (session) => session.user.id === userId && !session.revokedAt,
    );
  },
  async revokeSessionById(id, revokedAt) {
    const session = state.sessions.find((candidate) => candidate.id === id);
    if (session) session.revokedAt = revokedAt;
  },
  async revokeUserSessions(userId, revokedAt) {
    for (const session of state.sessions) {
      if (session.user.id === userId) session.revokedAt = revokedAt;
    }
  },
  async touchSessionLastSeen(id, seenAt) {
    const session = state.sessions.find((candidate) => candidate.id === id);
    if (session) session.lastSeenAt = seenAt;
  },
  async savePreferences() {
    return prefs;
  },
});

describe("auth service", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  it("bootstraps an owner/admin account and signs in by email", async () => {
    const state: State = { users: [], sessions: [] };
    const service = createAuthService({
      repo: createRepo(state),
      now: () => now,
      sessionMaxAgeDays: 30,
    });

    const bootstrap = await service.bootstrap({
      instanceName: "Test Staaash",
      email: "owner@example.com",
      password: "long-owner-password",
    });

    expect(bootstrap.user).toMatchObject({
      email: "owner@example.com",
      storageId: "owner",
      isOwner: true,
      isAdmin: true,
      role: "owner",
    });

    const signIn = await service.signIn({
      email: "owner@example.com",
      password: "long-owner-password",
    });

    expect(signIn.user.email).toBe("owner@example.com");
  });

  it("creates users with a temporary password and required password change", async () => {
    const state: State = {
      users: [
        makeUser({
          id: "owner-1",
          email: "owner@example.com",
          isOwner: true,
          isAdmin: true,
        }),
      ],
      sessions: [],
    };
    const service = createAuthService({
      repo: createRepo(state),
      now: () => now,
      sessionMaxAgeDays: 30,
    });

    const result = await service.createUser("owner-1", {
      email: "new@example.com",
      generateTemporaryPassword: true,
      requirePasswordChange: true,
      isAdmin: true,
    });

    expect(result.temporaryPassword).toHaveLength(12);
    expect(result.user).toMatchObject({
      email: "new@example.com",
      storageId: "new",
      isAdmin: true,
      passwordChangeRequiredAt: now,
    });
  });

  it("resets temporary passwords and revokes existing sessions", async () => {
    const state: State = {
      users: [
        makeUser({
          id: "owner-1",
          email: "owner@example.com",
          isOwner: true,
          isAdmin: true,
        }),
        makeUser({
          id: "member-1",
          email: "member@example.com",
        }),
      ],
      sessions: [],
    };
    const service = createAuthService({
      repo: createRepo(state),
      now: () => now,
      sessionMaxAgeDays: 30,
    });
    state.sessions.push({
      id: "session-1",
      user: toAuthUser(state.users[1]!),
      tokenHash: "hash",
      expiresAt: new Date("2026-07-16T10:00:00.000Z"),
      revokedAt: null,
      userAgent: "Firefox",
      ipAddress: "127.0.0.1",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.resetTemporaryPassword("owner-1", "member-1", {
      generateTemporaryPassword: false,
      temporaryPassword: "new-member-pass",
      confirmTemporaryPassword: "new-member-pass",
      requirePasswordChange: true,
    });

    expect(result.temporaryPassword).toBe("new-member-pass");
    expect(result.user.passwordChangeRequiredAt).toEqual(now);
    expect(state.sessions[0]?.revokedAt).toEqual(now);
  });
});
