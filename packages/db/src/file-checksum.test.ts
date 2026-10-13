import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { computeFileSha256 } from "./storage-mutation-executor";

const directories: string[] = [];
const temporaryFile = async (name = "payload.bin") => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "staaash-checksum-"));
  directories.push(directory);
  return path.join(directory, name);
};
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe("file checksums", () => {
  it.each([0, 17, 64 * 1024, 64 * 1024 + 1, 1024 * 1024, 3 * 1024 * 1024 + 37])(
    "hashes all %i bytes without including stale buffer contents",
    async (size) => {
      const bytes = Buffer.alloc(size);
      for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (i >>> 8)) & 255;
      const file = await temporaryFile();
      await writeFile(file, bytes);
      expect(await computeFileSha256(file)).toBe(digest(bytes));
    },
  );

  it("detects a changed final byte after a partial last read", async () => {
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 13, 0xa5);
    const file = await temporaryFile();
    await writeFile(file, bytes);
    const before = await computeFileSha256(file);
    bytes[bytes.length - 1] = 0x42;
    const handle = await open(file, "r+");
    try {
      await handle.write(bytes.subarray(-1), 0, 1, bytes.length - 1);
    } finally {
      await handle.close();
    }
    expect(await computeFileSha256(file)).toBe(digest(bytes));
    expect(await computeFileSha256(file)).not.toBe(before);
  });

  it("keeps simultaneous checksum buffers independent", async () => {
    await Promise.all(
      [0x11, 0x55, 0xee].map(async (byte) => {
        const bytes = Buffer.alloc(2 * 1024 * 1024 + byte, byte);
        const file = await temporaryFile();
        await writeFile(file, bytes);
        expect(await computeFileSha256(file)).toBe(digest(bytes));
      }),
    );
  });

  it("rejects missing files instead of returning an empty digest", async () => {
    await expect(
      computeFileSha256(await temporaryFile()),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
