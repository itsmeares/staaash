import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const getRequestSession = vi.fn();
const getAdminStorageSummary = vi.fn();
const toJsonAdminStorageSummary = vi.fn();

vi.mock("@/server/auth/guards", () => ({ getRequestSession }));

vi.mock("@/server/admin/storage", () => ({
  getAdminStorageSummary,
  toJsonAdminStorageSummary,
}));

const { app } = await import("@/server/http/app");

describe("admin storage route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refuses admins who are not the owner", async () => {
    getRequestSession.mockResolvedValueOnce({
      id: "session-1",
      user: { id: "admin-1", role: "admin", isOwner: false },
    });

    const response = await app.request("http://localhost/api/admin/storage");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Owner access required.",
      code: "OWNER_REQUIRED",
    });
    expect(getAdminStorageSummary).not.toHaveBeenCalled();
  });

  it("returns serialized storage data for owners", async () => {
    getRequestSession.mockResolvedValueOnce({
      id: "session-1",
      user: { id: "owner-1", role: "owner", isOwner: true },
    });
    getAdminStorageSummary.mockResolvedValueOnce({
      totalUsers: 2,
      retainedFileCount: 3,
      retainedFolderCount: 1,
      retainedBytes: 24n,
      rows: [],
    });
    toJsonAdminStorageSummary.mockReturnValueOnce({
      totalUsers: 2,
      retainedFileCount: 3,
      retainedFolderCount: 1,
      retainedBytes: "24",
      rows: [],
    });

    const response = await app.request("http://localhost/api/admin/storage");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      totalUsers: 2,
      retainedFileCount: 3,
      retainedFolderCount: 1,
      retainedBytes: "24",
      rows: [],
    });
    expect(getAdminStorageSummary).toHaveBeenCalledTimes(1);
  });
});
