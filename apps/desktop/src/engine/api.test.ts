import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it } from "vite-plus/test";

import { createApi } from "./api";

it("replays the complete upload body after a retry and reports bytes sent", async () => {
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
    const api = createApi(`http://127.0.0.1:${address.port}`, "fake-token");
    const body = Buffer.alloc(200_000, 42);
    let sent = 0;
    await api.uploadChunk("fake", 0, body, body.length, (bytes) => {
      sent += bytes;
    });
    expect(received).toEqual([body, body]);
    expect(sent).toBe(body.length * 2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
