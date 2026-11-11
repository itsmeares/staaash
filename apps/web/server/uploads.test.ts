import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  buildSafeRenamedFileName,
  createUploadDeadline,
  parseUploadManifest,
  stageUpload,
} from "@/server/uploads";
import { getStorageRoot } from "@/server/storage";
import * as settings from "@/server/settings";

beforeEach(() => vi.restoreAllMocks());

const stageBytes = (size: number) =>
  stageUpload({
    clientKey: "size-check",
    originalName: "file.bin",
    conflictStrategy: "fail",
    file: new File([new Uint8Array(size)], "file.bin"),
  });

describe("saved upload settings", () => {
  it("applies increases and decreases to the next direct upload", async () => {
    const defaults = await settings.getSystemSettings();
    const read = vi.spyOn(settings, "getSystemSettings");
    read.mockResolvedValue({ ...defaults, maxUploadBytes: 10n });
    const first = await stageBytes(10);
    await rm(first.tmpPath);

    read.mockResolvedValue({ ...defaults, maxUploadBytes: 20n });
    const larger = await stageBytes(15);
    await rm(larger.tmpPath);

    read.mockResolvedValue({ ...defaults, maxUploadBytes: 10n });
    const before = await readdir(path.join(getStorageRoot(), "tmp"));
    await expect(stageBytes(15)).rejects.toMatchObject({
      code: "UPLOAD_SIZE_LIMIT_EXCEEDED",
      status: 413,
      message: "This file exceeds the server's 10 B upload limit.",
      details: { maxUploadBytes: "10" },
    });
    expect(await readdir(path.join(getStorageRoot(), "tmp"))).toEqual(before);
  });

  it("keeps a direct upload's size limit while its stream is in progress", async () => {
    const defaults = await settings.getSystemSettings();
    const read = vi
      .spyOn(settings, "getSystemSettings")
      .mockResolvedValue({ ...defaults, maxUploadBytes: 10n });
    const file = new File([new Uint8Array(8)], "file.bin");
    const stream = file.stream.bind(file);
    vi.spyOn(file, "stream").mockImplementation(() => {
      read.mockResolvedValue({ ...defaults, maxUploadBytes: 5n });
      return stream();
    });
    const staged = await stageUpload({
      clientKey: "in-progress",
      originalName: file.name,
      conflictStrategy: "fail",
      file,
    });
    expect(staged.sizeBytes).toBe(8);
    await rm(staged.tmpPath);
    await expect(stageBytes(8)).rejects.toMatchObject({
      code: "UPLOAD_SIZE_LIMIT_EXCEEDED",
      details: { maxUploadBytes: "5" },
    });
  });

  it("uses the saved timeout for each new deadline", async () => {
    const defaults = await settings.getSystemSettings();
    const read = vi.spyOn(settings, "getSystemSettings");
    for (const minutes of [60, 120, 30]) {
      read.mockResolvedValue({ ...defaults, uploadTimeoutMinutes: minutes });
      expect(await createUploadDeadline(1_000)).toBe(1_000 + minutes * 60_000);
    }
  });

  it("stops new uploads and deadlines when settings cannot be read", async () => {
    const first = await stageBytes(1);
    await rm(first.tmpPath);
    const failure = new Error("Settings unavailable");
    vi.spyOn(settings, "getSystemSettings").mockRejectedValue(failure);
    await expect(stageBytes(1)).rejects.toBe(failure);
    await expect(createUploadDeadline()).rejects.toBe(failure);
  });
});

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

  it("guesses a generic upload's type from its stored name, not the part name", async () => {
    const staged = await stageUpload({
      clientKey: "blob-part",
      originalName: "photo.png",
      conflictStrategy: "fail",
      file: new File(["fake"], "blob", { type: "application/octet-stream" }),
    });
    expect(staged.mimeType).toBe("image/png");
    await rm(staged.tmpPath, { force: true });
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

  it("generates keep-both filenames with numeric suffixes", () => {
    expect(
      buildSafeRenamedFileName("photo.jpg", ["photo.jpg", "photo (1).jpg"]),
    ).toBe("photo (2).jpg");
  });

  it("skips names that differ only in letter case", () => {
    expect(
      buildSafeRenamedFileName("photo.jpg", ["Photo.JPG", "PHOTO (1).jpg"]),
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
