import os from "node:os";
import path from "node:path";
import {
  access,
  mkdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  cleanupExpiredStagingFiles,
  recoverPendingDeletes,
} from "./storage-maintenance.js";

const createTempRoot = () =>
  path.join(os.tmpdir(), `staaash-worker-${Date.now()}-${Math.random()}`);

const createPendingDeleteFixture = () => {
  const root = createTempRoot();
  return {
    root,
    pendingDeleteRoot: path.join(root, "pending-delete"),
    originalPath: path.join(root, "trash", "file.txt"),
  };
};

describe("worker storage maintenance", () => {
  it("cleans up expired staged uploads only after ttl", async () => {
    const tmpRoot = createTempRoot();
    await mkdir(tmpRoot, { recursive: true });
    const staleUpload = path.join(tmpRoot, "stale.upload");
    const activeUpload = path.join(tmpRoot, "active.upload");
    await writeFile(staleUpload, "stale", "utf8");
    await writeFile(activeUpload, "active", "utf8");

    const now = new Date("2026-04-01T12:00:00.000Z");
    const ttlMs = 60_000;
    await utimes(
      staleUpload,
      new Date(now.getTime() - ttlMs - 1),
      new Date(now.getTime() - ttlMs - 1),
    );
    await utimes(
      activeUpload,
      new Date(now.getTime() - ttlMs + 1),
      new Date(now.getTime() - ttlMs + 1),
    );

    await cleanupExpiredStagingFiles({
      tmpRoot,
      ttlMs,
      protectedPaths: [],
      now,
    });

    await expect(access(staleUpload)).rejects.toBeDefined();
    await expect(access(activeUpload)).resolves.toBeUndefined();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("protects canonical persisted paths while deleting prefix-only orphans", async () => {
    const tmpRoot = createTempRoot();
    await mkdir(tmpRoot, { recursive: true });
    const protectedUpload = path.join(tmpRoot, "custom-session-name.upload");
    const prefixOnlyOrphan = path.join(tmpRoot, "rs-no-session.upload");
    await writeFile(protectedUpload, "protected", "utf8");
    await writeFile(prefixOnlyOrphan, "orphan", "utf8");

    const now = new Date("2026-04-01T12:00:00.000Z");
    const ttlMs = 60_000;
    const staleTime = new Date(now.getTime() - ttlMs - 1);
    await utimes(protectedUpload, staleTime, staleTime);
    await utimes(prefixOnlyOrphan, staleTime, staleTime);

    await cleanupExpiredStagingFiles({
      tmpRoot,
      ttlMs,
      protectedPaths: [
        path.join(tmpRoot, "nested", "..", "custom-session-name.upload"),
      ],
      now,
    });

    await expect(access(protectedUpload)).resolves.toBeUndefined();
    await expect(access(prefixOnlyOrphan)).rejects.toBeDefined();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("leaves non-staging and nested maintenance data untouched", async () => {
    const tmpRoot = createTempRoot();
    const heartbeatPath = path.join(tmpRoot, "worker-heartbeat.json");
    const lockPath = path.join(tmpRoot, "locks", "upload.lock");
    const pendingDeletePath = path.join(
      tmpRoot,
      "pending-delete",
      "stale.upload",
    );
    const derivativePath = path.join(tmpRoot, "derivatives", "stale.upload");
    const ordinaryFile = path.join(tmpRoot, "ordinary.tmp");
    const uploadDirectory = path.join(tmpRoot, "directory.upload");
    const filesToKeep = [
      heartbeatPath,
      lockPath,
      pendingDeletePath,
      derivativePath,
      ordinaryFile,
    ];
    await mkdir(path.dirname(lockPath), { recursive: true });
    await mkdir(path.dirname(pendingDeletePath), { recursive: true });
    await mkdir(path.dirname(derivativePath), { recursive: true });
    await mkdir(uploadDirectory);
    await Promise.all(
      filesToKeep.map((filePath) => writeFile(filePath, "keep", "utf8")),
    );

    const now = new Date("2026-04-01T12:00:00.000Z");
    const ttlMs = 60_000;
    const staleTime = new Date(now.getTime() - ttlMs - 1);
    await Promise.all(
      filesToKeep.map((filePath) => utimes(filePath, staleTime, staleTime)),
    );

    await cleanupExpiredStagingFiles({
      tmpRoot,
      ttlMs,
      protectedPaths: [],
      now,
    });

    for (const filePath of [...filesToKeep, uploadDirectory]) {
      await expect(access(filePath)).resolves.toBeUndefined();
    }
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("restores quarantined deletes when the db row still exists", async () => {
    const { root, pendingDeleteRoot, originalPath } =
      createPendingDeleteFixture();
    const quarantineBlobPath = path.join(pendingDeleteRoot, "op-1.bin");
    const quarantineManifestPath = path.join(pendingDeleteRoot, "op-1.json");
    await mkdir(path.dirname(originalPath), { recursive: true });
    await mkdir(pendingDeleteRoot, { recursive: true });
    await writeFile(quarantineBlobPath, "restore me", "utf8");
    await writeFile(
      quarantineManifestPath,
      JSON.stringify({
        operationId: "op-1",
        fileId: "file-1",
        originalStorageKey: ".trash/member-1/file.txt",
        originalPath,
        quarantineBlobPath,
        quarantineManifestPath,
        createdAt: new Date().toISOString(),
      }),
      "utf8",
    );

    await recoverPendingDeletes({
      pendingDeleteRoot,
      client: {
        file: {
          async findUnique() {
            return {
              id: "file-1",
              storageKey: ".trash/member-1/file.txt",
            };
          },
        },
      },
    });

    await expect(readFile(originalPath, "utf8")).resolves.toBe("restore me");
    await expect(access(quarantineManifestPath)).rejects.toBeDefined();
    await rm(root, { recursive: true, force: true });
  });

  it("finalizes quarantined deletes when the db row is gone", async () => {
    const { root, pendingDeleteRoot, originalPath } =
      createPendingDeleteFixture();
    const quarantineBlobPath = path.join(pendingDeleteRoot, "op-2.bin");
    const quarantineManifestPath = path.join(pendingDeleteRoot, "op-2.json");
    await mkdir(pendingDeleteRoot, { recursive: true });
    await writeFile(quarantineBlobPath, "delete me", "utf8");
    await writeFile(
      quarantineManifestPath,
      JSON.stringify({
        operationId: "op-2",
        fileId: "file-2",
        originalStorageKey: ".trash/member-1/file.txt",
        originalPath,
        quarantineBlobPath,
        quarantineManifestPath,
        createdAt: new Date().toISOString(),
      }),
      "utf8",
    );

    await recoverPendingDeletes({
      pendingDeleteRoot,
      client: {
        file: {
          async findUnique() {
            return null;
          },
        },
      },
    });

    await expect(access(quarantineBlobPath)).rejects.toBeDefined();
    await expect(access(quarantineManifestPath)).rejects.toBeDefined();
    await rm(root, { recursive: true, force: true });
  });
});
