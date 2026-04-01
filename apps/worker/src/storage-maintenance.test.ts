import os from "node:os";
import path from "node:path";
import { access, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  cleanupExpiredStagingFiles,
  recoverPendingDeletes,
  shouldCleanupStagedUpload,
} from "./storage-maintenance";

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

    expect(
      shouldCleanupStagedUpload(new Date(now.getTime() - ttlMs - 1), ttlMs, now),
    ).toBe(true);
    expect(
      shouldCleanupStagedUpload(new Date(now.getTime() - ttlMs + 1), ttlMs, now),
    ).toBe(false);

    await cleanupExpiredStagingFiles({
      tmpRoot,
      ttlMs,
      now,
    });

    await expect(access(staleUpload)).rejects.toBeDefined();
    await expect(access(activeUpload)).resolves.toBeUndefined();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("restores quarantined deletes when the db row still exists", async () => {
    const { root, pendingDeleteRoot, originalPath } = createPendingDeleteFixture();
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
    const { root, pendingDeleteRoot, originalPath } = createPendingDeleteFixture();
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
