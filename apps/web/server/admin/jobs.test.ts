import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  lastRuns: vi.fn(),
  summary: vi.fn(),
  files: vi.fn(),
  targets: vi.fn(),
}));
vi.mock("@staaash/db/admin", async (original) => ({
  ...(await original<typeof import("@staaash/db/admin")>()),
  listAdminBackgroundJobs: mocks.list,
  listAdminBackgroundJobItems: mocks.lastRuns,
}));
vi.mock("@staaash/db/jobs", async (original) => ({
  ...(await original<typeof import("@staaash/db/jobs")>()),
  getQueueOperationalSummary: mocks.summary,
}));
vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({
    file: { findMany: mocks.files },
    backgroundJob: { findMany: mocks.targets },
  }),
}));

import {
  getAdminJobListResponse,
  getAdminJobStateSnapshot,
  getAdminProblemJobIds,
  parseAdminJobFilters,
} from "./jobs";

const date = new Date("2026-11-10T12:00:00Z");
const previewJob = (id: string, fileId: string) => ({
  id,
  kind: "media.derivative.generate",
  status: "dead",
  payloadJson: { fileId },
  runAt: date,
  createdAt: date,
  updatedAt: date,
  lockedAt: null,
  leaseExpiresAt: null,
  timeoutAt: null,
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
});

describe("admin job data", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.list.mockResolvedValue({
      items: [previewJob("job-1", "file-1"), previewJob("job-2", "missing")],
    });
    mocks.lastRuns.mockResolvedValue([]);
    mocks.summary.mockResolvedValue({ failed: 0, dead: 2 });
    mocks.files.mockResolvedValue([
      { id: "file-1", originalName: "holiday.mov" },
    ]);
  });

  it("names failed jobs in the snapshot and list, and handles deleted files", async () => {
    const snapshot = await getAdminJobStateSnapshot();
    const list = await getAdminJobListResponse(
      parseAdminJobFilters({ status: "failed,dead" }),
    );
    expect(snapshot.problems).toEqual(list.items);
    expect(snapshot.problems.map((job) => job.fileName)).toEqual([
      "holiday.mov",
      null,
    ]);
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: ["failed", "dead"], limit: 20 }),
    );
  });

  it("captures only failed and dead IDs of the selected kind in one database read", async () => {
    mocks.targets.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    expect(await getAdminProblemJobIds("media.derivative.generate")).toEqual([
      "a",
      "b",
    ]);
    expect(mocks.targets).toHaveBeenCalledWith({
      where: {
        kind: "media.derivative.generate",
        status: { in: ["failed", "dead"] },
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });
  });
});
