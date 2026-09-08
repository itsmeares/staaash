import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("bootstrap sessions", () => {
  let originalAuthSecret: string | undefined;
  let originalNextRuntime: string | undefined;

  beforeEach(() => {
    originalAuthSecret = process.env.AUTH_SECRET;
    originalNextRuntime = process.env.NEXT_RUNTIME;
    delete process.env.AUTH_SECRET;
    process.env.NEXT_RUNTIME = "nodejs";
    vi.resetModules();
  });

  afterEach(() => {
    if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalAuthSecret;
    if (originalNextRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = originalNextRuntime;
    vi.resetModules();
  });

  it("keeps the bootstrap session valid after startup prewarming and restart", async () => {
    const { getPrisma } = await import("@staaash/db/client");
    const db = getPrisma();

    expect(
      await db.instance.findUnique({ where: { id: "singleton" } }),
    ).toBeNull();

    const { register } = await import("@/instrumentation");
    await register();

    const { authService } = await import("@/server/auth/service");
    const bootstrap = await authService.bootstrap({
      instanceName: "Test Staaash",
      email: "owner@example.com",
      password: "long-owner-password",
    });

    vi.resetModules();
    const { authService: restartedAuthService } =
      await import("@/server/auth/service");

    await expect(
      restartedAuthService.getSession(bootstrap.sessionToken),
    ).resolves.toMatchObject({ user: { email: "owner@example.com" } });
  });
});
