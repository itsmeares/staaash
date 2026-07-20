import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPrisma } = vi.hoisted(() => ({
  getPrisma: vi.fn(),
}));

vi.mock("@staaash/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@staaash/db/client")>();

  return {
    ...actual,
    getPrisma,
  };
});

import { prismaAuthRepository } from "@/server/auth/repository";

const now = new Date("2026-06-16T10:00:00.000Z");

const updatedUser = {
  id: "user-1",
  email: "member@example.com",
  storageId: "member",
  displayName: null,
  avatarUrl: null,
  isOwner: false,
  isAdmin: false,
  passwordChangeRequiredAt: null,
  temporaryPasswordIssuedAt: null,
  temporaryPasswordIssuedByUserId: null,
  storageLimitBytes: null,
  preferences: null,
  createdAt: now,
  updatedAt: now,
};

describe("auth repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the user and revokes active sibling sessions in one transaction", async () => {
    const updateUser = vi.fn().mockResolvedValue(updatedUser);
    const revokeSiblingSessions = vi.fn().mockResolvedValue({ count: 1 });
    const transactionClient = {
      user: { update: updateUser },
      session: { updateMany: revokeSiblingSessions },
    };
    const transaction = vi.fn(
      async (
        callback: (client: typeof transactionClient) => Promise<unknown>,
      ) => callback(transactionClient),
    );
    getPrisma.mockReturnValue({ $transaction: transaction });

    const result = await prismaAuthRepository.changeRequiredPassword({
      userId: "user-1",
      currentSessionId: "session-current",
      passwordHash: "replacement-password-hash",
      now,
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(updateUser).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        passwordHash: "replacement-password-hash",
        passwordChangeRequiredAt: null,
        temporaryPasswordIssuedAt: null,
        temporaryPasswordIssuedByUserId: null,
        updatedAt: now,
      },
      include: {
        preferences: true,
      },
    });
    expect(revokeSiblingSessions).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        revokedAt: null,
        id: {
          not: "session-current",
        },
      },
      data: {
        revokedAt: now,
      },
    });
    expect(result).toMatchObject({
      id: "user-1",
      passwordChangeRequiredAt: null,
      temporaryPasswordIssuedAt: null,
      temporaryPasswordIssuedByUserId: null,
    });
  });
});
