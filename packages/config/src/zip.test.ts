import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});

import { createZipArchiveStream } from "./zip.js";

const compressionMethod = async (filePath: string) => {
  const stream = await createZipArchiveStream([
    { filePath, archivePath: "file" },
  ]);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).readUInt16LE(8);
};

describe("ZIP compression", () => {
  let root: string;
  beforeEach(async () => {
    vi.clearAllMocks();
    root = await mkdtemp(path.join(os.tmpdir(), "staaash-compression-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.each([0, 15, 65535])(
    "compresses small files without sampling at %i bytes",
    async (size) => {
      const file = path.join(root, "small.bin");
      await writeFile(file, randomBytes(size));
      expect(await compressionMethod(file)).toBe(8);
    },
  );

  it.each([65536, 262144])(
    "stores incompressible bytes despite a text extension at %i bytes",
    async (size) => {
      const file = path.join(root, "random.txt");
      await writeFile(file, randomBytes(size));
      expect(await compressionMethod(file)).toBe(0);
    },
  );

  it("compresses text despite a media extension", async () => {
    const file = path.join(root, "document.jpg");
    await writeFile(file, "generated document text\n".repeat(10000));
    expect(await compressionMethod(file)).toBe(8);
  });

  it.each([0, 98304, 196608])(
    "keeps compression when the sample at %i can shrink",
    async (offset) => {
      const bytes = randomBytes(262144);
      bytes.fill(0, offset, offset + 65536);
      const file = path.join(root, "mixed.bin");
      await writeFile(file, bytes);
      expect(await compressionMethod(file)).toBe(8);
    },
  );

  it("rejects an unreadable source instead of choosing a compression level", async () => {
    await expect(
      compressionMethod(path.join(root, "missing")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["failed output", "cancelled download"])(
    "closes the source after a %s",
    async (reason) => {
      const filePath = path.join(root, "large.bin");
      await writeFile(filePath, randomBytes(2 * 1024 * 1024));
      const output = await createZipArchiveStream([
        { filePath, archivePath: "large.bin" },
      ]);
      const source = vi.mocked(createReadStream).mock.results[0]!.value;
      const closed = once(source, "close");
      if (reason === "failed output") {
        const sink = new Writable({
          write(_chunk, _encoding, callback) {
            callback(new Error("disk full"));
          },
        });
        await expect(pipeline(output, sink)).rejects.toThrow("disk full");
      } else {
        output.destroy();
      }
      await closed;
      expect(source.closed).toBe(true);
    },
  );

  it("passes a source read failure to the archive consumer", async () => {
    const filePath = path.join(root, "source.txt");
    await writeFile(filePath, "source content");
    const original = vi.mocked(createReadStream).getMockImplementation()!;
    vi.mocked(createReadStream).mockImplementationOnce(() =>
      original(path.join(root, "missing")),
    );
    const output = await createZipArchiveStream([
      { filePath, archivePath: "source.txt" },
    ]);
    await expect(
      (async () => {
        for await (const chunk of output) {
          void chunk;
        }
      })(),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
