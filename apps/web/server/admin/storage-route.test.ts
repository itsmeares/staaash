import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const requireOwnerApiSession = vi.fn();
const getAdminStorageSummary = vi.fn();
const toJsonAdminStorageSummary = vi.fn();

vi.mock("@/server/admin/http", () => ({
  requireOwnerApiSession,
}));

vi.mock("@/server/admin/storage", () => ({
  getAdminStorageSummary,
  toJsonAdminStorageSummary,
}));

describe("admin storage route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes through auth failures from the owner guard", async () => {
    const { GET } = await import("@/app/api/admin/storage/route");
    requireOwnerApiSession.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json(
        { error: "Owner access required." },
        { status: 403 },
      ),
    });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/storage"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Owner access required.",
    });
    expect(getAdminStorageSummary).not.toHaveBeenCalled();
  });

  it("returns serialized storage data for owners", async () => {
    const { GET } = await import("@/app/api/admin/storage/route");
    requireOwnerApiSession.mockResolvedValueOnce({
      ok: true,
      session: {
        user: {
          id: "owner-1",
          role: "owner",
        },
      },
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

    const response = await GET(
      new NextRequest("http://localhost/api/admin/storage"),
    );

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
