import {
  Prisma,
  prisma,
  type Invite,
  type PasswordReset,
  type Session,
  type User,
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
} from "@/server/auth/types";

type CreateBootstrapParams = {
  instanceName: string;
  email: string;
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

export type AuthRepository = {
  getSetupState(): Promise<SetupState>;
  createBootstrap(params: CreateBootstrapParams): Promise<AuthUser>;
  findUserByEmail(email: string): Promise<StoredAuthUser | null>;
  findUserById(id: string): Promise<AuthUser | null>;
  listUsers(): Promise<AuthUser[]>;
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
};

const toAuthUser = (
  user: Pick<
    User,
    "id" | "email" | "displayName" | "role" | "createdAt" | "updatedAt"
  >,
): AuthUser => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  role: user.role,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const toStoredAuthUser = (user: User): StoredAuthUser => ({
  ...toAuthUser(user),
  passwordHash: user.passwordHash,
});

const toAuthSession = (session: Session & { user: User }): AuthSession => ({
  id: session.id,
  expiresAt: session.expiresAt,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  user: toAuthUser(session.user),
});

const toStoredAuthSession = (
  session: Session & { user: User },
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

export const prismaAuthRepository: AuthRepository = {
  async getSetupState() {
    const [instance, owner] = await Promise.all([
      prisma.instance.findUnique({
        where: {
          id: "singleton",
        },
      }),
      prisma.user.findFirst({
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
    try {
      return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
            displayName: params.displayName ?? null,
            passwordHash: params.passwordHash,
            role: "owner",
          },
        });

        await tx.folder.create({
          data: {
            ownerUserId: user.id,
            name: "Library",
            isLibraryRoot: true,
          },
          select: {
            id: true,
          },
        });

        return toAuthUser(user);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AuthError("SETUP_ALREADY_COMPLETED");
      }

      throw error;
    }
  },

  async findUserByEmail(email) {
    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    return user ? toStoredAuthUser(user) : null;
  },

  async findUserById(id) {
    const user = await prisma.user.findUnique({
      where: {
        id,
      },
    });

    return user ? toAuthUser(user) : null;
  },

  async listUsers() {
    const users = await prisma.user.findMany({
      orderBy: {
        createdAt: "asc",
      },
    });

    return users.map(toAuthUser);
  },

  async createSession(params) {
    const session = await prisma.session.create({
      data: {
        userId: params.userId,
        tokenHash: params.tokenHash,
        expiresAt: params.expiresAt,
      },
      include: {
        user: true,
      },
    });

    return toAuthSession(session);
  },

  async findSessionByTokenHash(tokenHash) {
    const session = await prisma.session.findUnique({
      where: {
        tokenHash,
      },
      include: {
        user: true,
      },
    });

    return session ? toStoredAuthSession(session) : null;
  },

  async revokeSessionById(id, revokedAt) {
    await prisma.session.updateMany({
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
    const invite = await prisma.invite.findFirst({
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
    const invites = await prisma.invite.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    return invites.map((invite: Invite) => toInviteSummary(invite, now));
  },

  async findInviteById(id) {
    const invite = await prisma.invite.findUnique({
      where: {
        id,
      },
    });

    return invite ? toStoredInvite(invite) : null;
  },

  async findInviteByTokenHash(tokenHash) {
    const invite = await prisma.invite.findUnique({
      where: {
        tokenHash,
      },
    });

    return invite ? toStoredInvite(invite) : null;
  },

  async createInvite(params, now) {
    const invite = await prisma.invite.create({
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
    const invite = await prisma.invite.update({
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
    try {
      return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
            displayName: params.displayName ?? null,
            passwordHash: params.passwordHash,
            role: invite.role,
          },
        });

        await tx.folder.create({
          data: {
            ownerUserId: user.id,
            name: "Library",
            isLibraryRoot: true,
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
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AuthError("USER_ALREADY_EXISTS");
      }

      throw error;
    }
  },

  async createPasswordReset(params, now) {
    const reset = await prisma.$transaction(
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
    const reset = await prisma.passwordReset.findUnique({
      where: {
        tokenHash,
      },
      include: {
        user: true,
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
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
};
