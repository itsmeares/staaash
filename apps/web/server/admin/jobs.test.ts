import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  lastRuns: vi.fn(),
  summary: vi.fn(),
  files: vi.fn(),
  targets: vi.fn(),
  events: vi.fn(),
  findJob: vi.fn(),
}));
vi.mock("@staaash/db/admin", async (original) => ({
  ...(await original<typeof import("@staaash/db/admin")>()),
  listAdminBackgroundJobs: mocks.list,
  listAdminBackgroundJobItems: mocks.lastRuns,
}));
vi.mock("@staaash/db/jobs", async (original) => ({
  ...(await original<typeof import("@staaash/db/jobs")>()),
  getQueueOperationalSummary: mocks.summary,
  listBackgroundJobEvents: mocks.events,
}));
vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({
    file: { findMany: mocks.files },
    backgroundJob: { findMany: mocks.targets, findUnique: mocks.findJob },
  }),
}));

import {
  getAdminJobEvents,
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
  lastError:
    "Command failed: ffprobe -v quiet /data/files/files/mia/holiday.mov",
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
      { id: "file-1", owner: { displayName: "Mia Chen", email: "mia@x.test" } },
    ]);
  });

  it("names whose drive a failed preview is in, never the file, and handles deleted files", async () => {
    mocks.lastRuns.mockImplementation(async ({ kind, status }) =>
      status && kind === "media.derivative.generate"
        ? [previewJob("job-1", "file-1"), previewJob("job-2", "missing")]
        : [],
    );
    const snapshot = await getAdminJobStateSnapshot();
    expect(snapshot.problems.map((job) => job.ownerName)).toEqual([
      "Mia Chen",
      null,
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("holiday.mov");
  });

  it("reads each kind's failed runs on its own and leaves zips out", async () => {
    await getAdminJobStateSnapshot();
    const kinds = mocks.lastRuns.mock.calls.map(([filters]) => filters.kind);
    expect(kinds).toContain("restore.reconcile");
    expect(kinds).not.toContain("zip.archive.generate");
    expect(mocks.lastRuns).toHaveBeenCalledWith({
      kind: "restore.reconcile",
      status: ["failed", "dead"],
      limit: 20,
    });
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

  it("turns preview errors into plain reasons without paths", async () => {
    const errors = [
      "Command failed: ffprobe /data/files/files/mia/a.mov",
      "File f1 not found or deleted.",
      "Source file has an unfinished storage mutation.",
      "EACCES: /data/files/files/mia/Storage is busy/a.mov",
      "Command failed: ffprobe /data/files/files/mia/not found or deleted.mov",
      "Cancelled by admin.",
      null,
    ];
    mocks.list.mockResolvedValue({
      items: errors.map((lastError, index) => ({
        ...previewJob(`job-${index}`, "file-1"),
        lastError,
      })),
    });
    const { items } = await getAdminJobListResponse(
      parseAdminJobFilters({ status: "failed,dead" }),
    );
    expect(items.map((job) => job.lastError)).toEqual([
      "Couldn't read this file.",
      "The file was deleted.",
      "Storage is busy. Try again shortly.",
      "Couldn't make a preview.",
      "Couldn't read this file.",
      "Cancelled by admin.",
      null,
    ]);
  });
  it("keeps the steps Staaash writes and turns a preview's errors into plain reasons", async () => {
    mocks.findJob.mockResolvedValue({ kind: "media.derivative.generate" });
    mocks.events.mockResolvedValue([
      { id: "1", type: "started", message: "Job handler started." },
      {
        id: "2",
        type: "retry_scheduled",
        message: "Command failed: ffprobe -v quiet /data/files/files/mia/a.mov",
      },
    ]);
    expect(
      (await getAdminJobEvents("job-1")).map((event) => event.message),
    ).toEqual(["Job handler started.", "Couldn't read this file."]);
  });
});
