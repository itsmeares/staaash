import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const enforceSameOrigin = vi.fn();
const requireOwnerApiSession = vi.fn();
const readRequestBody = vi.fn();
const jsonErrorResponse = vi.fn();
const issuePasswordReset = vi.fn();

vi.mock("@/server/admin/http", () => ({
  enforceSameOrigin,
  requireOwnerApiSession,
}));

vi.mock("@/server/auth/http", () => ({
  readRequestBody,
  jsonErrorResponse,
}));

vi.mock("@/server/auth/service", () => ({
  authService: {
    issuePasswordReset,
  },
}));

describe("legacy password reset admin alias route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts the legacy body-based userId and returns a reset URL", async () => {
    const { POST } = await import("@/app/api/auth/password-resets/route");
    enforceSameOrigin.mockReturnValueOnce(null);
    requireOwnerApiSession.mockResolvedValueOnce({
      ok: true,
      session: {
        user: {
          id: "owner-1",
          role: "owner",
        },
      },
    });
    readRequestBody.mockResolvedValueOnce({
      userId: "member-1",
    });
    issuePasswordReset.mockResolvedValueOnce({
      reset: {
        id: "reset-1",
      },
      user: {
        id: "member-1",
      },
      token: "reset-token",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/auth/password-resets", {
        method: "POST",
      }),
    );

    expect(issuePasswordReset).toHaveBeenCalledWith("owner-1", "member-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      reset: {
        id: "reset-1",
      },
      user: {
        id: "member-1",
      },
      resetUrl: "http://localhost/reset/reset-token",
    });
  });
});
