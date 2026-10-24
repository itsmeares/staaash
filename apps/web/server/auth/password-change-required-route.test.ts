import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const { changeRequiredPassword, getSession } = vi.hoisted(() => ({
  changeRequiredPassword: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/server/auth/service", () => ({
  authService: {
    changeRequiredPassword,
    getSession,
  },
}));

const request = () =>
  new Request("http://localhost:3000/api/auth/password-change-required", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie: "staaash_session=session-token",
      host: "localhost:3000",
    },
    body: JSON.stringify({
      password: "replacement-pass-1",
      confirmPassword: "replacement-pass-1",
    }),
  });

describe("required password change route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes the authenticated user and current session IDs to the service", async () => {
    getSession.mockResolvedValueOnce({
      id: "session-current",
      user: { id: "user-1" },
    });
    changeRequiredPassword.mockResolvedValueOnce({
      preferences: null,
    });
    const { app } = await import("@/server/http/app");

    const response = await app.request(request());

    expect(getSession).toHaveBeenCalledWith("session-token");
    expect(changeRequiredPassword).toHaveBeenCalledWith(
      "user-1",
      "session-current",
      {
        password: "replacement-pass-1",
        confirmPassword: "replacement-pass-1",
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      "staaash_session",
    );
  });

  it("rejects a missing authenticated session before changing the password", async () => {
    getSession.mockResolvedValueOnce(null);
    const { app } = await import("@/server/http/app");

    const response = await app.request(request());

    expect(response.status).toBe(401);
    expect(changeRequiredPassword).not.toHaveBeenCalled();
  });
});
