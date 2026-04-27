import {
  Prisma,
  getPrisma,
  type Invite,
  type PasswordReset,
  type Session,
  type User,
  type UserPreference,
  type UserRole,
} from "@staaash/db/client";

import { AuthError } from "@/server/auth/errors";
import {
  getInviteStatus,
  getPasswordResetStatus,
  toStoredInvite,
  toStoredPasswordReset,
  toInviteSummary,
  toPasswordResetSummary,
} from "@/server/auth/summaries";
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
  UserPreferences,
} from "@/server/auth/types";

type CreateBootstrapParams = {
  instanceName: string;
  email: string;
  username: string;
  displayName?: string;
  passwordHash: string;
  createdAt: Date;
};

type CreateSessionParams = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

type CreateInviteParams = {
  email: string;
  role: UserRole;
  invitedByUserId: string;
  tokenHash: string;
  expiresAt: Date;
};

type RedeemInviteParams = {
  inviteId: string;
  username: string;
  displayName?: string;
  passwordHash: string;
  now: Date;
};

type CreatePasswordResetParams = {
  userId: string;
  issuedByUserId: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
};

type ConsumePasswordResetParams = {
  resetId: string;
  passwordHash: string;
  now: Date;
};

type StoredPasswordResetLookup = {
  reset: StoredPasswordReset;
  user: AuthUser;
};

type SavePreferencesParams = {
  userId: string;
  theme: string;
  showUpdateNotifications: boolean;
  enableVersionChecks: boolean;
  onboardingCompletedAt?: Date;
  displayName?: string | null;
  avatarUrl?: string | null;
};

type AuthPrismaClient = Pick<
  ReturnType<typeof getPrisma>,
  | "folder"
  | "instance"
  | "invite"
  | "passwordReset"
  | "session"
  | "user"
  | "userPreference"
  | "$transaction"
>;

export type AuthRepository = {
  getSetupState(): Promise<SetupState>;
  createBootstrap(params: CreateBootstrapParams): Promise<AuthUser>;
  findUserByEmail(email: string): Promise<StoredAuthUser | null>;
  findUserByUsername(username: string): Promise<StoredAuthUser | null>;
  findUserById(id: string): Promise<AuthUser | null>;
  listUsers(): Promise<AuthUser[]>;
  setUserStorageLimit(
    userId: string,
    limitBytes: bigint | null,
  ): Promise<AuthUser | null>;
  createSession(params: CreateSessionParams): Promise<AuthSession>;
  findSessionByTokenHash(tokenHash: string): Promise<StoredAuthSession | null>;
  revokeSessionById(id: string, revokedAt: Date): Promise<void>;
  findActiveInviteByEmail(
    email: string,
    now: Date,
  ): Promise<InviteSummary | null>;
  listInvites(now: Date): Promise<InviteSummary[]>;
  findInviteById(id: string): Promise<StoredInvite | null>;
  findInviteByTokenHash(tokenHash: string): Promise<StoredInvite | null>;
  createInvite(params: CreateInviteParams, now: Date): Promise<InviteSummary>;
  revokeInvite(id: string, revokedAt: Date, now: Date): Promise<InviteSummary>;
  consumeInvite(params: RedeemInviteParams): Promise<AuthUser | null>;
  createPasswordReset(
    params: CreatePasswordResetParams,
    now: Date,
  ): Promise<PasswordResetSummary>;
  findPasswordResetByTokenHash(
    tokenHash: string,
  ): Promise<StoredPasswordResetLookup | null>;
  consumePasswordReset(
    params: ConsumePasswordResetParams,
  ): Promise<AuthUser | null>;
  savePreferences(params: SavePreferencesParams): Promise<UserPreferences>;
};

