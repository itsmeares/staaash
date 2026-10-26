import { readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";

import {
  assertUploadSizeAllowed,
  buildSafeRenamedFileName,
  parseUploadManifest,
  stageUpload,
} from "@/server/uploads";
import { getStorageRoot } from "@/server/storage";

describe("upload guardrails", () => {
  it("rejects a NUL name before reading or staging upload bytes", async () => {
    const file = new File(["payload"], "normal.txt", { type: "text/plain" });
    const stream = vi.spyOn(file, "stream");
    await expect(
      stageUpload({
        clientKey: "nul-name",
        originalName: "bad\u0000name.txt",
        conflictStrategy: "safeRename",
        file,
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "FILE_NAME_INVALID_CHARACTER",
    });
    expect(stream).not.toHaveBeenCalled();
  });

  it("reads a null client time as no time, not 1970", () => {
    const item = (clientModifiedAt: unknown) =>
      parseUploadManifest(
        JSON.stringify([
          { clientKey: "a", originalName: "a.txt", clientModifiedAt },
        ]),
      )[0]!.clientModifiedAt;
    expect(item(null)).toBeNull();
    expect(item(undefined)).toBeUndefined();
    expect(item("2024-08-09T10:11:12.345Z")).toEqual(
      new Date("2024-08-09T10:11:12.345Z"),
    );
  });

  it("rejects oversized uploads", async () => {
    await expect(
      assertUploadSizeAllowed(Number.MAX_SAFE_INTEGER),
    ).rejects.toThrow("configured maximum size");
  });

  it("generates keep-both filenames with numeric suffixes", () => {
    expect(
      buildSafeRenamedFileName("photo.jpg", ["photo.jpg", "photo (1).jpg"]),
    ).toBe("photo (2).jpg");
  });

  it("trims the base name so a safe-rename suffix still fits 255 bytes", () => {
    const original = `${"a".repeat(249)}.txt`;
    const renamed = buildSafeRenamedFileName(original, [original]);

    expect(Buffer.byteLength(original)).toBe(253);
    expect(Buffer.byteLength(renamed)).toBe(255);
    expect(renamed).toBe(`${"a".repeat(247)} (1).txt`);
  });

  it("never splits a multibyte character when trimming", () => {
    const original = `${"東".repeat(84)}.txt`;
    const renamed = buildSafeRenamedFileName(original, [original]);

    expect(Buffer.byteLength(renamed)).toBeLessThanOrEqual(255);
    expect(renamed).toMatch(/^東+ \(1\)\.txt$/);
  });

  it("times out staged uploads and removes temp files", async () => {
    const tmpRoot = path.join(getStorageRoot(), "tmp");
    const beforeEntries = new Set(await readdir(tmpRoot).catch(() => []));
    const encoder = new TextEncoder();
    const slowFile = {
      type: "text/plain",
      stream: () =>
        new ReadableStream({
          start(controller) {
            setTimeout(() => {
              try {
                controller.enqueue(encoder.encode("delayed upload body"));
                controller.close();
              } catch {
                // The stream may already be closed when the timeout test aborts it.
              }
            }, 50);
          },
        }),
    } as File;

    await expect(
      stageUpload(
        {
          clientKey: "slow-upload",
          originalName: "slow.txt",
          conflictStrategy: "fail",
          file: slowFile,
        },
        Date.now() + 5,
      ),
    ).rejects.toMatchObject({
      code: "UPLOAD_TIMEOUT_EXCEEDED",
      status: 408,
    });

    await expect
      .poll(
        async () => {
          const afterEntries = await readdir(tmpRoot).catch(() => []);
          return afterEntries.filter(
            (entry) => entry.endsWith(".upload") && !beforeEntries.has(entry),
          );
        },
        {
          timeout: 1_000,
          interval: 50,
        },
      )
      .toEqual([]);
  });
});
