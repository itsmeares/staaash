import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { AuthError } from "@/server/auth/errors";
import { createAuthService } from "@/server/auth/service";
import { ensureUserCommittedStorageDirectories } from "@/server/storage";
import type {
  AuthSession,
  AuthUser,
  StoredAuthSession,
  StoredAuthUser,
  UserPreferences,
} from "@/server/auth/types";
import type { AuthRepository } from "@/server/auth/repository";
import type { OidcEnv } from "@/lib/env";

vi.mock("@/server/storage", () => ({
  ensureUserCommittedStorageDirectories: vi.fn(),
}));

const now = new Date("2026-06-16T10:00:00.000Z");

type FakeUser = Omit<StoredAuthUser, "hasPassword" | "oidcLinked"> & {
  oidcIssuer: string | null;
  oidcSubject: string | null;
};

type State = {
  users: FakeUser[];
  sessions: StoredAuthSession[];
};

const prefs: UserPreferences = {
  theme: "system",
  timeZone: "UTC",
  showUpdateNotifications: true,
  showFolderPreviews: true,
  showPinsInSidebar: false,
  startPage: "home",
  defaultView: "list",
  clockFormat: "24h",
  onboardingCompletedAt: now,
};

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

const toAuthUser = (user: FakeUser): AuthUser => {
  const { passwordHash, oidcIssuer: _issuer, oidcSubject, ...authUser } = user;
  return {
    ...authUser,
    hasPassword: passwordHash !== null,
    oidcLinked: oidcSubject !== null,
  };
};

const makeUser = (overrides: Partial<FakeUser>): FakeUser => {
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
    passwordHash:
      overrides.passwordHash === undefined ? "hash" : overrides.passwordHash,
    oidcIssuer: overrides.oidcIssuer ?? null,
    oidcSubject: overrides.oidcSubject ?? null,
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
      displayName: params.displayName ?? null,
      passwordHash: params.passwordHash,
      oidcIssuer: params.oidc?.issuer ?? null,
      oidcSubject: params.oidc?.subject ?? null,
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
    const user = state.users.find((candidate) => candidate.email === email);
    return user
      ? { ...toAuthUser(user), passwordHash: user.passwordHash }
      : null;
  },
  async findUserByOidc({ issuer, subject }) {
    const user = state.users.find(
      (candidate) =>
        candidate.oidcIssuer === issuer && candidate.oidcSubject === subject,
    );
    return user ? toAuthUser(user) : null;
  },
  async setOidcLink(userId, link) {
    const taken = state.users.some(
      (candidate) =>
        candidate.id !== userId &&
        link !== null &&
        candidate.oidcIssuer === link.issuer &&
        candidate.oidcSubject === link.subject,
    );
    if (taken) throw new AuthError("OIDC_ALREADY_LINKED");
    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) throw new AuthError("USER_NOT_FOUND");
    if (link && user.oidcSubject) throw new AuthError("OIDC_ALREADY_LINKED");
    user.oidcIssuer = link?.issuer ?? null;
    user.oidcSubject = link?.subject ?? null;
    return toAuthUser(user);
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
  async changeRequiredPassword(params) {
    const user = state.users.find(
      (candidate) => candidate.id === params.userId,
    );
    if (!user) return null;
    user.passwordHash = params.passwordHash;
    user.passwordChangeRequiredAt = null;
    user.temporaryPasswordIssuedAt = null;
    user.temporaryPasswordIssuedByUserId = null;

    for (const session of state.sessions) {
      if (
        session.user.id === params.userId &&
        !session.revokedAt &&
        session.id !== params.currentSessionId
      ) {
        session.revokedAt = params.now;
      }
    }

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
      deviceName: params.metadata?.deviceName ?? null,
      deviceSessionId: params.metadata?.deviceSessionId ?? null,
      key: null,
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
      (session) =>
        session.user.id === userId &&
        !session.revokedAt &&
        !session.deviceSessionId,
    );
  },
  async revokeSessionById(id, revokedAt) {
    for (const session of state.sessions) {
      if (session.id === id || session.deviceSessionId === id) {
        session.revokedAt = revokedAt;
      }
    }
  },
  async revokeUserSessions(userId, revokedAt) {
    for (const session of state.sessions) {
      if (session.user.id === userId) session.revokedAt = revokedAt;
    }
  },
  async touchSessionLastSeen(id, seenAt, expiresAt) {
    const session = state.sessions.find((candidate) => candidate.id === id);
    if (session) session.lastSeenAt = seenAt;
    if (session && expiresAt) session.expiresAt = expiresAt;
  },
  async savePreferences() {
    return prefs;
  },
});

