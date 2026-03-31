import { canAccessAdminSurface } from "@/server/access";
import { authCrypto, type AuthCrypto } from "@/server/auth/crypto";
import { AuthError } from "@/server/auth/errors";
import {
  bootstrapInputSchema,
  createInviteInputSchema,
  isEmailIdentifier,
  normalizeAuthIdentifier,
  parseUsernameIdentifier,
  issuePasswordResetInputSchema,
  redeemInviteInputSchema,
  redeemPasswordResetInputSchema,
  signInInputSchema,
} from "@/server/auth/schema";
import {
  getInviteStatus,
  getPasswordResetStatus,
  toInviteSummary,
} from "@/server/auth/summaries";
import type {
  AuthSession,
  AuthUser,
  BootstrapInput,
  CreateInviteInput,
  InviteRedemptionState,
  PasswordResetSummary,
  InviteSummary,
  PasswordResetState,
  RedeemInviteInput,
  RedeemPasswordResetInput,
  SetupState,
  SignInInput,
} from "@/server/auth/types";
import { env } from "@/lib/env";

import type { AuthRepository } from "./repository";

const SESSION_ROLE = "member" as const;

type AuthResult = {
  session: AuthSession;
  sessionToken: string;
  user: AuthUser;
};

type InviteIssueResult = {
  invite: InviteSummary;
  token: string;
};

type PasswordResetIssueResult = {
  reset: PasswordResetSummary;
  token: string;
  user: AuthUser;
};

type CreateAuthServiceOptions = {
  repo?: AuthRepository;
  crypto?: AuthCrypto;
  now?: () => Date;
  sessionMaxAgeDays?: number;
  inviteMaxAgeDays?: number;
  passwordResetMaxAgeHours?: number;
};

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const addHours = (date: Date, hours: number) =>
  new Date(date.getTime() + hours * 60 * 60 * 1000);

const inviteFailureReasonToError = (
  reason: "invalid" | "accepted" | "expired" | "revoked",
) => {
  switch (reason) {
    case "accepted":
      return new AuthError("INVITE_ACCEPTED");
    case "expired":
      return new AuthError("INVITE_EXPIRED");
    case "revoked":
      return new AuthError("INVITE_REVOKED");
    default:
      return new AuthError("INVITE_INVALID");
  }
};

const passwordResetFailureReasonToError = (
  reason: "invalid" | "expired" | "redeemed" | "revoked",
) => {
  switch (reason) {
    case "expired":
      return new AuthError("RESET_EXPIRED");
    case "redeemed":
      return new AuthError("RESET_REDEEMED");
    case "revoked":
      return new AuthError("RESET_REVOKED");
    default:
      return new AuthError("RESET_INVALID");
  }
};

