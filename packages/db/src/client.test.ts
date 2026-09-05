import { afterEach, describe, expect, it, vi } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalNodeEnv = process.env.NODE_ENV;
const dummyDatabaseUrl = "postgresql://staaash:staaash@localhost:5432/staaash";

const globalForPrisma = globalThis as typeof globalThis & {
  __staaashDatabase?: {
    uploadPool: {
      end(): Promise<void>;
    };
    prisma: {
      $disconnect(): Promise<void>;
    };
  };
};

const restoreEnv = () => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }

  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
};

const clearGlobalPrisma = async () => {
  if (!globalForPrisma.__staaashDatabase) {
    return;
  }

  await globalForPrisma.__staaashDatabase.uploadPool.end();
  await globalForPrisma.__staaashDatabase.prisma.$disconnect();
  delete globalForPrisma.__staaashDatabase;
};

const loadClientModule = async () => {
  vi.resetModules();
  return import("./client");
};

afterEach(async () => {
  await clearGlobalPrisma();
  restoreEnv();
  vi.resetModules();
});

describe("getPrisma", () => {
  it("does not throw when the module is imported without DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = "test";

    await expect(loadClientModule()).resolves.toMatchObject({
      getPrisma: expect.any(Function),
    });
  });

  it("throws when DATABASE_URL is missing at call time", async () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = "test";

    const { getPrisma } = await loadClientModule();

    expect(() => getPrisma()).toThrow(
      "DATABASE_URL is required before calling getPrisma().",
    );
  });

  it("returns the same instance on repeated calls in production", async () => {
    process.env.DATABASE_URL = dummyDatabaseUrl;
    process.env.NODE_ENV = "production";

    const { getPostgresPool, getPrisma, getUploadPostgresPool } =
      await loadClientModule();
    const first = getPrisma();
    const second = getPrisma();

    expect(first).toBe(second);
    expect(getPostgresPool()).toBe(getPostgresPool());
    expect(getUploadPostgresPool()).toBe(getUploadPostgresPool());
    expect(getUploadPostgresPool()).not.toBe(getPostgresPool());

    await getUploadPostgresPool().end();
    await first.$disconnect();
  });

  it("reuses the global cached instance in non-production across module reloads", async () => {
    process.env.DATABASE_URL = dummyDatabaseUrl;
    process.env.NODE_ENV = "development";

    const firstModule = await loadClientModule();
    const first = firstModule.getPrisma();
    const firstPool = firstModule.getPostgresPool();
    const firstUploadPool = firstModule.getUploadPostgresPool();
    const secondModule = await loadClientModule();
    const second = secondModule.getPrisma();

    expect(second).toBe(first);
    expect(secondModule.getPostgresPool()).toBe(firstPool);
    expect(secondModule.getUploadPostgresPool()).toBe(firstUploadPool);

    await first.$disconnect();
  });
});
