import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertUploadSizeAllowed,
  createUploadSession,
  getDefaultConflictResolution,
  getUploadStagingTtlMs,
  getUploadTimeoutBudgetMs,
  shouldCleanupStagedUpload,
  verifyUploadChecksum,
} from "@/server/uploads";

describe("upload guardrails", () => {
  it("uses prompt for interactive uploads", () => {
    expect(getDefaultConflictResolution("interactiveWeb")).toBe("prompt");
  });

  it("uses safe rename for bulk and api-like uploads", () => {
    expect(getDefaultConflictResolution("bulk")).toBe("safeRename");
    expect(getDefaultConflictResolution("api")).toBe("safeRename");
  });

  it("creates staged upload sessions", () => {
    const session = createUploadSession("interactiveWeb", "abc");

    expect(session.status).toBe("staged");
    expect(session.expectedChecksum).toBe("abc");
  });

  it("verifies file checksums", async () => {
    const filePath = path.join(os.tmpdir(), `staaash-upload-${Date.now()}.txt`);
    await writeFile(filePath, "hello world", "utf8");

    const result = await verifyUploadChecksum(
      filePath,
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );

    expect(result.checksumMatches).toBe(true);
    expect(result.status).toBe("verified");
  });

  it("cleans up staged uploads after the retention window", () => {
    const createdAt = new Date("2026-03-01T00:00:00.000Z");
    const now = new Date(createdAt.getTime() + getUploadStagingTtlMs() + 1);

    expect(shouldCleanupStagedUpload(createdAt, now)).toBe(true);
  });

  it("exposes a 60 minute upload timeout budget", () => {
    expect(getUploadTimeoutBudgetMs()).toBe(60 * 60 * 1000);
  });

  it("rejects oversized uploads", () => {
    expect(() => assertUploadSizeAllowed(Number.MAX_SAFE_INTEGER)).toThrow(
      RangeError,
    );
  });
});
