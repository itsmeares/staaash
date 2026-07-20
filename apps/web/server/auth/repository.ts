import { randomBytes } from "node:crypto";

import {
  Prisma,
  getPrisma,
  type Session,
  type User,
  type UserPreference,
} from "@staaash/db/client";

import { AuthError } from "@/server/auth/errors";
import type {
  AuthSession,
  AuthUser,
  SessionMetadata,
  SetupState,
  StoredAuthSession,
  StoredAuthUser,
  UserPreferences,
} from "@/server/auth/types";

type CreateBootstrapParams = {
  instanceName: string;
  email: string;
  storageId: string;
  displayName?: string;
  passwordHash: string;
  createdAt: Date;
};

type CreateUserParams = {
  email: string;
  storageId: string;
  passwordHash: string;
  isAdmin: boolean;
  storageLimitBytes: bigint | null;
  passwordChangeRequiredAt: Date | null;
  temporaryPasswordIssuedAt: Date;
  temporaryPasswordIssuedByUserId: string;
};

type UpdateUserParams = {
  userId: string;
  email?: string;
  displayName?: string | null;
  storageLimitBytes?: bigint | null;
  isAdmin?: boolean;
};

type CreateSessionParams = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  metadata?: SessionMetadata;
  now: Date;
};

type SetTemporaryPasswordParams = {
  userId: string;
  issuedByUserId: string;
  passwordHash: string;
  requirePasswordChange: boolean;
  now: Date;
};

type ChangeRequiredPasswordParams = {
  userId: string;
  currentSessionId: string;
  passwordHash: string;
  now: Date;
};

type SavePreferencesParams = {
  userId: string;
  theme: string;
  timeZone: string;
  showUpdateNotifications: boolean;
  enableVersionChecks: boolean;
  onboardingCompletedAt?: Date;
  displayName?: string | null;
  avatarUrl?: string | null;
};

type AuthPrismaClient = Pick<
  ReturnType<typeof getPrisma>,
  "folder" | "instance" | "session" | "user" | "userPreference" | "$transaction"
>;

export type AuthRepository = {
  getSetupState(): Promise<SetupState>;
  createBootstrap(params: CreateBootstrapParams): Promise<AuthUser>;
  createUser(params: CreateUserParams): Promise<AuthUser>;
  updateUser(params: UpdateUserParams): Promise<AuthUser | null>;
  findUserByEmail(email: string): Promise<StoredAuthUser | null>;
  findUserById(id: string): Promise<AuthUser | null>;
  listUsers(): Promise<AuthUser[]>;
  setUserStorageLimit(
    userId: string,
    limitBytes: bigint | null,
  ): Promise<AuthUser | null>;
  setTemporaryPassword(params: SetTemporaryPasswordParams): Promise<AuthUser>;
  changeRequiredPassword(
    params: ChangeRequiredPasswordParams,
  ): Promise<AuthUser | null>;
  createSession(params: CreateSessionParams): Promise<AuthSession>;
  findSessionByTokenHash(tokenHash: string): Promise<StoredAuthSession | null>;
  listUserSessions(userId: string): Promise<AuthSession[]>;
  revokeSessionById(id: string, revokedAt: Date): Promise<void>;
  revokeUserSessions(userId: string, revokedAt: Date): Promise<void>;
  touchSessionLastSeen(id: string, seenAt: Date): Promise<void>;
  savePreferences(params: SavePreferencesParams): Promise<UserPreferences>;
};

const toUserRole = (user: Pick<User, "isOwner" | "isAdmin">) =>
  user.isOwner ? "owner" : user.isAdmin ? "admin" : "member";