describe("auth service", () => {
  beforeEach(() => {
    idCounter = 0;
    vi.mocked(ensureUserCommittedStorageDirectories).mockReset();
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

  it("signs in when storage provisioning is unavailable", async () => {
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
    vi.mocked(ensureUserCommittedStorageDirectories).mockReset();
    vi.mocked(ensureUserCommittedStorageDirectories).mockRejectedValueOnce(
      new Error("Storage recovery is required."),
    );

    await expect(
      service.signIn({
        email: "owner@example.com",
        password: "long-owner-password",
      }),
    ).resolves.toMatchObject({ user: { id: bootstrap.user.id } });
    expect(ensureUserCommittedStorageDirectories).not.toHaveBeenCalled();
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
      deviceName: null,
      deviceSessionId: null,
      key: null,
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

  it("changes your own password only with the current one and keeps this browser", async () => {
    const state: State = { users: [], sessions: [] };
    const service = createAuthService({
      repo: createRepo(state),
      now: () => now,
      sessionMaxAgeDays: 30,
    });
    await service.bootstrap({
      instanceName: "Test Staaash",
      email: "owner@example.com",
      password: "long-owner-password",
    });
    const here = await service.signIn({
      email: "owner@example.com",
      password: "long-owner-password",
    });
    await service.signIn({
      email: "owner@example.com",
      password: "long-owner-password",
    });
    const userId = here.user.id;
    const change = {
      password: "brand-new-password",
      confirmPassword: "brand-new-password",
    };

    await expect(
      service.changeOwnPassword(userId, here.session.id, {
        ...change,
        currentPassword: "wrong-password-here",
      }),
    ).rejects.toMatchObject({ code: "CURRENT_PASSWORD_WRONG" });

    await service.changeOwnPassword(userId, here.session.id, {
      ...change,
      currentPassword: "long-owner-password",
    });

    expect(
      (await service.listOwnSessions(userId)).map((session) => session.id),
    ).toEqual([here.session.id]);
    await expect(
      service.signIn({
        email: "owner@example.com",
        password: "brand-new-password",
      }),
    ).resolves.toBeTruthy();
  });

  it("signs out your other devices but never this one or someone else's", async () => {
    const state: State = { users: [], sessions: [] };
    const service = createAuthService({
      repo: createRepo(state),
      now: () => now,
      sessionMaxAgeDays: 30,
    });
    await service.bootstrap({
      instanceName: "Test Staaash",
      email: "owner@example.com",
      password: "long-owner-password",
    });
    const signIn = () =>
      service.signIn({
        email: "owner@example.com",
        password: "long-owner-password",
      });
    const here = await signIn();
    const phone = await signIn();
    const laptop = await signIn();
    const userId = here.user.id;

    await expect(
      service.revokeOwnSessions(
        userId,
        { id: here.session.id, deviceSessionId: null },
        here.session.id,
      ),
    ).rejects.toMatchObject({ code: "CURRENT_SESSION_REVOKE_BLOCKED" });
    await service.revokeOwnSessions(
      "someone-else",
      { id: "x", deviceSessionId: null },
      phone.session.id,
    );
    const ids = async () =>
      (await service.listOwnSessions(userId)).map((session) => session.id);
    expect(await ids()).toContain(phone.session.id);

    await service.revokeOwnSessions(
      userId,
      { id: here.session.id, deviceSessionId: null },
      phone.session.id,
    );
    expect(await ids()).not.toContain(phone.session.id);
    expect(await ids()).toContain(laptop.session.id);

    await service.revokeOwnSessions(userId, {
      id: here.session.id,
      deviceSessionId: null,
    });
    expect(
      (await service.listOwnSessions(userId)).map((session) => session.id),
    ).toEqual([here.session.id]);
  });

  it("keeps a key with no end date alive while it is used, and a dated key to its date", async () => {
    const state: State = { users: [], sessions: [] };
    const service = createAuthService({
      repo: createRepo(state),
      now: () => now,
      sessionMaxAgeDays: 30,
    });
    await service.bootstrap({
      instanceName: "Test Staaash",
      email: "owner@example.com",
      password: "long-owner-password",
    });
    const asKey = async (noEnd: boolean) => {
      const { sessionToken } = await service.signIn({
        email: "owner@example.com",
        password: "long-owner-password",
      });
      const session = state.sessions.at(-1)!;
      const expiresAt = new Date(now.getTime() + 86_400_000);
      Object.assign(session, {
        deviceName: "Key",
        key: { use: "script", readOnly: false, folderId: null, noEnd },
        expiresAt,
      });
      return { sessionToken, expiresAt };
    };

    const open = await asKey(true);
    expect((await service.getSession(open.sessionToken))?.expiresAt).toEqual(
      new Date(now.getTime() + 365 * 86_400_000),
    );
    const dated = await asKey(false);
    expect((await service.getSession(dated.sessionToken))?.expiresAt).toEqual(
      dated.expiresAt,
    );
  });

  it("lets the owner sign out a session only for the user it belongs to", async () => {
    const state: State = { users: [], sessions: [] };
    const service = createAuthService({
      repo: createRepo(state),
      now: () => now,
      sessionMaxAgeDays: 30,
    });
    const owner = await service.bootstrap({
      instanceName: "Test Staaash",
      email: "owner@example.com",
      password: "long-owner-password",
    });
    const here = await service.signIn({
      email: "owner@example.com",
      password: "long-owner-password",
    });
    const member = await service.createUser(owner.user.id, {
      email: "member@example.com",
      temporaryPassword: "long-member-password",
      confirmTemporaryPassword: "long-member-password",
    });
    const memberSession = await service.signIn({
      email: "member@example.com",
      password: "long-member-password",
    });
    const active = async () =>
      (await service.listOwnSessions(member.user.id)).map(
        (session) => session.id,
      );

    await service.revokeUserSession(
      owner.user.id,
      owner.user.id,
      memberSession.session.id,
      here.session.id,
    );
    expect(await active()).toEqual([memberSession.session.id]);

    await service.revokeUserSession(
      owner.user.id,
      member.user.id,
      memberSession.session.id,
      here.session.id,
    );
    expect(await active()).toEqual([]);
  });

  it("changes a required password while preserving only the current session", async () => {
    const alreadyRevokedAt = new Date("2026-06-15T10:00:00.000Z");
    const unchangedUpdatedAt = new Date("2026-06-14T10:00:00.000Z");
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
        makeUser({
          id: "other-1",
          email: "other@example.com",
        }),
      ],
      sessions: [],
    };
    const service = createAuthService({
      repo: createRepo(state),
      now: () => now,
      sessionMaxAgeDays: 30,
    });

    await service.resetTemporaryPassword("owner-1", "member-1", {
      temporaryPassword: "temporary-pass-1",
      confirmTemporaryPassword: "temporary-pass-1",
      requirePasswordChange: true,
    });
    const temporaryPasswordHash = state.users[1]!.passwordHash;
    const sessionA = await service.signIn({
      email: "member@example.com",
      password: "temporary-pass-1",
    });
    const sessionB = await service.signIn({
      email: "member@example.com",
      password: "temporary-pass-1",
    });
    expect(state.users[1]!.passwordChangeRequiredAt).toEqual(now);
    expect(
      state.sessions
        .filter((session) => session.user.id === "member-1")
        .map((session) => session.revokedAt),
    ).toEqual([null, null]);
    const otherUserSession: StoredAuthSession = {
      id: "other-session",
      user: toAuthUser(state.users[2]!),
      tokenHash: "other-token-hash",
      expiresAt: new Date("2026-07-16T10:00:00.000Z"),
      revokedAt: null,
      userAgent: null,
      ipAddress: null,
      deviceName: null,
      deviceSessionId: null,
      key: null,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: unchangedUpdatedAt,
    };
    const alreadyRevokedSession: StoredAuthSession = {
      id: "already-revoked-session",
      user: toAuthUser(state.users[1]!),
      tokenHash: "already-revoked-token-hash",
      expiresAt: new Date("2026-07-16T10:00:00.000Z"),
      revokedAt: alreadyRevokedAt,
      userAgent: null,
      ipAddress: null,
      deviceName: null,
      deviceSessionId: null,
      key: null,
      lastSeenAt: unchangedUpdatedAt,
      createdAt: unchangedUpdatedAt,
      updatedAt: unchangedUpdatedAt,
    };
    state.sessions.push(otherUserSession, alreadyRevokedSession);

    const updated = await service.changeRequiredPassword(
      "member-1",
      sessionA.session.id,
      {
        password: "replacement-pass-1",
        confirmPassword: "replacement-pass-1",
      },
    );

    expect(state.users[1]!.passwordHash).not.toBe(temporaryPasswordHash);
    expect(updated).toMatchObject({
      passwordChangeRequiredAt: null,
      temporaryPasswordIssuedAt: null,
      temporaryPasswordIssuedByUserId: null,
    });
    expect(
      state.sessions.find((session) => session.id === sessionA.session.id)
        ?.revokedAt,
    ).toBeNull();
    expect(
      state.sessions.find((session) => session.id === sessionB.session.id)
        ?.revokedAt,
    ).toEqual(now);
    expect(otherUserSession).toMatchObject({
      revokedAt: null,
      updatedAt: unchangedUpdatedAt,
    });
    expect(alreadyRevokedSession).toMatchObject({
      revokedAt: alreadyRevokedAt,
      lastSeenAt: unchangedUpdatedAt,
      updatedAt: unchangedUpdatedAt,
    });

    await expect(
      service.getSession(sessionA.sessionToken),
    ).resolves.toMatchObject({ id: sessionA.session.id });
    await expect(service.getSession(sessionB.sessionToken)).resolves.toBeNull();
    await expect(
      service.signIn({
        email: "member@example.com",
        password: "temporary-pass-1",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(
      service.signIn({
        email: "member@example.com",
        password: "replacement-pass-1",
      }),
    ).resolves.toMatchObject({ user: { id: "member-1" } });
  });

  it("does not change the password or revoke sessions when no change is required", async () => {
    const member = makeUser({
      id: "member-1",
      email: "member@example.com",
      passwordHash: "unchanged-password-hash",
    });
    const state: State = {
      users: [member],
      sessions: [
        {
          id: "session-a",
          user: toAuthUser(member),
          tokenHash: "token-a",
          expiresAt: new Date("2026-07-16T10:00:00.000Z"),
          revokedAt: null,
          userAgent: null,
          ipAddress: null,
          deviceName: null,
          deviceSessionId: null,
          key: null,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "session-b",
          user: toAuthUser(member),
          tokenHash: "token-b",
          expiresAt: new Date("2026-07-16T10:00:00.000Z"),
          revokedAt: null,
          userAgent: null,
          ipAddress: null,
          deviceName: null,
          deviceSessionId: null,
          key: null,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    const service = createAuthService({
      repo: createRepo(state),
      now: () => now,
      sessionMaxAgeDays: 30,
    });

    const result = await service.changeRequiredPassword(
      "member-1",
      "session-a",
      {
        password: "replacement-pass-1",
        confirmPassword: "replacement-pass-1",
      },
    );

    expect(result.id).toBe("member-1");
    expect(member.passwordHash).toBe("unchanged-password-hash");
    expect(state.sessions.map((session) => session.revokedAt)).toEqual([
      null,
      null,
    ]);
  });

  it("preserves required password change validation and missing-user errors", async () => {
    const member = makeUser({
      id: "member-1",
      passwordHash: "unchanged-password-hash",
      passwordChangeRequiredAt: now,
      temporaryPasswordIssuedAt: now,
      temporaryPasswordIssuedByUserId: "owner-1",
    });
    const state: State = { users: [member], sessions: [] };
    const service = createAuthService({
      repo: createRepo(state),
      now: () => now,
      sessionMaxAgeDays: 30,
    });

    await expect(
      service.changeRequiredPassword("member-1", "session-a", {
        password: "short",
        confirmPassword: "short",
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
    await expect(
      service.changeRequiredPassword("member-1", "session-a", {
        password: "replacement-pass-1",
        confirmPassword: "different-pass-12",
      }),
    ).rejects.toMatchObject({ code: "PASSWORD_CONFIRMATION_MISMATCH" });
    await expect(
      service.changeRequiredPassword("missing-user", "session-a", {
        password: "replacement-pass-1",
        confirmPassword: "replacement-pass-1",
      }),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    expect(member.passwordHash).toBe("unchanged-password-hash");
    expect(member.passwordChangeRequiredAt).toEqual(now);
  });
});

describe("single sign-on", () => {
  const oidc: OidcEnv = {
    issuer: "https://id.example.com",
    clientId: "staaash",
    clientSecret: null,
    providerName: "Pocket ID",
    autoRegister: false,
    defaultStorageLimitBytes: null,
    adminGroup: null,
    passwordLogin: true,
    startUrl: "https://drive.example.com/api/auth/oidc/start",
    callbackUrl: "https://drive.example.com/api/auth/oidc/callback",
  };
  const identity = (subject = "sub-1", overrides = {}) => ({
    issuer: oidc.issuer,
    subject,
    email: "partner@example.com" as string | null,
    name: "Partner",
    groups: [] as string[],
    ...overrides,
  });
  const linkedTo = (subject: string) => ({
    oidcIssuer: oidc.issuer,
    oidcSubject: subject,
  });
  const setup = (users: FakeUser[] = [], config: Partial<OidcEnv> = {}) => {
    const state: State = {
      users: [
        makeUser({ id: "owner-1", email: "owner@example.com", isOwner: true }),
        ...users,
      ],
      sessions: [],
    };
    const service = createAuthService({
      repo: createRepo(state),
      now: () => now,
      sessionMaxAgeDays: 30,
      oidc: { ...oidc, ...config },
    });
    const user = (id: string) => state.users.find((u) => u.id === id)!;
    return { state, service, user };
  };

  beforeEach(() => {
    idCounter = 0;
    vi.mocked(ensureUserCommittedStorageDirectories).mockReset();
  });

  it("turns away someone with no account, and never links by email", async () => {
    const { service, user } = setup([
      makeUser({ id: "partner", email: "partner@example.com" }),
    ]);

    await expect(
      service.signInWithOidc(identity(), null),
    ).rejects.toMatchObject({ code: "OIDC_CONNECT_FIRST" });
    expect(user("partner").oidcSubject).toBeNull();
    await expect(
      service.signInWithOidc(
        identity("sub-2", { email: "else@example.com" }),
        null,
      ),
    ).rejects.toMatchObject({ code: "OIDC_NOT_INVITED" });
  });

  it("links an invited account once, then signs in by issuer and subject", async () => {
    const { service, user } = setup([
      makeUser({ id: "partner", passwordHash: null }),
    ]);

    const first = await service.signInWithOidc(
      identity("sub-1", { email: "a-different-email@example.com" }),
      "partner",
    );
    expect(first.user).toMatchObject({ id: "partner", oidcLinked: true });
    expect(user("partner")).toMatchObject(linkedTo("sub-1"));

    const again = await service.signInWithOidc(identity(), null);
    expect(again.user.id).toBe("partner");
    await expect(
      service.signInWithOidc(identity("sub-2"), "partner"),
    ).rejects.toMatchObject({ code: "OIDC_INVITE_INVALID" });
  });

  it("does not move an identity that is linked to someone else", async () => {
    const { service } = setup([
      makeUser({ id: "a", email: "a@example.com", ...linkedTo("sub-1") }),
      makeUser({ id: "b", email: "b@example.com", passwordHash: null }),
    ]);

    await expect(service.signInWithOidc(identity(), "b")).rejects.toMatchObject(
      { code: "OIDC_ALREADY_LINKED" },
    );
    await expect(service.connectOidc("b", identity())).rejects.toMatchObject({
      code: "OIDC_ALREADY_LINKED",
    });
  });

  it("creates a member on first sign-in when auto create is on", async () => {
    const { service, state } = setup([], {
      autoRegister: true,
      defaultStorageLimitBytes: 5n,
    });

    const result = await service.signInWithOidc(identity(), null);

    expect(result.user).toMatchObject({
      email: "partner@example.com",
      displayName: "Partner",
      role: "member",
      storageLimitBytes: 5n,
      hasPassword: false,
      oidcLinked: true,
    });
    expect(state.users).toHaveLength(2);
    expect(ensureUserCommittedStorageDirectories).toHaveBeenCalledWith(
      result.user.storageId,
    );
    await expect(
      service.signInWithOidc(identity("sub-2", { email: null }), null),
    ).rejects.toMatchObject({ code: "OIDC_EMAIL_REQUIRED" });
  });

  it("follows the admin group on every sign-in, except for the owner", async () => {
    const { service, user } = setup(
      [
        makeUser({ id: "partner", ...linkedTo("sub-1") }),
        makeUser({
          id: "owner-2",
          email: "o@example.com",
          isOwner: true,
          ...linkedTo("sub-owner"),
        }),
      ],
      { adminGroup: "staaash-admins" },
    );

    await service.signInWithOidc(
      identity("sub-1", { groups: ["staaash-admins"] }),
      null,
    );
    expect(user("partner")).toMatchObject({ isAdmin: true, role: "admin" });
    await service.signInWithOidc(identity("sub-1"), null);
    expect(user("partner")).toMatchObject({ isAdmin: false, role: "member" });
    await service.signInWithOidc(identity("sub-owner"), null);
    expect(user("owner-2")).toMatchObject({ isAdmin: true, role: "owner" });
  });

  it("keeps an account with no password out of the password form", async () => {
    const { service } = setup([
      makeUser({ email: "partner@example.com", passwordHash: null }),
    ]);

    await expect(
      service.signIn({
        email: "partner@example.com",
        password: "anything-long",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("with passwords off, invites through the provider and refuses password changes", async () => {
    const { service } = setup(
      [makeUser({ id: "member", email: "member@example.com" })],
      { passwordLogin: false },
    );

    await expect(
      service.signIn({ email: "owner@example.com", password: "long-password" }),
    ).rejects.toMatchObject({ code: "PASSWORD_LOGIN_DISABLED" });
    await expect(
      service.createUser("owner-1", {
        email: "new@example.com",
        generateTemporaryPassword: true,
      }),
    ).resolves.toMatchObject({
      temporaryPassword: null,
      user: { hasPassword: false, oidcLinked: false },
    });
    await expect(
      service.resetTemporaryPassword("owner-1", "member", {
        generateTemporaryPassword: true,
      }),
    ).rejects.toMatchObject({ code: "PASSWORD_LOGIN_DISABLED" });
    await expect(
      service.changeOwnPassword("member", "session", {
        currentPassword: "x",
        password: "a-new-long-password",
        confirmPassword: "a-new-long-password",
      }),
    ).rejects.toMatchObject({ code: "PASSWORD_LOGIN_DISABLED" });
  });

  it("with passwords off, a leftover temporary password owes no change", async () => {
    const { service } = setup(
      [
        makeUser({
          id: "member",
          email: "member@example.com",
          passwordChangeRequiredAt: now,
          ...linkedTo("sub-1"),
        }),
      ],
      { passwordLogin: false },
    );

    const result = await service.signInWithOidc(identity(), null);
    expect(result.user.passwordChangeRequiredAt).toBeNull();
    await expect(
      service.getSession(result.sessionToken),
    ).resolves.toMatchObject({ user: { passwordChangeRequiredAt: null } });
    await expect(
      service.changeRequiredPassword("member", result.session.id, {
        password: "a-new-long-password",
        confirmPassword: "a-new-long-password",
      }),
    ).rejects.toMatchObject({ code: "PASSWORD_LOGIN_DISABLED" });
  });

  it("does not replace a connected identity with another", async () => {
    const { service, user } = setup([
      makeUser({ id: "partner", ...linkedTo("sub-1") }),
    ]);

    await expect(
      service.connectOidc("partner", identity("sub-2")),
    ).rejects.toMatchObject({ code: "OIDC_ALREADY_LINKED" });
    expect(user("partner").oidcSubject).toBe("sub-1");
  });

  it("disconnects only while a password still lets you back in", async () => {
    const { service, user } = setup([
      makeUser({ id: "no-password", passwordHash: null, ...linkedTo("sub-1") }),
      makeUser({ id: "with-password", email: "b@x.com", ...linkedTo("sub-2") }),
    ]);

    await expect(
      service.disconnectOwnOidc("no-password"),
    ).rejects.toMatchObject({ code: "OIDC_LAST_SIGN_IN" });
    await service.disconnectOwnOidc("with-password");
    expect(user("with-password").oidcSubject).toBeNull();
    // The owner can, and a new invite link connects them again.
    await service.disconnectUserOidc("owner-1", "no-password");
    expect(user("no-password").oidcSubject).toBeNull();
    await expect(
      service.requireOidcInvitable("owner-1", "no-password"),
    ).resolves.toMatchObject({ id: "no-password" });
  });

  it("keeps the owner from disconnecting their own last way in", async () => {
    const { service, state, user } = setup([], { passwordLogin: false });
    Object.assign(state.users[0]!, linkedTo("sub-owner"));

    await expect(
      service.disconnectUserOidc("owner-1", "owner-1"),
    ).rejects.toMatchObject({ code: "OIDC_LAST_SIGN_IN" });
    expect(user("owner-1").oidcSubject).toBe("sub-owner");
  });
});
