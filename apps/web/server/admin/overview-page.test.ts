import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAdminOverviewSummary: vi.fn() }));
vi.mock("@/server/admin/overview", () => mocks);
vi.mock("@/server/auth/guards", () => ({
  requireAdminPageSession: vi
    .fn()
    .mockResolvedValue({ user: { id: "admin-1" } }),
}));

import AdminOverviewPage from "@/app/admin/page";

const fixture = () => ({
  users: { total: 1, owners: 1, admins: 0, members: 0 },
  storage: {
    retainedBytes: 0n,
    retainedFileCount: 0,
    retainedFolderCount: 0,
    totalUsers: 1,
  },
  jobs: { queued: 0, running: 0, failed: 0, dead: 0, status: "healthy" },
  updates: {
    currentVersion: "1.2.0",
    latestAvailableVersion: null,
    updateCheckStatus: null,
    updateCheckMessage: null,
  },
  health: {
    ok: true,
    operational: { status: "healthy" },
    checks: { database: { status: "healthy" }, storage: { status: "healthy" } },
    worker: { status: "healthy", message: "Current heartbeat" },
    queue: {
      status: "healthy",
      queued: 0,
      running: 0,
      failed: 0,
      dead: 0,
      message: undefined as string | undefined,
    },
    storageWarnings: { status: "healthy", message: "Available capacity" },
    reconciliation: { status: "healthy", message: "Reconciled" },
  },
});

beforeEach(() => vi.clearAllMocks());

describe("admin availability and operational health", () => {
  it("shows healthy traffic and operations without a failed-job alert", async () => {
    mocks.getAdminOverviewSummary.mockResolvedValue(fixture());
    const markup = renderToStaticMarkup(await AdminOverviewPage());
    expect(markup).toContain("Serving traffic");
    expect(markup).toContain(">Ready<");
    expect(markup).toContain("Operational health");
    expect(markup).not.toContain("Attention needed");
    expect(markup).not.toContain("Review failed jobs");
  });

  it.each([
    [0, 1, "1 failed or dead job needs attention."],
    [2, 1, "3 failed or dead jobs need attention."],
  ])(
    "shows %i failed and %i dead jobs while file operations remain available",
    async (failed, dead, message) => {
      const summary = fixture();
      summary.jobs.failed = Number(failed);
      summary.jobs.dead = Number(dead);
      summary.health.operational.status = "warning";
      mocks.getAdminOverviewSummary.mockResolvedValue(summary);
      const markup = renderToStaticMarkup(await AdminOverviewPage());
      expect(markup).toContain(">Ready<");
      expect(markup).toContain("Attention needed");
      expect(markup).toContain(message);
      expect(markup).toContain("File operations remain available.");
      expect(markup).toMatch(
        /href="\/admin\/jobs"[^>]*>Review failed jobs<\/a>/,
      );
    },
  );

  it("shows unavailable traffic and the queue probe error without promising file availability", async () => {
    const summary = fixture();
    summary.jobs.dead = 1;
    summary.health.ok = false;
    summary.health.operational.status = "error";
    summary.health.queue.status = "error";
    summary.health.queue.message = "Queue probe could not reach the database.";
    mocks.getAdminOverviewSummary.mockResolvedValue(summary);
    const markup = renderToStaticMarkup(await AdminOverviewPage());
    expect(markup).toContain(">Unavailable<");
    expect(markup).toContain("Attention needed");
    expect(markup).toContain(summary.health.queue.message);
    expect(markup).not.toContain("File operations remain available.");
    expect(markup).not.toContain("0 queued, 0 running, 0 failed, 0 dead");
  });
});
