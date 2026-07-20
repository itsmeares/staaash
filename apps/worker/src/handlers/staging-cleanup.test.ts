import os from "node:os";
import path from "node:path";
import { access, lstat, mkdir, rm, utimes, writeFile } from "node:fs/promises";

import {
  STAGING_CLEANUP_JOB_KIND,
  type BackgroundJobRecord,
} from "@staaash/db/jobs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPrismaMock = vi.fn();

vi.mock("@staaash/db/client", () => ({
  getPrisma: getPrismaMock,
}));

type TestUploadSession = {
  id: string;
  status: string;
  expiresAt: Date;
  tmpPath: string;
  terminalAt: Date | null;
  stagingReleasedAt: Date | null;
  cleanupAttemptCount: number;
};

const fixedNow = new Date("2026-04-06T12:00:00.000Z");
const stagingTtlMs = 2 * 60 * 60 * 1000;

const createTempRoot = () =>
  path.join(os.tmpdir(), `staaash-staging-${Date.now()}-${Math.random()}`);

const createJob = (): BackgroundJobRecord => ({
  id: "job-1",
  kind: STAGING_CLEANUP_JOB_KIND,
  status: "queued",
  payloadJson: {},
  dedupeKey: null,
  runAt: fixedNow,
  lockedAt: null,
  lockedBy: null,
  attemptCount: 0,
  maxAttempts: 5,
  lastError: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
});

