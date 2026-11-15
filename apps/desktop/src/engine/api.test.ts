import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it } from "vite-plus/test";

import { ApiError, createApi } from "./api";

it("keeps the server's upload limit message and exact byte details", async () => {
  const refusal = {
    code: "UPLOAD_SIZE_LIMIT_EXCEEDED",
    error: "This file exceeds the server's 10.0 GB upload limit.",
    details: { maxUploadBytes: "10737418240" },
  };
  const server = createServer((_request, response) => {
    response.writeHead(413, { "content-type": "application/json" });
    response.end(JSON.stringify(refusal));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const api = createApi(`http://127.0.0.1:${address.port}`, "fake-token");
    await expect(
      api.startUpload({
        folderId: "folder",
        name: "large.bin",
        size: 15_032_385_536,
        modifiedAt: 0,
        replace: false,
      }),
    ).rejects.toMatchObject({
      constructor: ApiError,
      status: 413,
      code: refusal.code,
      message: refusal.error,
      body: refusal,
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("replays the complete upload body after a retry, reports bytes sent and notes the retry", async () => {
  const received: Buffer[] = [];
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = [];
    for await (const part of request) parts.push(part as Buffer);
    received.push(Buffer.concat(parts));
    if (received.length === 1) {
      response.writeHead(503, { "retry-after": "0.01" });
    } else {
      response.writeHead(204);
    }
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const notes: unknown[][] = [];
    const api = createApi(
      `http://127.0.0.1:${address.port}`,
      "fake-token",
      undefined,
      (...note) => notes.push(note),
    );
    const body = Buffer.alloc(200_000, 42);
    let sent = 0;
    await api.uploadChunk("fake", 0, body, body.length, (bytes) => {
      sent += bytes;
    });
    expect(received).toEqual([body, body]);
    expect(sent).toBe(body.length * 2);
    expect(notes).toEqual([["retrying a request", "the server answered 503"]]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("stops a chunk's retry wait when sync pauses", async () => {
  let requests = 0;
  const server = createServer(async (request, response) => {
    for await (const _ of request);
    requests += 1;
    response.writeHead(503, { "retry-after": "60" });
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    let retrying!: () => void;
    const waiting = new Promise<void>((resolve) => (retrying = resolve));
    const api = createApi(
      `http://127.0.0.1:${address.port}`,
      "fake-token",
      undefined,
      () => retrying(),
    );
    const pause = new AbortController();
    const body = Buffer.alloc(16, 1);
    const sending = api.uploadChunk(
      "fake",
      0,
      body,
      body.length,
      () => {},
      pause.signal,
    );
    // The retry note comes just before the wait, so the pause lands in it.
    await waiting;
    pause.abort();
    await expect(sending).rejects.toThrow();
    expect(requests).toBe(1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("sends a small file as a multipart body the server can parse", async () => {
  let form: FormData | null = null;
  let length = "";
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = [];
    for await (const part of request) parts.push(part as Buffer);
    length = request.headers["content-length"] ?? "";
    form = await new Response(Buffer.concat(parts), {
      headers: { "content-type": request.headers["content-type"] ?? "" },
    }).formData();
    response.writeHead(201, { "content-type": "application/json" });
    response.end(JSON.stringify({ uploadedFiles: [{ id: "remote" }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const api = createApi(`http://127.0.0.1:${address.port}`, "fake-token");
    const body = Buffer.alloc(150_000, 7);
    const name = 'a "quoted"\nnote.heic';
    const file = await api.uploadSmall(
      {
        folderId: "folder",
        name,
        checksum: "hash",
        modifiedAt: 0,
        replace: { id: "file-1", rev: 4 },
      },
      body,
      () => {},
    );
    expect(file).toEqual({ id: "remote" });
    const parsed = form as unknown as FormData;
    expect(parsed.get("folderId")).toBe("folder");
    expect(JSON.parse(parsed.get("manifest") as string)).toEqual([
      {
        clientKey: "file",
        originalName: name,
        expectedChecksum: "hash",
        conflictStrategy: "replace",
        clientModifiedAt: new Date(0).toISOString(),
        ifRevision: 4,
        ifFileId: "file-1",
      },
    ]);
    const sent = parsed.get("files") as File;
    expect(sent.name).toBe(name);
    expect(Buffer.from(await sent.arrayBuffer())).toEqual(body);
    expect(Number(length)).toBeGreaterThan(body.length);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("follows a large folder change the server runs in the background", async () => {
  const seen: { method?: string; url?: string; prefer?: string }[] = [];
  let polls = 0;
  const folder = { id: "folder", name: "Renamed", storageRevision: 2 };
  const server = createServer(async (request, response) => {
    for await (const _ of request);
    seen.push({
      method: request.method,
      url: request.url,
      prefer: String(request.headers.prefer),
    });
    response.setHeader("content-type", "application/json");
    if (request.method === "POST") {
      response.writeHead(202);
      response.end(JSON.stringify({ operationId: "op", status: "queued" }));
      return;
    }
    polls += 1;
    response.end(
      JSON.stringify(
        polls === 1
          ? { operationId: "op", status: "running" }
          : { operationId: "op", status: "succeeded", response: { folder } },
      ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const api = createApi(`http://127.0.0.1:${address.port}`, "fake-token");
    await expect(api.renameFolder("folder", 1, "Renamed")).resolves.toEqual({
      folder,
    });
    expect(seen[0]).toMatchObject({ method: "POST", prefer: "respond-async" });
    expect(seen.slice(1).map((each) => each.url)).toEqual([
      "/api/files/folders/operations/op",
      "/api/files/folders/operations/op",
    ]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("reports a background folder change that failed as the server's error", async () => {
  const server = createServer(async (request, response) => {
    for await (const _ of request);
    response.setHeader("content-type", "application/json");
    response.writeHead(request.method === "POST" ? 202 : 200);
    response.end(
      JSON.stringify(
        request.method === "POST"
          ? { operationId: "op", status: "queued" }
          : {
              operationId: "op",
              status: "failed",
              error: {
                status: 409,
                code: "REVISION_MISMATCH",
                message: "The folder changed meanwhile.",
              },
            },
      ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const api = createApi(`http://127.0.0.1:${address.port}`, "fake-token");
    await expect(api.trashFolder("folder", 1)).rejects.toMatchObject({
      constructor: ApiError,
      status: 409,
      code: "REVISION_MISMATCH",
      message: "The folder changed meanwhile.",
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