export const createAuthService = ({
  repo,
  crypto = authCrypto,
  now = () => new Date(),
  sessionMaxAgeDays = env.SESSION_MAX_AGE_DAYS,
  inviteMaxAgeDays = env.INVITE_MAX_AGE_DAYS,
  passwordResetMaxAgeHours = env.PASSWORD_RESET_MAX_AGE_HOURS,
}: CreateAuthServiceOptions = {}) => {
  const resolveRepo = async (): Promise<AuthRepository> =>
    repo ?? (await import("./repository")).prismaAuthRepository;

  const requireOwner = async (actorUserId: string) => {
    const activeRepo = await resolveRepo();
    const actor = await activeRepo.findUserById(actorUserId);

    if (!actor || !canAccessAdminSurface(actor.role)) {
      throw new AuthError("ACCESS_DENIED");
    }

    return actor;
  };

  const createSessionForUser = async (user: AuthUser): Promise<AuthResult> => {
    const issuedAt = now();
    const tokenPair = crypto.issueOpaqueToken();
    const activeRepo = await resolveRepo();
    const session = await activeRepo.createSession({
      userId: user.id,
      tokenHash: tokenPair.tokenHash,
      expiresAt: addDays(issuedAt, sessionMaxAgeDays),
    });

    return {
      session,
      sessionToken: tokenPair.token,
      user: session.user,
    };
  };

  const getInviteRedemptionState = async (
    rawToken: string,
  ): Promise<InviteRedemptionState> => {
    if (!rawToken) {
      return {
        isRedeemable: false,
        invite: null,
        reason: "invalid",
      };
    }

    const tokenHash = crypto.hashOpaqueToken(rawToken);
    const activeRepo = await resolveRepo();
    const invite = await activeRepo.findInviteByTokenHash(tokenHash);

    if (!invite) {
      return {
        isRedeemable: false,
        invite: null,
        reason: "invalid",
      };
    }

    const summary = toInviteSummary(invite, now());

    if (summary.status !== "active") {
      return {
        isRedeemable: false,
        invite: summary,
        reason: summary.status,
      };
    }

    return {
      isRedeemable: true,
      invite: summary,
    };
  };

  const getPasswordResetState = async (
    rawToken: string,
  ): Promise<PasswordResetState> => {
    if (!rawToken) {
      return {
        isRedeemable: false,
        reset: null,
        user: null,
        reason: "invalid",
      };
    }

    const tokenHash = crypto.hashOpaqueToken(rawToken);
    const activeRepo = await resolveRepo();
    const record = await activeRepo.findPasswordResetByTokenHash(tokenHash);

    if (!record) {
      return {
        isRedeemable: false,
        reset: null,
        user: null,
        reason: "invalid",
      };
    }

    const summary = {
      ...record.reset,
      status: getPasswordResetStatus(record.reset, now()),
    };

    if (summary.status !== "active") {
      return {
        isRedeemable: false,
        reset: summary,
        user: record.user,
        reason: summary.status,
      };
    }

    return {
      isRedeemable: true,
      reset: summary,
      user: record.user,
    };
  };

  const createInviteForActor = async (
    actorUserId: string,
    input: CreateInviteInput,
  ): Promise<InviteIssueResult> => {
    await requireOwner(actorUserId);
    const parsed = createInviteInputSchema.parse(input);
    const activeRepo = await resolveRepo();

    if (await activeRepo.findUserByEmail(parsed.email)) {
      throw new AuthError("USER_ALREADY_EXISTS");
    }

    if (await activeRepo.findActiveInviteByEmail(parsed.email, now())) {
      throw new AuthError("ACTIVE_INVITE_EXISTS");
    }

    const issuedAt = now();
    const tokenPair = crypto.issueOpaqueToken();
    const invite = await activeRepo.createInvite(
      {
        email: parsed.email,
        role: SESSION_ROLE,
        invitedByUserId: actorUserId,
        tokenHash: tokenPair.tokenHash,
        expiresAt: addDays(issuedAt, inviteMaxAgeDays),
      },
      issuedAt,
    );

    return {
      invite,
      token: tokenPair.token,
    };
  };

  return {
    async getSetupState(): Promise<SetupState> {
      return (await resolveRepo()).getSetupState();
    },

    async bootstrap(input: BootstrapInput): Promise<AuthResult> {
      const parsed = bootstrapInputSchema.parse(input);
      const activeRepo = await resolveRepo();
      const setupState = await activeRepo.getSetupState();

      if (setupState.isBootstrapped) {
        throw new AuthError("SETUP_ALREADY_COMPLETED");
      }

      if (await activeRepo.findUserByUsername(parsed.username)) {
        throw new AuthError("USERNAME_ALREADY_EXISTS");
      }

      const createdAt = now();
      const passwordHash = await crypto.hashPassword(parsed.password);
      const user = await activeRepo.createBootstrap({
        instanceName: parsed.instanceName,
        email: parsed.email,
        username: parsed.username,
        displayName: parsed.displayName,
        passwordHash,
        createdAt,
      });

      return createSessionForUser(user);
    },

    async signIn(input: SignInInput): Promise<AuthResult> {
      const parsed = signInInputSchema.parse(input);
      const activeRepo = await resolveRepo();
      const setupState = await activeRepo.getSetupState();

      if (!setupState.isBootstrapped) {
        throw new AuthError("SETUP_REQUIRED");
      }

      const normalizedIdentifier = normalizeAuthIdentifier(parsed.identifier);
      let user = null;

      if (isEmailIdentifier(normalizedIdentifier)) {
        user = await activeRepo.findUserByEmail(
          normalizedIdentifier.toLowerCase(),
        );
      } else {
        const parsedUsername = parseUsernameIdentifier(normalizedIdentifier);

        if (!parsedUsername.success) {
          throw new AuthError("INVALID_IDENTIFIER");
        }

        user = await activeRepo.findUserByUsername(parsedUsername.data);
      }

      if (
        !user ||
        !(await crypto.verifyPassword(parsed.password, user.passwordHash))
      ) {
        throw new AuthError("INVALID_CREDENTIALS");
      }

      return createSessionForUser(user);
    },

    async getSession(rawToken: string | null | undefined) {
      if (!rawToken) {
        return null;
      }

      const tokenHash = crypto.hashOpaqueToken(rawToken);
      const activeRepo = await resolveRepo();
      const session = await activeRepo.findSessionByTokenHash(tokenHash);

      if (!session) {
        return null;
      }

      if (session.revokedAt || session.expiresAt <= now()) {
        if (!session.revokedAt) {
          await activeRepo.revokeSessionById(session.id, now());
        }

        return null;
      }

      return {
        id: session.id,
        expiresAt: session.expiresAt,
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
      await requireOwner(actorUserId);
      return (await resolveRepo()).listUsers();
    },

    async listInvites(actorUserId: string) {
      await requireOwner(actorUserId);
      return (await resolveRepo()).listInvites(now());
    },

    async createInvite(
      actorUserId: string,
      input: CreateInviteInput,
    ): Promise<InviteIssueResult> {
      return createInviteForActor(actorUserId, input);
    },

    async revokeInvite(actorUserId: string, inviteId: string) {
      await requireOwner(actorUserId);
      const activeRepo = await resolveRepo();
      const invite = await activeRepo.findInviteById(inviteId);

      if (!invite) {
        throw new AuthError("INVITE_INVALID");
      }

      const inviteStatus = getInviteStatus(invite, now());

      if (inviteStatus === "accepted") {
        throw new AuthError("INVITE_ACCEPTED");
      }

      if (inviteStatus === "revoked") {
        return toInviteSummary(invite, now());
      }

      return activeRepo.revokeInvite(invite.id, now(), now());
    },

    async reissueInvite(
      actorUserId: string,
      inviteId: string,
    ): Promise<InviteIssueResult> {
      await requireOwner(actorUserId);
      const activeRepo = await resolveRepo();
      const invite = await activeRepo.findInviteById(inviteId);

      if (!invite) {
        throw new AuthError("INVITE_INVALID");
      }

      if (getInviteStatus(invite, now()) === "accepted") {
        throw new AuthError("INVITE_ACCEPTED");
      }

      if (await activeRepo.findUserByEmail(invite.email)) {
        throw new AuthError("USER_ALREADY_EXISTS");
      }

      if (getInviteStatus(invite, now()) === "active") {
        await activeRepo.revokeInvite(invite.id, now(), now());
      }

      return createInviteForActor(actorUserId, {
        email: invite.email,
      });
    },

    async getInviteRedemptionState(
      rawToken: string,
    ): Promise<InviteRedemptionState> {
      return getInviteRedemptionState(rawToken);
    },

    async redeemInvite(input: RedeemInviteInput): Promise<AuthResult> {
      const parsed = redeemInviteInputSchema.parse(input);
      const redemptionState = await getInviteRedemptionState(parsed.token);

      if (!redemptionState.isRedeemable) {
        throw inviteFailureReasonToError(redemptionState.reason);
      }

      const activeRepo = await resolveRepo();

      if (await activeRepo.findUserByEmail(redemptionState.invite.email)) {
        throw new AuthError("USER_ALREADY_EXISTS");
      }

      if (await activeRepo.findUserByUsername(parsed.username)) {
        throw new AuthError("USERNAME_ALREADY_EXISTS");
      }

      const passwordHash = await crypto.hashPassword(parsed.password);
      const user = await activeRepo.consumeInvite({
        inviteId: redemptionState.invite.id,
        username: parsed.username,
        displayName: parsed.displayName,
        passwordHash,
        now: now(),
      });

      if (!user) {
        throw new AuthError("INVITE_INVALID");
      }

      return createSessionForUser(user);
    },

    async issuePasswordReset(
      actorUserId: string,
      userId: string,
    ): Promise<PasswordResetIssueResult> {
      await requireOwner(actorUserId);
      const parsed = issuePasswordResetInputSchema.parse({
        userId,
      });
      const activeRepo = await resolveRepo();

      const user = await activeRepo.findUserById(parsed.userId);

      if (!user) {
        throw new AuthError("USER_NOT_FOUND");
      }

      const issuedAt = now();
      const tokenPair = crypto.issueOpaqueToken();
      const reset = await activeRepo.createPasswordReset(
        {
          userId: parsed.userId,
          issuedByUserId: actorUserId,
          tokenHash: tokenPair.tokenHash,
          expiresAt: addHours(issuedAt, passwordResetMaxAgeHours),
          now: issuedAt,
        },
        issuedAt,
      );

      return {
        reset,
        token: tokenPair.token,
        user,
      };
    },

    async getPasswordResetState(rawToken: string): Promise<PasswordResetState> {
      return getPasswordResetState(rawToken);
    },

    async redeemPasswordReset(
      input: RedeemPasswordResetInput,
    ): Promise<AuthResult> {
      const parsed = redeemPasswordResetInputSchema.parse(input);
      const resetState = await getPasswordResetState(parsed.token);

      if (!resetState.isRedeemable) {
        throw passwordResetFailureReasonToError(resetState.reason);
      }

      const passwordHash = await crypto.hashPassword(parsed.password);
      const user = await (
        await resolveRepo()
      ).consumePasswordReset({
        resetId: resetState.reset.id,
        passwordHash,
        now: now(),
      });

      if (!user) {
        throw new AuthError("RESET_INVALID");
      }

      return createSessionForUser(user);
    },
  };
};

export const authService = createAuthService();