const createSessionClient = (sessions: TestUploadSession[]) => {
  const findMany = vi.fn(async (query: any) => {
    let matches = [...sessions];
    if (query.where?.status?.in) {
      const statuses = new Set(query.where.status.in);
      matches = matches.filter((session) => statuses.has(session.status));
    }
    if (query.where?.expiresAt?.lte) {
      matches = matches.filter(
        (session) => session.expiresAt <= query.where.expiresAt.lte,
      );
    }
    if (query.where?.stagingReleasedAt === null) {
      matches = matches.filter((session) => session.stagingReleasedAt === null);
    }
    if (query.where?.stagingReleasedAt?.not === null) {
      matches = matches.filter((session) => session.stagingReleasedAt !== null);
    }
    if (query.where?.terminalAt?.lte) {
      matches = matches.filter(
        (session) =>
          session.terminalAt !== null &&
          session.terminalAt <= query.where.terminalAt.lte,
      );
    }
    return matches.map((session) => ({
      id: session.id,
      tmpPath: session.tmpPath,
    }));
  });

  const updateMany = vi.fn(async (query: any) => {
    const session = sessions.find(
      (candidate) => candidate.id === query.where.id,
    );
    if (!session) return { count: 0 };
    if (
      query.where.status?.in &&
      !query.where.status.in.includes(session.status)
    ) {
      return { count: 0 };
    }
    if (query.data.status) session.status = query.data.status;
    if (query.data.terminalAt) session.terminalAt = query.data.terminalAt;
    if (query.data.stagingReleasedAt) {
      session.stagingReleasedAt = query.data.stagingReleasedAt;
    }
    if (query.data.cleanupAttemptCount?.increment) {
      session.cleanupAttemptCount += query.data.cleanupAttemptCount.increment;
    }
    return { count: 1 };
  });

  const deleteMany = vi.fn(async (query: any) => {
    const ids = new Set(query.where?.id?.in ?? []);
    const before = sessions.length;
    for (let index = sessions.length - 1; index >= 0; index -= 1) {
      if (ids.has(sessions[index]!.id)) sessions.splice(index, 1);
    }
    return { count: before - sessions.length };
  });

  const client: any = {
    uploadSession: { findMany, updateMany, deleteMany },
    uploadChunk: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
  client.$transaction = (callback: (tx: unknown) => Promise<unknown>) =>
    callback(client);

  return {
    client,
    findMany,
  };
};

const expectPathToExist = async (filePath: string) => {
  await expect(access(filePath)).resolves.toBeUndefined();
};

const expectPathToBeMissing = async (filePath: string) => {
  await expect(access(filePath)).rejects.toBeDefined();
};

describe("staging cleanup handler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(() => {
    vi.useRealTimers();
    getPrismaMock.mockReset();
    vi.resetModules();
  });

  it("keeps stale bytes for active unexpired sessions and cleans unprotected files", async () => {
    const filesRoot = createTempRoot();
    const tmpRoot = path.join(filesRoot, "tmp");
    await mkdir(tmpRoot, { recursive: true });

    const filePaths = {
      created: path.join(tmpRoot, "rs-created.upload"),
      receiving: path.join(tmpRoot, "rs-receiving.upload"),
      persistedCustom: path.join(tmpRoot, "persisted-custom.upload"),
      expired: path.join(tmpRoot, "rs-expired.upload"),
      boundary: path.join(tmpRoot, "rs-boundary.upload"),
      completed: path.join(tmpRoot, "rs-completed.upload"),
      cancelled: path.join(tmpRoot, "rs-cancelled.upload"),
      failed: path.join(tmpRoot, "rs-failed.upload"),
      prefixOnlyOrphan: path.join(tmpRoot, "rs-orphan.upload"),
      freshOrdinary: path.join(tmpRoot, "fresh.upload"),
    };
    await Promise.all(
      Object.values(filePaths).map((filePath) =>
        writeFile(filePath, "staged bytes", "utf8"),
      ),
    );

    const staleTime = new Date(fixedNow.getTime() - stagingTtlMs - 1);
    const stalePaths = Object.entries(filePaths)
      .filter(([name]) => name !== "freshOrdinary")
      .map(([, filePath]) => filePath);
    await Promise.all(
      stalePaths.map((filePath) => utimes(filePath, staleTime, staleTime)),
    );

    const futureExpiry = new Date(fixedNow.getTime() + 21 * 60 * 60 * 1000);
    const sessions: TestUploadSession[] = [
      {
        id: "created",
        status: "created",
        expiresAt: futureExpiry,
        tmpPath: filePaths.created,
        terminalAt: null,
        stagingReleasedAt: null,
        cleanupAttemptCount: 0,
      },
      {
        id: "receiving",
        status: "receiving",
        expiresAt: futureExpiry,
        tmpPath: filePaths.receiving,
        terminalAt: null,
        stagingReleasedAt: null,
        cleanupAttemptCount: 0,
      },
      {
        id: "persisted-custom",
        status: "created",
        expiresAt: futureExpiry,
        tmpPath: filePaths.persistedCustom,
        terminalAt: null,
        stagingReleasedAt: null,
        cleanupAttemptCount: 0,
      },
      {
        id: "expired",
        status: "created",
        expiresAt: new Date(fixedNow.getTime() - 1),
        tmpPath: filePaths.expired,
        terminalAt: null,
        stagingReleasedAt: null,
        cleanupAttemptCount: 0,
      },
      {
        id: "boundary",
        status: "receiving",
        expiresAt: fixedNow,
        tmpPath: filePaths.boundary,
        terminalAt: null,
        stagingReleasedAt: null,
        cleanupAttemptCount: 0,
      },
      {
        id: "completed",
        status: "completed",
        expiresAt: futureExpiry,
        tmpPath: filePaths.completed,
        terminalAt: fixedNow,
        stagingReleasedAt: null,
        cleanupAttemptCount: 0,
      },
      {
        id: "cancelled",
        status: "cancelled",
        expiresAt: futureExpiry,
        tmpPath: filePaths.cancelled,
        terminalAt: fixedNow,
        stagingReleasedAt: null,
        cleanupAttemptCount: 0,
      },
      {
        id: "failed",
        status: "failed",
        expiresAt: futureExpiry,
        tmpPath: filePaths.failed,
        terminalAt: fixedNow,
        stagingReleasedAt: null,
        cleanupAttemptCount: 0,
      },
    ];
    const { client, findMany } = createSessionClient(sessions);
    getPrismaMock.mockReturnValue(client);

    const createdStats = await lstat(filePaths.created);
    expect(futureExpiry > fixedNow).toBe(true);
    expect(fixedNow.getTime() - createdStats.mtime.getTime()).toBeGreaterThan(
      stagingTtlMs,
    );

    const { handleStagingCleanup } = await import("./staging-cleanup.js");
    await handleStagingCleanup(createJob(), {
      filesRoot,
      tmpRoot,
      heartbeatPath: path.join(tmpRoot, "worker-heartbeat.json"),
      pendingDeleteRoot: path.join(tmpRoot, "pending-delete"),
      uploadStagingTtlMs: stagingTtlMs,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ expiresAt: { lte: fixedNow } }),
      }),
    );
    expect(findMany).toHaveBeenCalledWith({
      where: { stagingReleasedAt: null },
      select: { id: true, tmpPath: true },
    });
    await expectPathToExist(filePaths.created);
    await expectPathToExist(filePaths.receiving);
    await expectPathToExist(filePaths.persistedCustom);
    await expectPathToExist(filePaths.freshOrdinary);
    await expectPathToBeMissing(filePaths.expired);
    await expectPathToBeMissing(filePaths.boundary);
    await expectPathToBeMissing(filePaths.completed);
    await expectPathToBeMissing(filePaths.cancelled);
    await expectPathToBeMissing(filePaths.failed);
    await expectPathToBeMissing(filePaths.prefixOnlyOrphan);
    expect(
      sessions.some(
        (session) =>
          session.id === "created" &&
          ["created", "receiving"].includes(session.status) &&
          session.expiresAt > fixedNow,
      ),
    ).toBe(true);

    await rm(filesRoot, { recursive: true, force: true });
  });

  it("fails before deletion when active-session lookup fails", async () => {
    const filesRoot = createTempRoot();
    const tmpRoot = path.join(filesRoot, "tmp");
    const staleUpload = path.join(tmpRoot, "stale.upload");
    await mkdir(tmpRoot, { recursive: true });
    await writeFile(staleUpload, "keep on db failure", "utf8");
    const staleTime = new Date(fixedNow.getTime() - stagingTtlMs - 1);
    await utimes(staleUpload, staleTime, staleTime);
    getPrismaMock.mockReturnValue({
      uploadSession: {
        findMany: vi.fn().mockRejectedValue(new Error("session lookup failed")),
      },
    });

    const { handleStagingCleanup } = await import("./staging-cleanup.js");
    await expect(
      handleStagingCleanup(createJob(), {
        filesRoot,
        tmpRoot,
        heartbeatPath: path.join(tmpRoot, "worker-heartbeat.json"),
        pendingDeleteRoot: path.join(tmpRoot, "pending-delete"),
        uploadStagingTtlMs: stagingTtlMs,
      }),
    ).rejects.toThrow("session lookup failed");
    await expectPathToExist(staleUpload);

    await rm(filesRoot, { recursive: true, force: true });
  });
});
