import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createUser,
  enforceSameOrigin,
  requireOwnerApiSession,
  resetPassword,
  updateUser,
} = vi.hoisted(() => ({
  createUser: vi.fn(),
  enforceSameOrigin: vi.fn(),
  requireOwnerApiSession: vi.fn(),
  resetPassword: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("@/server/admin/http", () => ({
  enforceSameOrigin,
  requireOwnerApiSession,
}));

vi.mock("@/server/auth/service", () => ({
  authService: {
    createUser,
    resetTemporaryPassword: resetPassword,
    updateUser,
  },
}));

const makeRequest = (path: string, body: unknown, method = "POST") =>
  new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });

const user = {
  id: "member-1",
  email: "member@example.com",
  storageLimitBytes: null,
};

describe("admin users routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enforceSameOrigin.mockReturnValue(undefined);
    requireOwnerApiSession.mockResolvedValue({
      ok: true,
      session: { user: { id: "owner-1" } },
    });
  });

  it.each(
    [
      "not-an-integer",
      "1.5",
      "1e3",
      "",
      " ",
      " 123 ",
      "0x10",
      "0b10",
      "-1",
      123,
      1.5,
      true,
      [],
      ["123"],
      {},
      { toString: "123" },
    ].map((storageLimitBytes) => ({ storageLimitBytes })),
  )(
    "rejects invalid update storage limit %j without mutation",
    async ({ storageLimitBytes }) => {
      const { PATCH } = await import("@/app/api/admin/users/[userId]/route");

      const response = await PATCH(
        makeRequest(
          "/api/admin/users/member-1",
          { storageLimitBytes },
          "PATCH",
        ),
        { params: Promise.resolve({ userId: "member-1" }) },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        code: "INVALID_REQUEST",
        error: expect.any(String),
      });
      expect(updateUser).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["0", 0n],
    ["001024", 1024n],
    ["9007199254740993", 9007199254740993n],
    [null, null],
    [undefined, null],
  ])(
    "updates storage limit %s as %s",
    async (storageLimitBytes, expectedLimit) => {
      updateUser.mockResolvedValueOnce({
        ...user,
        storageLimitBytes: expectedLimit,
      });
      const { PATCH } = await import("@/app/api/admin/users/[userId]/route");

      const response = await PATCH(
        makeRequest(
          "/api/admin/users/member-1",
          { storageLimitBytes },
          "PATCH",
        ),
        { params: Promise.resolve({ userId: "member-1" }) },
      );

      expect(response.status).toBe(200);
      expect(updateUser).toHaveBeenCalledWith("owner-1", "member-1", {
        storageLimitBytes: expectedLimit,
        isAdmin: false,
      });
      expect((await response.json()).user.storageLimitBytes).toBe(
        expectedLimit?.toString() ?? null,
      );
    },
  );

  it("omits null temporary password fields when creating generated passwords", async () => {
    createUser.mockResolvedValueOnce({
      user,
      temporaryPassword: "generated-pass",
    });
    const { POST } = await import("@/app/api/admin/users/route");

    const response = await POST(
      makeRequest("/api/admin/users", {
        email: "member@example.com",
        generateTemporaryPassword: true,
        temporaryPassword: null,
        confirmTemporaryPassword: null,
        storageLimitBytes: null,
        isAdmin: false,
        requirePasswordChange: true,
      }),
    );

    expect(response.status).toBe(201);
    expect(createUser).toHaveBeenCalledWith("owner-1", {
      email: "member@example.com",
      temporaryPassword: undefined,
      confirmTemporaryPassword: undefined,
      generateTemporaryPassword: true,
      storageLimitBytes: null,
      isAdmin: false,
      requirePasswordChange: true,
    });
  });

  it("omits null temporary password fields when resetting generated passwords", async () => {
    resetPassword.mockResolvedValueOnce({
      user,
      temporaryPassword: "generated-pass",
    });
    const { POST } =
      await import("@/app/api/admin/users/[userId]/password-reset/route");

    const response = await POST(
      makeRequest("/api/admin/users/member-1/password-reset", {
        generateTemporaryPassword: true,
        temporaryPassword: null,
        confirmTemporaryPassword: null,
        requirePasswordChange: true,
      }),
      { params: Promise.resolve({ userId: "member-1" }) },
    );

    expect(response.status).toBe(200);
    expect(resetPassword).toHaveBeenCalledWith("owner-1", "member-1", {
      temporaryPassword: undefined,
      confirmTemporaryPassword: undefined,
      generateTemporaryPassword: true,
      requirePasswordChange: true,
    });
  });
});
