import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { createRangeResponseFromPath } from "@/server/downloads/range-response";

const dir = await mkdtemp(path.join(os.tmpdir(), "staaash-range-"));
const filePath = path.join(dir, "big.bin");
await writeFile(filePath, Buffer.alloc(4 * 1024 * 1024, 7));

afterAll(() => rm(dir, { recursive: true, force: true }));

const download = (request: Request) =>
  createRangeResponseFromPath(
    request,
    filePath,
    4 * 1024 * 1024,
    "application/octet-stream",
    "big.bin",
  );

describe("file downloads", () => {
  it("streams one range of the file", async () => {
    const response = await download(
      new Request("http://localhost/x", { headers: { range: "bytes=10-19" } }),
    );
    expect(response!.status).toBe(206);
    expect(Buffer.from(await response!.arrayBuffer())).toEqual(
      Buffer.alloc(10, 7),
    );
  });

  // A client that hangs up mid-download used to throw past every handler
  // and stop the whole server.
  it("survives a client that hangs up partway through", async () => {
    const controller = new AbortController();
    const response = await download(
      new Request("http://localhost/x", { signal: controller.signal }),
    );
    const reader = response!.body!.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A second download still works on the same process.
    const again = await download(new Request("http://localhost/x"));
    expect((await again!.arrayBuffer()).byteLength).toBe(4 * 1024 * 1024);
  });
});