const toAuthUser = (
  user: Pick<
    User,
    | "id"
    | "email"
    | "storageId"
    | "displayName"
    | "avatarUrl"
    | "isOwner"
    | "isAdmin"
    | "passwordChangeRequiredAt"
    | "temporaryPasswordIssuedAt"
    | "temporaryPasswordIssuedByUserId"
    | "storageLimitBytes"
    | "createdAt"
    | "updatedAt"
  > & { preferences?: UserPreference | null },
): AuthUser => ({
  id: user.id,
  email: user.email,
  storageId: user.storageId,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl,
  isOwner: user.isOwner,
  isAdmin: user.isAdmin,
  role: toUserRole(user),
  passwordChangeRequiredAt: user.passwordChangeRequiredAt,
  temporaryPasswordIssuedAt: user.temporaryPasswordIssuedAt,
  temporaryPasswordIssuedByUserId: user.temporaryPasswordIssuedByUserId,
  storageLimitBytes: user.storageLimitBytes,
  preferences: user.preferences
    ? {
        theme: user.preferences.theme,
        timeZone: user.preferences.timeZone,
        showUpdateNotifications: user.preferences.showUpdateNotifications,
        enableVersionChecks: user.preferences.enableVersionChecks,
        onboardingCompletedAt: user.preferences.onboardingCompletedAt,
      }
    : null,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const toStoredAuthUser = (
  user: User & { preferences?: UserPreference | null },
): StoredAuthUser => ({
  ...toAuthUser(user),
  passwordHash: user.passwordHash,
});

const toAuthSession = (
  session: Session & { user: User & { preferences?: UserPreference | null } },
): AuthSession => ({
  id: session.id,
  expiresAt: session.expiresAt,
  userAgent: session.userAgent,
  ipAddress: session.ipAddress,
  lastSeenAt: session.lastSeenAt,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  user: toAuthUser(session.user),
});

const toStoredAuthSession = (
  session: Session & { user: User & { preferences?: UserPreference | null } },
): StoredAuthSession => ({
  ...toAuthSession(session),
  tokenHash: session.tokenHash,
  revokedAt: session.revokedAt,
});

const isUniqueConstraintError = (error: unknown) => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  return error.code === "P2002";
};

const getUniqueConstraintTargets = (error: unknown): string[] => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return [];
  }

  if (error.code !== "P2002") {
    return [];
  }

  const target = error.meta?.target;

  if (Array.isArray(target)) {
    return target.filter((value): value is string => typeof value === "string");
  }

  return typeof target === "string" ? [target] : [];
};

const mapUniqueError = (error: unknown) => {
  if (!isUniqueConstraintError(error)) return null;

  const targets = getUniqueConstraintTargets(error);

  if (targets.includes("storageId")) {
    return new AuthError("STORAGE_ID_COLLISION");
  }

  return new AuthError("USER_ALREADY_EXISTS");
};

