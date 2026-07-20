import { randomInt } from "node:crypto";

import { canAccessAdminSurface } from "@/server/access";
import {
  authCrypto,
  getAuthSecret,
  type AuthCrypto,
} from "@/server/auth/crypto";
import { AuthError } from "@/server/auth/errors";
import {
  adminCreateUserInputSchema,
  adminUpdateUserInputSchema,
  bootstrapInputSchema,
  requiredPasswordChangeInputSchema,
  signInInputSchema,
  temporaryPasswordInputSchema,
} from "@/server/auth/schema";
import type {
  AdminCreateUserInput,
  AdminUpdateUserInput,
  AuthSession,
  AuthUser,
  BootstrapInput,
  SessionMetadata,
  SetupState,
  SignInInput,
  TemporaryPasswordInput,
  TemporaryPasswordResult,
} from "@/server/auth/types";
import { getSystemSettings } from "@/server/settings";
import { ensureUserCommittedStorageDirectories } from "@/server/storage";

import type { AuthRepository } from "./repository";

type AuthResult = {
  session: AuthSession;
  sessionToken: string;
  user: AuthUser;
};

type CreateAuthServiceOptions = {
  repo?: AuthRepository;
  crypto?: AuthCrypto;
  now?: () => Date;
  sessionMaxAgeDays?: number;
};

const TEMP_PASSWORD_SYMBOLS = "!@#$%?*-_";
const TEMP_PASSWORD_ALPHABET =
  "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789" +
  TEMP_PASSWORD_SYMBOLS;

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const generateTokenFromAlphabet = (length: number, alphabet: string) => {
  let value = "";

  for (let i = 0; i < length; i += 1) {
    value += alphabet[randomInt(alphabet.length)]!;
  }

  return value;
};

const shuffle = (value: string) => {
  const chars = [...value];

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }

  return chars.join("");
};

const getEmailStorageBase = (email: string) => {
  const localPart = email.split("@")[0] ?? "";
  const sanitized = localPart
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");

  return sanitized.length > 0 ? sanitized : "user";
};

const generateStorageId = (email: string, attempt = 0) => {
  const base = getEmailStorageBase(email);
  return attempt === 0
    ? base
    : `${base}-${generateTokenFromAlphabet(6, "abcdefghijklmnopqrstuvwxyz0123456789")}`;
};

export const generateTemporaryPassword = () =>
  shuffle(
    [
      generateTokenFromAlphabet(1, "abcdefghijkmnopqrstuvwxyz"),
      generateTokenFromAlphabet(1, "ABCDEFGHJKLMNPQRSTUVWXYZ"),
      generateTokenFromAlphabet(1, "23456789"),
      generateTokenFromAlphabet(1, TEMP_PASSWORD_SYMBOLS),
      generateTokenFromAlphabet(8, TEMP_PASSWORD_ALPHABET),
    ].join(""),
  );

const normalizeTemporaryPasswordInput = (
  input: TemporaryPasswordInput,
): { password: string; requirePasswordChange: boolean } => {
  const parsed = temporaryPasswordInputSchema.parse(input);
  const password = parsed.generateTemporaryPassword
    ? generateTemporaryPassword()
    : (parsed.temporaryPassword ?? "");

  if (password.length < 12 || password.length > 128) {
    throw new AuthError(
      "PASSWORD_INVALID",
      "Temporary password must be 12-128 characters.",
    );
  }

  if (
    !parsed.generateTemporaryPassword &&
    password !== parsed.confirmTemporaryPassword
  ) {
    throw new AuthError("PASSWORD_CONFIRMATION_MISMATCH");
  }

  return {
    password,
    requirePasswordChange: parsed.requirePasswordChange ?? true,
  };
};

