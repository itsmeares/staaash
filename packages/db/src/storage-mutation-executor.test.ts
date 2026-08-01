import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      if (args[1] !== "r") return handle;
      return {
        close: () => handle.close(),
        sync: async () => undefined,
      };
    },
  };
});

import {
  assertStorageFilesystemSupported,
  calculateCapturedTreeManifestDigest,
  StorageFilesystemUnsupportedError,
} from "./storage-mutation-executor";

describe("storage tree manifests", () => {
  it("does not confuse record separators inside logical paths", () => {
    const checksum = createHash("sha256").update("x").digest("hex");

    const digest = calculateCapturedTreeManifestDigest([
      {
        kind: "directory",
        relativeKey: `x\nF y 1 ${checksum}`,
      },
    ]);

    expect(digest).toMatch(/^v2:/);
    expect(digest).not.toBe(
      calculateCapturedTreeManifestDigest([
        { kind: "directory", relativeKey: "x" },
        {
          kind: "file",
          relativeKey: "y",
          sizeBytes: 1n,
          checksum,
        },
      ]),
    );
  });
});

describe("storage filesystem capability cache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-probes successful roots after the cache TTL and evicts failures", async () => {
    const filesRoot = await mkdtemp(
      path.join(os.tmpdir(), "staaash-storage-capability-"),
    );
    const capabilityRoot = path.join(filesRoot, "tmp", "capability");

    await assertStorageFilesystemSupported(filesRoot);
    await rm(capabilityRoot, { recursive: true });
    await writeFile(capabilityRoot, "not-a-directory", "utf8");

    await expect(
      assertStorageFilesystemSupported(filesRoot),
    ).resolves.toBeUndefined();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_001);
    await expect(
      assertStorageFilesystemSupported(filesRoot),
    ).rejects.toBeInstanceOf(StorageFilesystemUnsupportedError);

    await rm(capabilityRoot);
    await expect(
      assertStorageFilesystemSupported(filesRoot),
    ).resolves.toBeUndefined();
    await rm(filesRoot, { recursive: true, force: true });
  });
});