const createPrismaAuthRepository = (
  client?: AuthPrismaClient,
): AuthRepository => {
  const getClient = () =>
    client ?? (getPrisma() as unknown as AuthPrismaClient);

  return {
    async getSetupState() {
      const client = getClient();
      const [instance, owner] = await Promise.all([
        client.instance.findUnique({
          where: {
            id: "singleton",
          },
        }),
        client.user.findFirst({
          where: {
            isOwner: true,
          },
          select: {
            id: true,
          },
        }),
      ]);

      return {
        isBootstrapped: instance !== null || owner !== null,
        instanceName: instance?.name ?? null,
      };
    },

    async createBootstrap(params) {
      const client = getClient();

      try {
        return await client.$transaction(
          async (tx: Prisma.TransactionClient) => {
            await tx.instance.create({
              data: {
                id: "singleton",
                name: params.instanceName,
                authSecret: randomBytes(32).toString("hex"),
                setupCompletedAt: params.createdAt,
              },
            });

            const user = await tx.user.create({
              data: {
                email: params.email,
                storageId: params.storageId,
                displayName: params.displayName ?? null,
                passwordHash: params.passwordHash,
                isOwner: true,
                isAdmin: true,
              },
            });

            await tx.folder.create({
              data: {
                ownerUserId: user.id,
                name: "Files",
                isFilesRoot: true,
              },
              select: {
                id: true,
              },
            });

            return toAuthUser(user);
          },
        );
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new AuthError("SETUP_ALREADY_COMPLETED");
        }

        throw error;
      }
    },

    async createUser(params) {
      const client = getClient();

      try {
        return await client.$transaction(
          async (tx: Prisma.TransactionClient) => {
            const user = await tx.user.create({
              data: {
                email: params.email,
                storageId: params.storageId,
                passwordHash: params.passwordHash,
                isAdmin: params.isAdmin,
                storageLimitBytes: params.storageLimitBytes,
                passwordChangeRequiredAt: params.passwordChangeRequiredAt,
                temporaryPasswordIssuedAt: params.temporaryPasswordIssuedAt,
                temporaryPasswordIssuedByUserId:
                  params.temporaryPasswordIssuedByUserId,
              },
            });

            await tx.folder.create({
              data: {
                ownerUserId: user.id,
                name: "Files",
                isFilesRoot: true,
              },
              select: {
                id: true,
              },
            });

            return toAuthUser(user);
          },
        );
      } catch (error) {
        const authError = mapUniqueError(error);
        if (authError) throw authError;
        throw error;
      }
    },

    async updateUser(params) {
      const client = getClient();

      try {
        const user = await client.user.update({
          where: { id: params.userId },
          data: {
            ...(params.email !== undefined ? { email: params.email } : {}),
            ...(params.displayName !== undefined
              ? { displayName: params.displayName || null }
              : {}),
            ...(params.storageLimitBytes !== undefined
              ? { storageLimitBytes: params.storageLimitBytes }
              : {}),
            ...(params.isAdmin !== undefined
              ? { isAdmin: params.isAdmin }
              : {}),
          },
          include: {
            preferences: true,
          },
        });

        return toAuthUser(user);
      } catch (error) {
        const authError = mapUniqueError(error);
        if (authError) throw authError;

        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          return null;
        }

        throw error;
      }
    },

    async findUserByEmail(email) {
      const client = getClient();
      const user = await client.user.findUnique({
        where: {
          email,
        },
        include: {
          preferences: true,
        },
      });

      return user ? toStoredAuthUser(user) : null;
    },

    async findUserById(id) {
      const client = getClient();
      const user = await client.user.findUnique({
        where: {
          id,
        },
        include: {
          preferences: true,
        },
      });

      return user ? toAuthUser(user) : null;
    },

    async listUsers() {
      const client = getClient();
      const users = await client.user.findMany({
        orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
        include: {
          preferences: true,
        },
      });

      return users.map(toAuthUser);
    },

    async setUserStorageLimit(userId, limitBytes) {
      const client = getClient();

      try {
        const user = await client.user.update({
          where: { id: userId },
          data: { storageLimitBytes: limitBytes },
          include: {
            preferences: true,
          },
        });

        return toAuthUser(user);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          return null;
        }

        throw error;
      }
    },

    async setTemporaryPassword(params) {
      const client = getClient();

      try {
        return await client.$transaction(
          async (tx: Prisma.TransactionClient) => {
            const user = await tx.user.update({
              where: { id: params.userId },
              data: {
                passwordHash: params.passwordHash,
                passwordChangeRequiredAt: params.requirePasswordChange
                  ? params.now
                  : null,
                temporaryPasswordIssuedAt: params.now,
                temporaryPasswordIssuedByUserId: params.issuedByUserId,
              },
              include: {
                preferences: true,
              },
            });

            await tx.session.updateMany({
              where: {
                userId: params.userId,
                revokedAt: null,
              },
              data: {
                revokedAt: params.now,
              },
            });

            return toAuthUser(user);
          },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          throw new AuthError("USER_NOT_FOUND");
        }
        throw error;
      }
    },

    async changeRequiredPassword(params) {
      const client = getClient();

      try {
        return await client.$transaction(
          async (tx: Prisma.TransactionClient) => {
            const user = await tx.user.update({
              where: { id: params.userId },
              data: {
                passwordHash: params.passwordHash,
                passwordChangeRequiredAt: null,
                temporaryPasswordIssuedAt: null,
                temporaryPasswordIssuedByUserId: null,
                updatedAt: params.now,
              },
              include: {
                preferences: true,
              },
            });

            await tx.session.updateMany({
              where: {
                userId: params.userId,
                revokedAt: null,
                id: {
                  not: params.currentSessionId,
                },
              },
              data: {
                revokedAt: params.now,
              },
            });

            return toAuthUser(user);
          },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          return null;
        }

        throw error;
      }
    },

    async createSession(params) {
      const client = getClient();
      const session = await client.session.create({
        data: {
          userId: params.userId,
          tokenHash: params.tokenHash,
          expiresAt: params.expiresAt,
          userAgent: params.metadata?.userAgent ?? null,
          ipAddress: params.metadata?.ipAddress ?? null,
          lastSeenAt: params.now,
        },
        include: {
          user: { include: { preferences: true } },
        },
      });

      return toAuthSession(session);
    },

    async findSessionByTokenHash(tokenHash) {
      const client = getClient();
      const session = await client.session.findUnique({
        where: {
          tokenHash,
        },
        include: {
          user: { include: { preferences: true } },
        },
      });

      return session ? toStoredAuthSession(session) : null;
    },

    async listUserSessions(userId) {
      const client = getClient();
      const sessions = await client.session.findMany({
        where: {
          userId,
          revokedAt: null,
          expiresAt: {
            gt: new Date(),
          },
        },
        orderBy: {
          lastSeenAt: "desc",
        },
        include: {
          user: { include: { preferences: true } },
        },
      });

      return sessions.map(toAuthSession);
    },

    async revokeSessionById(id, revokedAt) {
      const client = getClient();

      await client.session.updateMany({
        where: {
          id,
          revokedAt: null,
        },
        data: {
          revokedAt,
        },
      });
    },

    async revokeUserSessions(userId, revokedAt) {
      const client = getClient();

      await client.session.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt,
        },
      });
    },

    async touchSessionLastSeen(id, seenAt) {
      const client = getClient();

      await client.session.updateMany({
        where: {
          id,
          revokedAt: null,
        },
        data: {
          lastSeenAt: seenAt,
        },
      });
    },

    async savePreferences(
      params: SavePreferencesParams,
    ): Promise<UserPreferences> {
      const client = getClient();

      if (params.displayName !== undefined || params.avatarUrl !== undefined) {
        await client.user.update({
          where: { id: params.userId },
          data: {
            ...(params.displayName !== undefined
              ? { displayName: params.displayName || null }
              : {}),
            ...(params.avatarUrl !== undefined
              ? { avatarUrl: params.avatarUrl }
              : {}),
          },
        });
      }

      const pref = await client.userPreference.upsert({
        where: { userId: params.userId },
        create: {
          userId: params.userId,
          theme: params.theme,
          timeZone: params.timeZone,
          showUpdateNotifications: params.showUpdateNotifications,
          enableVersionChecks: params.enableVersionChecks,
          onboardingCompletedAt: params.onboardingCompletedAt ?? new Date(),
        },
        update: {
          theme: params.theme,
          timeZone: params.timeZone,
          showUpdateNotifications: params.showUpdateNotifications,
          enableVersionChecks: params.enableVersionChecks,
          ...(params.onboardingCompletedAt !== undefined
            ? { onboardingCompletedAt: params.onboardingCompletedAt }
            : {}),
        },
      });
      return {
        theme: pref.theme,
        timeZone: pref.timeZone,
        showUpdateNotifications: pref.showUpdateNotifications,
        enableVersionChecks: pref.enableVersionChecks,
        onboardingCompletedAt: pref.onboardingCompletedAt,
      };
    },
  };
};

// fallow-ignore-next-line unused-export
export const prismaAuthRepository = createPrismaAuthRepository();
