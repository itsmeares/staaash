import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { AuthSession } from "@/server/auth/types";

const revokeSession = vi.fn();
const getSession = vi.fn<(token: string) => Promise<AuthSession>>();

vi.mock("@/server/auth/service", () => ({
  authService: {
    revokeSession,
    getSession,
  },
}));

const createdAt = new Date("2026-10-28T10:00:00.000Z");
const session: AuthSession = {
  id: "session-id",
  expiresAt: new Date("2026-10-29T10:00:00.000Z"),
  userAgent: "Browser",
  ipAddress: "127.0.0.1",
  lastSeenAt: createdAt,
  deviceName: "Desktop",
  deviceSessionId: "device-session-id",
  createdAt,
  updatedAt: createdAt,
  user: {
    id: "user-id",
    email: "owner@staaash.test",
    storageId: "storage-id",
    displayName: "Owner",
    avatarUrl: null,
    isOwner: true,
    isAdmin: true,
    role: "owner",
    passwordChangeRequiredAt: null,
    temporaryPasswordIssuedAt: null,
    temporaryPasswordIssuedByUserId: null,
    storageLimitBytes: 123n,
    preferences: null,
    createdAt,
    updatedAt: createdAt,
  },
};

describe("sign-out route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("revokes the current session and clears auth cookies", async () => {
    const { app } = await import("@/server/http/app");

    const response = await app.request(
      new Request("http://localhost:3000/api/auth/sign-out", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          cookie: "staaash_session=session-token",
          host: "localhost:3000",
        },
        body: JSON.stringify({}),
      }),
    );

    expect(revokeSession).toHaveBeenCalledWith("session-token");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_session=");
    expect(setCookie).toContain("Max-Age=0");
  });

  it("omits the internal device session link from the current-session response", async () => {
    getSession.mockResolvedValue(session);
    const { app } = await import("@/server/http/app");

    const response = await app.request(
      new Request("http://localhost:3000/api/auth/session", {
        headers: {
          cookie: "staaash_session=session-token",
          host: "localhost:3000",
        },
      }),
    );

    expect(getSession).toHaveBeenCalledWith("session-token");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).not.toHaveProperty("deviceSessionId");
    expect(body).toMatchObject({
      id: session.id,
      deviceName: session.deviceName,
      user: { id: session.user.id, storageLimitBytes: "123" },
    });
  });
});
