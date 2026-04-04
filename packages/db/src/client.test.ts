import { afterEach, describe, expect, it, vi } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalNodeEnv = process.env.NODE_ENV;
const dummyDatabaseUrl = "postgresql://staaash:staaash@localhost:5432/staaash";

const globalForPrisma = globalThis as typeof globalThis & {
  __staaashPrisma?: {
    $disconnect(): Promise<void>;
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
  if (!globalForPrisma.__staaashPrisma) {
    return;
  }

  await globalForPrisma.__staaashPrisma.$disconnect();
  delete globalForPrisma.__staaashPrisma;
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

    const { getPrisma } = await loadClientModule();
    const first = getPrisma();
    const second = getPrisma();

    expect(first).toBe(second);

    await first.$disconnect();
  });

  it("reuses the global cached instance in non-production across module reloads", async () => {
    process.env.DATABASE_URL = dummyDatabaseUrl;
    process.env.NODE_ENV = "development";

    const firstModule = await loadClientModule();
    const first = firstModule.getPrisma();
    const secondModule = await loadClientModule();
    const second = secondModule.getPrisma();

    expect(second).toBe(first);

    await first.$disconnect();
  });
});
