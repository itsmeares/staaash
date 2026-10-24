import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const getRequestSession = vi.fn();
const getAdminIntegritySummary = vi.fn();
const toJsonAdminIntegritySummary = vi.fn();
const enqueueAdminRestoreReconciliation = vi.fn();

vi.mock("@/server/auth/guards", () => ({ getRequestSession }));

vi.mock("@/server/admin/integrity", () => ({
  getAdminIntegritySummary,
  toJsonAdminIntegritySummary,
  enqueueAdminRestoreReconciliation,
}));

const { app } = await import("@/server/http/app");

const owner = {
  id: "session-1",
  user: { id: "owner-1", role: "owner", isOwner: true },
};

describe("admin integrity route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns serialized integrity data for owners", async () => {
    getRequestSession.mockResolvedValueOnce(owner);
    getAdminIntegritySummary.mockResolvedValueOnce({
      health: { status: "healthy" },
    });
    toJsonAdminIntegritySummary.mockReturnValueOnce({
      health: { status: "healthy" },
    });

    const response = await app.request("http://localhost/api/admin/integrity");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      health: { status: "healthy" },
    });
  });

  it("refuses members", async () => {
    getRequestSession.mockResolvedValueOnce({
      id: "session-2",
      user: { id: "member-1", role: "member", isOwner: false },
    });

    const response = await app.request("http://localhost/api/admin/integrity");

    expect(response.status).toBe(403);
    expect(getAdminIntegritySummary).not.toHaveBeenCalled();
  });

  it("rejects cross-origin POST requests before auth", async () => {
    const response = await app.request(
      new Request("http://localhost/api/admin/integrity", {
        method: "POST",
        headers: { host: "localhost", origin: "https://evil.example" },
      }),
    );

    expect(response.status).toBe(403);
    expect(getRequestSession).not.toHaveBeenCalled();
  });

  it("queues restore checks for owners and reports dedupe", async () => {
    getRequestSession.mockResolvedValue(owner);
    enqueueAdminRestoreReconciliation
      .mockResolvedValueOnce({
        created: true,
        job: { id: "job-1" },
        run: { id: "run-1" },
      })
      .mockResolvedValueOnce({
        created: false,
        job: { id: "job-1" },
        run: { id: "run-1" },
      });
    const post = () =>
      app.request("http://localhost/api/admin/integrity", { method: "POST" });

    await expect((await post()).json()).resolves.toEqual({
      message: "Restore check queued.",
      jobId: "job-1",
      runId: "run-1",
    });
    await expect((await post()).json()).resolves.toEqual({
      message: "A restore check is already queued or running.",
      jobId: "job-1",
      runId: "run-1",
    });
  });
});
