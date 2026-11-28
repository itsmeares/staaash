import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  used: new Map<string, bigint>(),
}));

vi.mock("@/server/auth/service", () => ({
  authService: { listUsers: mocks.listUsers },
}));
vi.mock("@/server/health", () => ({
  getAdminHealthSummary: async () => ({
    queue: { queued: 0, running: 0, failed: 0, dead: 0, cancelled: 0 },
  }),
}));
vi.mock("@/server/user-storage", async () => {
  const { UploadAdmissionError } = await import("@/server/uploads/admission");
  return {
    getUserStorageUsed: async (id: string) => {
      if (id === "held")
        throw new UploadAdmissionError("UPLOAD_STORAGE_CAPACITY_UNAVAILABLE");
      return { usedBytes: mocks.used.get(id) ?? 0n };
    },
  };
});
vi.mock("./updates", () => ({ getUpdateState: async () => ({}) }));
vi.mock("./storage", () => ({
  getAdminStorageSummary: async () => ({
    totalUsers: 2,
    retainedFileCount: 5,
    retainedFolderCount: 1,
    retainedBytes: 300n,
    rows: [
      {
        userId: "b",
        displayName: null,
        email: "b@x.test",
        retainedBytes: 200n,
      },
      {
        userId: "a",
        displayName: "Alex",
        email: "a@x.test",
        retainedBytes: 100n,
      },
    ],
  }),
}));
vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({ shareLink: { count: async () => 4 } }),
}));

import { getAdminOverviewSummary } from "./overview";

const person = (id: string, limit: bigint | null, setUp = true) => ({
  id,
  email: `${id}@x.test`,
  displayName: id.toUpperCase(),
  isOwner: id === "a",
  isAdmin: id === "a",
  storageLimitBytes: limit,
  preferences: setUp ? { onboardingCompletedAt: new Date() } : null,
});

describe("admin overview", () => {
  beforeEach(() => mocks.used.clear());

  it("warns about people at 90% of their limit or more", async () => {
    mocks.listUsers.mockResolvedValue([
      person("a", null),
      person("b", 100n),
      person("c", 100n),
      person("d", 100n, false),
    ]);
    mocks.used.set("a", 999n).set("b", 90n).set("c", 89n).set("d", 120n);
    const summary = await getAdminOverviewSummary("a");
    expect(summary.nearLimit.map((entry) => entry.userId)).toEqual(["b", "d"]);
    expect(summary.users.notSetUp).toBe(1);
    expect(summary.shareLinks).toBe(4);
  });

  it("still loads when an account's usage is held for an audit", async () => {
    mocks.listUsers.mockResolvedValue([
      person("held", 100n),
      person("b", 100n),
    ]);
    mocks.used.set("b", 95n);
    const { nearLimit } = await getAdminOverviewSummary("a");
    expect(nearLimit.map((entry) => entry.userId)).toEqual(["b"]);
  });

  it("lists space per person, largest first, by name or email", async () => {
    mocks.listUsers.mockResolvedValue([person("a", null)]);
    const { space } = await getAdminOverviewSummary("a");
    expect(space).toEqual([
      { userId: "b", name: "b@x.test", bytes: 200n },
      { userId: "a", name: "Alex", bytes: 100n },
    ]);
  });
});
