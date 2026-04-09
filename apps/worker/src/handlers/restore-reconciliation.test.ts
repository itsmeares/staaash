import os from "node:os";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

vi.mock("@staaash/db/reconciliation", () => ({
  completeRestoreReconciliationRun: vi.fn(async (value) => value),
  createRestoreReconciliationRun: vi.fn(async (value) => value),
  findRestoreReconciliationRunByBackgroundJobId: vi.fn(async () => null),
  markRestoreReconciliationRunQueued: vi.fn(async (value) => value),
  markRestoreReconciliationRunRunning: vi.fn(async (value) => value),
}));

const {
  completeRestoreReconciliationRun,
  createRestoreReconciliationRun,
  findRestoreReconciliationRunByBackgroundJobId,
  markRestoreReconciliationRunRunning,
} = await import("@staaash/db/reconciliation");

const {
  collectMissingOriginals,
  collectOrphanedStorageKeys,
  collectRestoreReconciliationIssues,
  handleRestoreReconciliation,
} = await import("./restore-reconciliation");

const createTempFilesRoot = () =>
  path.join(
    os.tmpdir(),
    `staaash-restore-reconcile-${Date.now()}-${Math.random()}`,
  );

describe("restore reconciliation worker handler", () => {
  it("detects missing originals from DB metadata", async () => {
    const filesRoot = createTempFilesRoot();
    await mkdir(path.join(filesRoot, "library", "member"), {
      recursive: true,
    });
    await writeFile(
      path.join(filesRoot, "library", "member", "present.txt"),
      "ok",
      "utf8",
    );

    await expect(
      collectMissingOriginals(
        [
          {
            id: "file-1",
            storageKey: "library/member/present.txt",
          },
          {
            id: "file-2",
            storageKey: "library/member/missing.txt",
          },
        ],
        filesRoot,
      ),
    ).resolves.toEqual([
      {
        fileId: "file-2",
        storageKey: "library/member/missing.txt",
      },
    ]);

    await rm(filesRoot, { recursive: true, force: true });
  });

  it("detects orphans only inside committed storage trees", async () => {
    const filesRoot = createTempFilesRoot();
    await mkdir(path.join(filesRoot, "library", "member"), {
      recursive: true,
    });
    await mkdir(path.join(filesRoot, ".trash", "member"), {
      recursive: true,
    });
    await mkdir(path.join(filesRoot, "tmp", "pending-delete"), {
      recursive: true,
    });
    await writeFile(
      path.join(filesRoot, "library", "member", "known.txt"),
      "ok",
      "utf8",
    );
    await writeFile(
      path.join(filesRoot, "library", "member", "orphan.txt"),
      "orphan",
      "utf8",
    );
    await writeFile(
      path.join(filesRoot, ".trash", "member", "trashed-orphan.txt"),
      "orphan",
      "utf8",
    );
    await writeFile(
      path.join(filesRoot, "tmp", "pending-delete", "ignored.txt"),
      "ignore me",
      "utf8",
    );

    await expect(
      collectOrphanedStorageKeys({
        filesRoot,
        knownStorageKeys: new Set(["library/member/known.txt"]),
      }),
    ).resolves.toEqual([
      "library/member/orphan.txt",
      ".trash/member/trashed-orphan.txt",
    ]);

    await rm(filesRoot, { recursive: true, force: true });
  });

  it("collects both missing originals and orphans", async () => {
    const filesRoot = createTempFilesRoot();
    await mkdir(path.join(filesRoot, "library", "member"), {
      recursive: true,
    });
    await writeFile(
      path.join(filesRoot, "library", "member", "known.txt"),
      "ok",
      "utf8",
    );
    await writeFile(
      path.join(filesRoot, "library", "member", "orphan.txt"),
      "orphan",
      "utf8",
    );

    await expect(
      collectRestoreReconciliationIssues({
        filesRoot,
        fileRecords: [
          {
            id: "file-1",
            storageKey: "library/member/known.txt",
          },
          {
            id: "file-2",
            storageKey: "library/member/missing.txt",
          },
        ],
      }),
    ).resolves.toEqual({
      missingOriginals: [
        {
          fileId: "file-2",
          storageKey: "library/member/missing.txt",
        },
      ],
      orphanedStorageKeys: ["library/member/orphan.txt"],
    });

    await rm(filesRoot, { recursive: true, force: true });
  });

  it("creates, runs, and completes reconciliation jobs", async () => {
    const filesRoot = createTempFilesRoot();
    await mkdir(path.join(filesRoot, "library", "member"), {
      recursive: true,
    });
    await writeFile(
      path.join(filesRoot, "library", "member", "known.txt"),
      "ok",
      "utf8",
    );

    await handleRestoreReconciliation(
      {
        id: "job-1",
        kind: "restore.reconcile",
        status: "running",
        payloadJson: {
          triggeredByUserId: "owner-1",
        },
        dedupeKey: "restore.reconcile.manual",
        runAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        attemptCount: 1,
        maxAttempts: 5,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        filesRoot,
        tmpRoot: path.join(filesRoot, "tmp"),
        heartbeatPath: path.join(filesRoot, "tmp", "worker-heartbeat.json"),
        pendingDeleteRoot: path.join(filesRoot, "tmp", "pending-delete"),
        uploadStagingTtlMs: 1,
      },
      {
        file: {
          async findMany() {
            return [
              {
                id: "file-1",
                storageKey: "library/member/known.txt",
              },
            ];
          },
        },
      },
    );

    expect(findRestoreReconciliationRunByBackgroundJobId).toHaveBeenCalledWith(
      "job-1",
    );
    expect(createRestoreReconciliationRun).toHaveBeenCalledWith({
      triggeredByUserId: "owner-1",
      backgroundJobId: "job-1",
    });
    expect(markRestoreReconciliationRunRunning).toHaveBeenCalledWith({
      backgroundJobId: "job-1",
    });
    expect(completeRestoreReconciliationRun).toHaveBeenCalledWith({
      backgroundJobId: "job-1",
      details: {
        missingOriginals: [],
        orphanedStorageKeys: [],
      },
    });

    await rm(filesRoot, { recursive: true, force: true });
  });
});
