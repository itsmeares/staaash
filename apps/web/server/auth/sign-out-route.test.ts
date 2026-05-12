import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const revokeSession = vi.fn();

vi.mock("@/server/auth/service", () => ({
  authService: {
    revokeSession,
  },
}));

describe("sign-out route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("revokes the current session and clears auth cookies", async () => {
    const { POST } = await import("@/app/api/auth/sign-out/route");

    const response = await POST(
      new NextRequest("http://localhost:3000/api/auth/sign-out", {
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
    expect(setCookie).toContain("staaash_onboarded=");
    expect(setCookie).toContain("Max-Age=0");
  });
});