export const createAuthService = ({
  repo,
  crypto = authCrypto,
  now = () => new Date(),
  sessionMaxAgeDays,
}: CreateAuthServiceOptions = {}) => {
  const resolveRepo = async (): Promise<AuthRepository> =>
    repo ?? (await import("./repository")).prismaAuthRepository;

  const resolveSettings = async () => {
    const s = await getSystemSettings();
    return {
      sessionMaxAgeDays: sessionMaxAgeDays ?? s.sessionMaxAgeDays,
    };
  };

  const requireAdmin = async (actorUserId: string) => {
    const activeRepo = await resolveRepo();
    const actor = await activeRepo.findUserById(actorUserId);

    if (!actor || !canAccessAdminSurface(actor.role)) {
      throw new AuthError("ACCESS_DENIED");
    }

    return actor;
  };

  const requireOwner = async (actorUserId: string) => {
    const actor = await requireAdmin(actorUserId);

    if (!actor.isOwner) {
      throw new AuthError("ACCESS_DENIED", "Owner access required.");
    }

    return actor;
  };

  const createSessionForUser = async (
    user: AuthUser,
    metadata?: SessionMetadata,
  ): Promise<AuthResult> => {
    const issuedAt = now();
    await getAuthSecret();
    const tokenPair = crypto.issueOpaqueToken();
    const activeRepo = await resolveRepo();
    const { sessionMaxAgeDays: maxDays } = await resolveSettings();
    const session = await activeRepo.createSession({
      userId: user.id,
      tokenHash: tokenPair.tokenHash,
      expiresAt: addDays(issuedAt, maxDays),
      metadata,
      now: issuedAt,
    });

    return {
      session,
      sessionToken: tokenPair.token,
      user: session.user,
    };
  };

  const createUserWithStorageId = async (
    params: Omit<AdminCreateUserInput, "temporaryPassword"> & {
      passwordHash: string;
      temporaryPasswordIssuedAt: Date;
      temporaryPasswordIssuedByUserId: string;
      passwordChangeRequiredAt: Date | null;
    },
  ) => {
    const activeRepo = await resolveRepo();
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await activeRepo.createUser({
          email: params.email,
          storageId: generateStorageId(params.email, attempt),
          passwordHash: params.passwordHash,
          isAdmin: params.isAdmin ?? false,
          storageLimitBytes: params.storageLimitBytes ?? null,
          passwordChangeRequiredAt: params.passwordChangeRequiredAt,
          temporaryPasswordIssuedAt: params.temporaryPasswordIssuedAt,
          temporaryPasswordIssuedByUserId:
            params.temporaryPasswordIssuedByUserId,
        });
      } catch (error) {
        if (
          error instanceof AuthError &&
          error.code === "STORAGE_ID_COLLISION"
        ) {
          lastError = error;
          continue;
        }

        throw error;
      }
    }

    throw lastError ?? new AuthError("STORAGE_ID_COLLISION");
  };

  return {
    async getSetupState(): Promise<SetupState> {
      return (await resolveRepo()).getSetupState();
    },

    async bootstrap(
      input: BootstrapInput,
      metadata?: SessionMetadata,
    ): Promise<AuthResult> {
      const parsed = bootstrapInputSchema.parse(input);
      const activeRepo = await resolveRepo();
      const setupState = await activeRepo.getSetupState();

      if (setupState.isBootstrapped) {
        throw new AuthError("SETUP_ALREADY_COMPLETED");
      }

      const createdAt = now();
      const passwordHash = await crypto.hashPassword(parsed.password);
      const user = await activeRepo.createBootstrap({
        instanceName: parsed.instanceName,
        email: parsed.email,
        storageId: generateStorageId(parsed.email),
        displayName: parsed.displayName,
        passwordHash,
        createdAt,
      });

      await ensureUserCommittedStorageDirectories(user.storageId);
      return createSessionForUser(user, metadata);
    },

    async signIn(
      input: SignInInput,
      metadata?: SessionMetadata,
    ): Promise<AuthResult> {
      const parsed = signInInputSchema.parse(input);
      const activeRepo = await resolveRepo();
      const setupState = await activeRepo.getSetupState();

      if (!setupState.isBootstrapped) {
        throw new AuthError("SETUP_REQUIRED");
      }

      const user = await activeRepo.findUserByEmail(parsed.email);

      if (
        !user ||
        !(await crypto.verifyPassword(parsed.password, user.passwordHash))
      ) {
        throw new AuthError("INVALID_CREDENTIALS");
      }

      return createSessionForUser(user, metadata);
    },

    async getSession(rawToken: string | null | undefined) {
      if (!rawToken) {
        return null;
      }

      await getAuthSecret();
      const tokenHash = crypto.hashOpaqueToken(rawToken);
      const activeRepo = await resolveRepo();
      const session = await activeRepo.findSessionByTokenHash(tokenHash);

      if (!session) {
        return null;
      }

      const seenAt = now();

      if (session.revokedAt || session.expiresAt <= seenAt) {
        if (!session.revokedAt) {
          await activeRepo.revokeSessionById(session.id, seenAt);
        }

        return null;
      }

      await activeRepo.touchSessionLastSeen(session.id, seenAt);

      return {
        id: session.id,
        expiresAt: session.expiresAt,
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
        lastSeenAt: seenAt,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        user: session.user,
      };
    },

    async revokeSession(rawToken: string | null | undefined) {
      if (!rawToken) {
        return;
      }

      const tokenHash = crypto.hashOpaqueToken(rawToken);
      const activeRepo = await resolveRepo();
      const session = await activeRepo.findSessionByTokenHash(tokenHash);

      if (session && !session.revokedAt) {
        await activeRepo.revokeSessionById(session.id, now());
      }
    },

    async listUsers(actorUserId: string) {
      await requireAdmin(actorUserId);
      return (await resolveRepo()).listUsers();
    },

    async getUser(actorUserId: string, targetUserId: string) {
      await requireAdmin(actorUserId);
      const user = await (await resolveRepo()).findUserById(targetUserId);

      if (!user) {
        throw new AuthError("USER_NOT_FOUND");
      }

      return user;
    },

    async listUserSessions(actorUserId: string, targetUserId: string) {
      await requireAdmin(actorUserId);
      const user = await (await resolveRepo()).findUserById(targetUserId);

      if (!user) {
        throw new AuthError("USER_NOT_FOUND");
      }

      return (await resolveRepo()).listUserSessions(targetUserId);
    },

    async createUser(
      actorUserId: string,
      input: AdminCreateUserInput,
    ): Promise<TemporaryPasswordResult> {
      await requireOwner(actorUserId);
      const parsed = adminCreateUserInputSchema.parse(input);

      if (await (await resolveRepo()).findUserByEmail(parsed.email)) {
        throw new AuthError("USER_ALREADY_EXISTS");
      }

      const { password, requirePasswordChange } =
        normalizeTemporaryPasswordInput(parsed);
      const issuedAt = now();
      const passwordHash = await crypto.hashPassword(password);
      const user = await createUserWithStorageId({
        email: parsed.email,
        passwordHash,
        isAdmin: parsed.isAdmin ?? false,
        storageLimitBytes: parsed.storageLimitBytes,
        temporaryPasswordIssuedAt: issuedAt,
        temporaryPasswordIssuedByUserId: actorUserId,
        passwordChangeRequiredAt: requirePasswordChange ? issuedAt : null,
      });

      await ensureUserCommittedStorageDirectories(user.storageId);

      return {
        user,
        temporaryPassword: password,
      };
    },

    async updateUser(
      actorUserId: string,
      targetUserId: string,
      input: AdminUpdateUserInput,
    ) {
      await requireOwner(actorUserId);
      const activeRepo = await resolveRepo();
      const existing = await activeRepo.findUserById(targetUserId);

      if (!existing) {
        throw new AuthError("USER_NOT_FOUND");
      }

      const parsed = adminUpdateUserInputSchema.parse(input);
      const user = await activeRepo.updateUser({
        userId: targetUserId,
        email: parsed.email,
        displayName: parsed.displayName,
        storageLimitBytes: parsed.storageLimitBytes,
        isAdmin: existing.isOwner ? true : parsed.isAdmin,
      });

      if (!user) {
        throw new AuthError("USER_NOT_FOUND");
      }

      return user;
    },

    async setStorageLimit(
      actorUserId: string,
      targetUserId: string,
      limitBytes: bigint | null,
    ) {
      await requireOwner(actorUserId);
      const activeRepo = await resolveRepo();
      const user = await activeRepo.setUserStorageLimit(
        targetUserId,
        limitBytes,
      );
      if (!user) {
        throw new AuthError("USER_NOT_FOUND");
      }
      return user;
    },

    async resetTemporaryPassword(
      actorUserId: string,
      targetUserId: string,
      input: TemporaryPasswordInput,
    ): Promise<TemporaryPasswordResult> {
      await requireOwner(actorUserId);
      const activeRepo = await resolveRepo();
      const existing = await activeRepo.findUserById(targetUserId);

      if (!existing) {
        throw new AuthError("USER_NOT_FOUND");
      }

      const { password, requirePasswordChange } =
        normalizeTemporaryPasswordInput(input);
      const passwordHash = await crypto.hashPassword(password);
      const user = await activeRepo.setTemporaryPassword({
        userId: targetUserId,
        issuedByUserId: actorUserId,
        passwordHash,
        requirePasswordChange,
        now: now(),
      });

      return {
        user,
        temporaryPassword: password,
      };
    },

    async changeRequiredPassword(
      userId: string,
      currentSessionId: string,
      input: { password: string; confirmPassword: string },
    ) {
      const parsed = requiredPasswordChangeInputSchema.parse(input);

      if (parsed.password !== parsed.confirmPassword) {
        throw new AuthError("PASSWORD_CONFIRMATION_MISMATCH");
      }

      const activeRepo = await resolveRepo();
      const user = await activeRepo.findUserById(userId);

      if (!user) {
        throw new AuthError("USER_NOT_FOUND");
      }

      if (!user.passwordChangeRequiredAt) {
        return user;
      }

      const passwordHash = await crypto.hashPassword(parsed.password);
      const updated = await activeRepo.changeRequiredPassword({
        userId,
        currentSessionId,
        passwordHash,
        now: now(),
      });

      if (!updated) {
        throw new AuthError("USER_NOT_FOUND");
      }

      return updated;
    },

    async revokeUserSession(
      actorUserId: string,
      targetUserId: string,
      sessionId: string,
      currentSessionId: string,
    ) {
      await requireOwner(actorUserId);

      if (sessionId === currentSessionId) {
        throw new AuthError("CURRENT_SESSION_REVOKE_BLOCKED");
      }

      const activeRepo = await resolveRepo();
      const user = await activeRepo.findUserById(targetUserId);

      if (!user) {
        throw new AuthError("USER_NOT_FOUND");
      }

      await activeRepo.revokeSessionById(sessionId, now());
    },

    async revokeAllUserSessions(
      actorUserId: string,
      targetUserId: string,
      currentSessionId: string,
    ) {
      await requireOwner(actorUserId);
      const activeRepo = await resolveRepo();
      const sessions = await activeRepo.listUserSessions(targetUserId);

      if (sessions.some((session) => session.id === currentSessionId)) {
        throw new AuthError("CURRENT_SESSION_REVOKE_BLOCKED");
      }

      await activeRepo.revokeUserSessions(targetUserId, now());
    },

    async savePreferences(
      userId: string,
      prefs: {
        theme: string;
        timeZone: string;
        showUpdateNotifications: boolean;
        enableVersionChecks: boolean;
        displayName?: string | null;
        avatarUrl?: string | null;
      },
    ) {
      return (await resolveRepo()).savePreferences({
        userId,
        theme: prefs.theme,
        timeZone: prefs.timeZone,
        showUpdateNotifications: prefs.showUpdateNotifications,
        enableVersionChecks: prefs.enableVersionChecks,
        displayName: prefs.displayName,
        avatarUrl: prefs.avatarUrl,
        onboardingCompletedAt: new Date(),
      });
    },
  };
};

export const authService = createAuthService();
