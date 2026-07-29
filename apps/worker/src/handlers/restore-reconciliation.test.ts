import os from "node:os";
import path from "node:path";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";

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
} = await import("./restore-reconciliation.js");

const createTempFilesRoot = () =>
  path.join(
    os.tmpdir(),
    `staaash-restore-reconcile-${Date.now()}-${Math.random()}`,
  );

describe("restore reconciliation worker handler", () => {
  it("detects missing originals from DB metadata", async () => {
    const filesRoot = createTempFilesRoot();
    await mkdir(path.join(filesRoot, "files", "member"), {
      recursive: true,
    });
    await writeFile(
      path.join(filesRoot, "files", "member", "present.txt"),
      "ok",
      "utf8",
    );

    await expect(
      collectMissingOriginals(
        [
          {
            id: "file-1",
            storageKey: "files/member/present.txt",
          },
          {
            id: "file-2",
            storageKey: "files/member/missing.txt",
          },
        ],
        filesRoot,
      ),
    ).resolves.toEqual([
      {
        fileId: "file-2",
        storageKey: "files/…/missing.txt",
      },
    ]);

    await rm(filesRoot, { recursive: true, force: true });
  });

  it("treats a symlinked original as missing even without a checksum", async () => {
    const filesRoot = createTempFilesRoot();
    const outside = `${filesRoot}-outside.txt`;
    await mkdir(path.join(filesRoot, "files", "member"), { recursive: true });
    await writeFile(outside, "private", "utf8");
    await symlink(
      outside,
      path.join(filesRoot, "files", "member", "linked.txt"),
      "file",
    );

    await expect(
      collectMissingOriginals(
        [{ id: "file-link", storageKey: "files/member/linked.txt" }],
        filesRoot,
      ),
    ).resolves.toEqual([
      { fileId: "file-link", storageKey: "files/…/linked.txt" },
    ]);

    await rm(filesRoot, { recursive: true, force: true });
    await rm(outside, { force: true });
  });

  it("detects unexplained files across committed and transitional namespaces", async () => {
    const filesRoot = createTempFilesRoot();
    await mkdir(path.join(filesRoot, "files", "member"), {
      recursive: true,
    });
    await mkdir(path.join(filesRoot, ".trash", "member"), {
      recursive: true,
    });
    await mkdir(path.join(filesRoot, "tmp", "pending-delete"), {
      recursive: true,
    });
    await mkdir(path.join(filesRoot, "tmp", "locks"), {
      recursive: true,
    });
    await mkdir(path.join(filesRoot, "tmp", "derivatives"), {
      recursive: true,
    });
    await writeFile(
      path.join(filesRoot, "files", "member", "known.txt"),
      "ok",
      "utf8",
    );
    await writeFile(
      path.join(filesRoot, "files", "member", "orphan.txt"),
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
    await writeFile(
      path.join(filesRoot, "tmp", "locks", "ignored.lock"),
      "ignore me",
      "utf8",
    );
    await writeFile(
      path.join(filesRoot, "tmp", "ignored.upload"),
      "ignore me",
      "utf8",
    );
    await writeFile(
      path.join(filesRoot, "tmp", "derivatives", "ignored.tmp"),
      "ignore me",
      "utf8",
    );
    await mkdir(path.join(filesRoot, "tmp", "quarantine", "mutation", "tree"), {
      recursive: true,
    });
    await writeFile(
      path.join(
        filesRoot,
        "tmp",
        "quarantine",
        "mutation",
        "tree",
        "nested.bin",
      ),
      "tracked",
      "utf8",
    );
    await mkdir(
      path.join(filesRoot, "tmp", "quarantine", "mutation", "tree2"),
      {
        recursive: true,
      },
    );
    await writeFile(
      path.join(
        filesRoot,
        "tmp",
        "quarantine",
        "mutation",
        "tree2",
        "not-tracked.bin",
      ),
      "orphan",
      "utf8",
    );

    await expect(
      collectOrphanedStorageKeys({
        filesRoot,
        knownStorageKeys: new Set(["files/member/known.txt"]),
        knownStoragePrefixes: new Set(["tmp/quarantine/mutation/tree"]),
      }),
    ).resolves.toEqual([
      "files/…/orphan.txt",
      ".trash/…/trashed-orphan.txt",
      "tmp/…/ignored.tmp",
      "tmp/ignored.upload",
      "tmp/…/ignored.lock",
      "tmp/…/ignored.txt",
      "tmp/…/not-tracked.bin",
    ]);

    await rm(filesRoot, { recursive: true, force: true });
  });

  it("collects both missing originals and orphans", async () => {
    const filesRoot = createTempFilesRoot();
    await mkdir(path.join(filesRoot, "files", "member"), {
      recursive: true,
    });
    await writeFile(
      path.join(filesRoot, "files", "member", "known.txt"),
      "ok",
      "utf8",
    );
    await writeFile(
      path.join(filesRoot, "files", "member", "orphan.txt"),
      "orphan",
      "utf8",
    );

    await expect(
      collectRestoreReconciliationIssues({
        filesRoot,
        fileRecords: [
          {
            id: "file-1",
            storageKey: "files/member/known.txt",
          },
          {
            id: "file-2",
            storageKey: "files/member/missing.txt",
          },
        ],
      }),
    ).resolves.toEqual({
      missingOriginals: [
        {
          fileId: "file-2",
          storageKey: "files/…/missing.txt",
        },
      ],
      orphanedStorageKeys: ["files/…/orphan.txt"],
    });

    await rm(filesRoot, { recursive: true, force: true });
  });

  it("creates, runs, and completes reconciliation jobs", async () => {
    const filesRoot = createTempFilesRoot();
    const updateMany = vi.fn(async () => ({ count: 1 }));
    await mkdir(path.join(filesRoot, "files", "member"), {
      recursive: true,
    });
    await writeFile(
      path.join(filesRoot, "files", "member", "known.txt"),
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
                storageKey: "files/member/known.txt",
              },
            ];
          },
          updateMany,
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
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["file-1"],
        },
      },
      data: {
        storageStatus: "available",
        storageCheckedAt: expect.any(Date),
        storageMissingAt: null,
      },
    });
    expect(completeRestoreReconciliationRun).toHaveBeenCalledWith({
      backgroundJobId: "job-1",
      details: {
        missingOriginals: [],
        orphanedStorageKeys: [],
        mutationTrackedStorageKeys: [],
        recoveryRequiredMutations: [],
      },
    });

    await rm(filesRoot, { recursive: true, force: true });
  });

  it("marks missing originals and restores available status when bytes exist again", async () => {
    const filesRoot = createTempFilesRoot();
    const updateMany = vi.fn(async () => ({ count: 1 }));
    await mkdir(path.join(filesRoot, "files", "member"), {
      recursive: true,
    });
    await mkdir(path.join(filesRoot, ".trash", "member"), {
      recursive: true,
    });
    await writeFile(
      path.join(filesRoot, "files", "member", "restored.txt"),
      "ok",
      "utf8",
    );
    await writeFile(
      path.join(filesRoot, "files", "member", "orphan.txt"),
      "orphan",
      "utf8",
    );
    await writeFile(
      path.join(filesRoot, ".trash", "member", "trashed-orphan.txt"),
      "orphan",
      "utf8",
    );

    await handleRestoreReconciliation(
      {
        id: "job-2",
        kind: "restore.reconcile",
        status: "running",
        payloadJson: {},
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
                id: "file-restored",
                storageKey: "files/member/restored.txt",
              },
              {
                id: "file-missing",
                storageKey: "files/member/missing.txt",
              },
            ];
          },
          updateMany,
        },
      },
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["file-restored"],
        },
      },
      data: {
        storageStatus: "available",
        storageCheckedAt: expect.any(Date),
        storageMissingAt: null,
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["file-missing"],
        },
      },
      data: {
        storageStatus: "missing",
        storageCheckedAt: expect.any(Date),
        storageMissingAt: expect.any(Date),
      },
    });
    expect(completeRestoreReconciliationRun).toHaveBeenCalledWith({
      backgroundJobId: "job-2",
      details: {
        missingOriginals: [
          {
            fileId: "file-missing",
            storageKey: "files/…/missing.txt",
          },
        ],
        orphanedStorageKeys: [
          "files/…/orphan.txt",
          ".trash/…/trashed-orphan.txt",
        ],
        mutationTrackedStorageKeys: [],
        recoveryRequiredMutations: [],
      },
    });

    await rm(filesRoot, { recursive: true, force: true });
  });

  it("does not overwrite storage status for unresolved mutation files", async () => {
    const filesRoot = createTempFilesRoot();
    const updateMany = vi.fn(async () => ({ count: 1 }));
    await mkdir(path.join(filesRoot, "files", "member"), { recursive: true });
    await writeFile(
      path.join(filesRoot, "files", "member", "blocked.txt"),
      "ok",
      "utf8",
    );

    await handleRestoreReconciliation(
      {
        id: "job-unresolved",
        kind: "restore.reconcile",
        status: "running",
        payloadJson: {},
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
                id: "file-blocked",
                storageKey: "files/member/blocked.txt",
              },
            ];
          },
          updateMany,
        },
        storageMutationEntity: {
          async findMany() {
            return [{ entityId: "file-blocked" }];
          },
        },
      },
    );

    expect(updateMany).not.toHaveBeenCalled();
    await rm(filesRoot, { recursive: true, force: true });
  });

  it("does not classify live worker and generated temp files as orphans", async () => {
    const filesRoot = createTempFilesRoot();
    const heartbeatPath = path.join(filesRoot, "tmp", "worker-heartbeat.json");
    const derivativeTemp = path.join(
      filesRoot,
      "tmp",
      "derivatives",
      "derivative-1.jpg.tmp",
    );
    const archiveTemp = path.join(
      filesRoot,
      "tmp",
      "archives",
      "archive-1.zip.tmp",
    );
    const probe = path.join(filesRoot, "tmp", "capability", "probe-current");
    for (const target of [heartbeatPath, derivativeTemp, archiveTemp, probe]) {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, "live", "utf8");
    }
    const updateMany = vi.fn(async () => ({ count: 0 }));

    await handleRestoreReconciliation(
      {
        id: "job-live-files",
        kind: "restore.reconcile",
        status: "running",
        payloadJson: {},
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
        heartbeatPath,
        pendingDeleteRoot: path.join(filesRoot, "tmp", "pending-delete"),
        uploadStagingTtlMs: 1,
      },
      {
        file: { findMany: async () => [], updateMany },
        mediaDerivative: {
          findMany: async () => [
            {
              id: "derivative-1",
              fileId: "file-1",
              kind: "preview",
              profile: "default",
              storageKey: null,
            },
          ],
        },
        backgroundJob: {
          findMany: async () => [
            {
              kind: "media.derivative.generate",
              dedupeKey: "media.derivative.generate:file-1:preview:default",
            },
            {
              kind: "zip.archive.generate",
              dedupeKey: "zip.archive.generate:archive-1",
            },
          ],
        },
      },
    );

    expect(completeRestoreReconciliationRun).toHaveBeenLastCalledWith({
      backgroundJobId: "job-live-files",
      details: expect.objectContaining({ orphanedStorageKeys: [] }),
    });
    await rm(filesRoot, { recursive: true, force: true });
  });
});