const toAuthUser = (
  user: Pick<
    User,
    | "id"
    | "email"
    | "username"
    | "displayName"
    | "avatarUrl"
    | "role"
    | "storageLimitBytes"
    | "createdAt"
    | "updatedAt"
  > & { preferences?: UserPreference | null },
): AuthUser => ({
  id: user.id,
  email: user.email,
  username: user.username,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl,
  role: user.role,
  storageLimitBytes: user.storageLimitBytes,
  preferences: user.preferences
    ? {
        theme: user.preferences.theme,
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

export const createPrismaAuthRepository = (
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
            role: "owner",
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
                setupCompletedAt: params.createdAt,
              },
            });

            const user = await tx.user.create({
              data: {
                email: params.email,
                username: params.username,
                displayName: params.displayName ?? null,
                passwordHash: params.passwordHash,
                role: "owner",
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

    async findUserByEmail(email) {
      const client = getClient();
      const user = await client.user.findUnique({
        where: {
          email,
        },
      });

      return user ? toStoredAuthUser(user) : null;
    },

    async findUserByUsername(username) {
      const client = getClient();
      const user = await client.user.findUnique({
        where: {
          username,
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
      });

      return user ? toAuthUser(user) : null;
    },

    async listUsers() {
      const client = getClient();
      const users = await client.user.findMany({
        orderBy: {
          createdAt: "asc",
        },
      });

      return users.map(toAuthUser);
    },

    async setUserStorageLimit(userId, limitBytes) {
      const client = getClient();
      const user = await client.user.update({
        where: { id: userId },
        data: { storageLimitBytes: limitBytes },
      });

      return user ? toAuthUser(user) : null;
    },

    async createSession(params) {
      const client = getClient();
      const session = await client.session.create({
        data: {
          userId: params.userId,
          tokenHash: params.tokenHash,
          expiresAt: params.expiresAt,
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

    async findActiveInviteByEmail(email, now) {
      const client = getClient();
      const invite = await client.invite.findFirst({
        where: {
          email,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: {
            gt: now,
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return invite ? toInviteSummary(invite, now) : null;
    },

    async listInvites(now) {
      const client = getClient();
      const invites = await client.invite.findMany({
        orderBy: {
          createdAt: "desc",
        },
      });

      return invites.map((invite: Invite) => toInviteSummary(invite, now));
    },

    async findInviteById(id) {
      const client = getClient();
      const invite = await client.invite.findUnique({
        where: {
          id,
        },
      });

      return invite ? toStoredInvite(invite) : null;
    },

    async findInviteByTokenHash(tokenHash) {
      const client = getClient();
      const invite = await client.invite.findUnique({
        where: {
          tokenHash,
        },
      });

      return invite ? toStoredInvite(invite) : null;
    },

    async createInvite(params, now) {
      const client = getClient();
      const invite = await client.invite.create({
        data: {
          email: params.email,
          role: params.role,
          tokenHash: params.tokenHash,
          invitedByUserId: params.invitedByUserId,
          expiresAt: params.expiresAt,
        },
      });

      return toInviteSummary(invite, now);
    },

    async revokeInvite(id, revokedAt, now) {
      const client = getClient();
      const invite = await client.invite.update({
        where: {
          id,
        },
        data: {
          revokedAt,
        },
      });

      return toInviteSummary(invite, now);
    },

    async consumeInvite(params) {
      const client = getClient();

      try {
        return await client.$transaction(
          async (tx: Prisma.TransactionClient) => {
            const invite = await tx.invite.findFirst({
              where: {
                id: params.inviteId,
                acceptedAt: null,
                revokedAt: null,
                expiresAt: {
                  gt: params.now,
                },
              },
            });

            if (!invite) {
              return null;
            }

            const user = await tx.user.create({
              data: {
                email: invite.email,
                username: params.username,
                displayName: params.displayName ?? null,
                passwordHash: params.passwordHash,
                role: invite.role,
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

            await tx.invite.update({
              where: {
                id: invite.id,
              },
              data: {
                acceptedAt: params.now,
                acceptedByUserId: user.id,
              },
            });

            return toAuthUser(user);
          },
        );
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          if (getUniqueConstraintTargets(error).includes("username")) {
            throw new AuthError("USERNAME_ALREADY_EXISTS");
          }

          throw new AuthError("USER_ALREADY_EXISTS");
        }

        throw error;
      }
    },

    async createPasswordReset(params, now) {
      const client = getClient();
      const reset = await client.$transaction(
        async (tx: Prisma.TransactionClient) => {
          await tx.passwordReset.updateMany({
            where: {
              userId: params.userId,
              redeemedAt: null,
              revokedAt: null,
              expiresAt: {
                gt: params.now,
              },
            },
            data: {
              revokedAt: params.now,
            },
          });

          return tx.passwordReset.create({
            data: {
              userId: params.userId,
              issuedByUserId: params.issuedByUserId,
              tokenHash: params.tokenHash,
              expiresAt: params.expiresAt,
            },
          });
        },
      );

      return toPasswordResetSummary(reset, now);
    },

    async findPasswordResetByTokenHash(tokenHash) {
      const client = getClient();
      const reset = await client.passwordReset.findUnique({
        where: {
          tokenHash,
        },
        include: {
          user: { include: { preferences: true } },
        },
      });

      if (!reset) {
        return null;
      }

      return {
        reset: toStoredPasswordReset(reset),
        user: toAuthUser(reset.user),
      };
    },

    async consumePasswordReset(params) {
      const client = getClient();

      return client.$transaction(async (tx: Prisma.TransactionClient) => {
        const reset = await tx.passwordReset.findFirst({
          where: {
            id: params.resetId,
            redeemedAt: null,
            revokedAt: null,
            expiresAt: {
              gt: params.now,
            },
          },
        });

        if (!reset) {
          return null;
        }

        const user = await tx.user.update({
          where: {
            id: reset.userId,
          },
          data: {
            passwordHash: params.passwordHash,
          },
        });

        await tx.session.updateMany({
          where: {
            userId: reset.userId,
            revokedAt: null,
          },
          data: {
            revokedAt: params.now,
          },
        });

        await tx.passwordReset.update({
          where: {
            id: reset.id,
          },
          data: {
            redeemedAt: params.now,
          },
        });

        return toAuthUser(user);
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
          showUpdateNotifications: params.showUpdateNotifications,
          enableVersionChecks: params.enableVersionChecks,
          onboardingCompletedAt: params.onboardingCompletedAt ?? new Date(),
        },
        update: {
          theme: params.theme,
          showUpdateNotifications: params.showUpdateNotifications,
          enableVersionChecks: params.enableVersionChecks,
          ...(params.onboardingCompletedAt !== undefined
            ? { onboardingCompletedAt: params.onboardingCompletedAt }
            : {}),
        },
      });
      return {
        theme: pref.theme,
        showUpdateNotifications: pref.showUpdateNotifications,
        enableVersionChecks: pref.enableVersionChecks,
        onboardingCompletedAt: pref.onboardingCompletedAt,
      };
    },
  };
};

export const prismaAuthRepository = createPrismaAuthRepository();
