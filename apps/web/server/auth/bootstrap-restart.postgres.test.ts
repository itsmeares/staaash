import {
  afterEach,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vite-plus/test";

import { assertIsolatedPostgresTestTarget } from "../../vitest.postgres.global";

const resetPostgresState = async () => {
  assertIsolatedPostgresTestTarget({
    databaseUrl: inject("postgresDatabaseUrl"),
    databaseName: inject("postgresDatabaseName"),
  });

  const { getPrisma } = await import("@staaash/db/client");
  const db = getPrisma();
  await db.uploadChunk.deleteMany();
  await db.uploadSession.deleteMany();
  await db.storageMutation.deleteMany();
  await db.file.deleteMany();
  await db.folder.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
  await db.instance.deleteMany();
};

describe("bootstrap sessions", () => {
  let originalAuthSecret: string | undefined;

  beforeEach(async () => {
    originalAuthSecret = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    vi.resetModules();
    await resetPostgresState();
  });

  afterEach(() => {
    return resetPostgresState().finally(() => {
      if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = originalAuthSecret;
      vi.resetModules();
    });
  });

  it("keeps the bootstrap session valid after startup prewarming and restart", async () => {
    const { getPrisma } = await import("@staaash/db/client");
    const db = getPrisma();

    expect(
      await db.instance.findUnique({ where: { id: "singleton" } }),
    ).toBeNull();

    const { startup } = await import("@/server/startup");
    await startup();

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
