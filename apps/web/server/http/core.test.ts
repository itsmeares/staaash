import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/server/auth/guards", () => ({
  getRequestSession: vi.fn(async () => null),
}));

import { createApp, requireUser } from "@/server/http/core";

const app = createApp();
app.post("/api/write", (c) => c.json({ ok: true }));
app.get("/api/private", requireUser, (c) => c.json({ ok: true }));
app.get("/api/busy", () => {
  throw Object.assign(new Error("Storage is busy."), {
    code: "STORAGE_MUTATION_IN_PROGRESS",
    status: 503,
  });
});

const write = (url: string, headers: Record<string, string>) =>
  app.request(new Request(url, { method: "POST", headers }));

describe("http core", () => {
  it.each([
    ["matching origin and host", "localhost:3000", "http://localhost:3000"],
    [
      "a domain behind a proxy",
      "staaash.example.com",
      "https://staaash.example.com",
    ],
    ["a LAN address", "192.168.1.20:2113", "http://192.168.1.20:2113"],
  ])("allows writes from %s", async (_name, host, origin) => {
    const response = await write("http://internal:3000/api/write", {
      host,
      origin,
    });
    expect(response.status).toBe(200);
  });

  it("allows writes without an Origin header", async () => {
    const response = await write("http://localhost:3000/api/write", {
      host: "localhost:3000",
    });
    expect(response.status).toBe(200);
  });

  it.each([
    ["another site", "localhost:3000", "https://evil.example"],
    [
      "a domain origin against an IP host",
      "203.0.113.10:2113",
      "https://staaash.example.com",
    ],
    [
      "the same host on another port",
      "staaash.example.com:2113",
      "https://staaash.example.com",
    ],
    ["an invalid origin", "localhost:3000", "not a valid origin"],
  ])("refuses writes from %s", async (_name, host, origin) => {
    const response = await write("http://localhost:3000/api/write", {
      host,
      origin,
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "CROSS_ORIGIN",
    });
  });

  it("lets a device token write from anywhere: browsers never send it on their own", async () => {
    const response = await write("http://localhost:3000/api/write", {
      host: "localhost:3000",
      origin: "https://elsewhere.example",
      authorization: "Bearer device-token",
    });
    expect(response.status).toBe(200);
  });

  it("answers API callers that are signed out with 401 JSON", async () => {
    const response = await app.request(
      new Request("http://localhost:3000/api/private", {
        headers: { accept: "application/json" },
      }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Not signed in.",
      code: "NOT_SIGNED_IN",
    });
  });

  it("sends signed-out browsers to sign-in and back", async () => {
    const response = await app.request(
      new Request("http://localhost:3000/api/private?x=1", {
        headers: { accept: "text/html", host: "localhost:3000" },
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/?next=%2Fapi%2Fprivate%3Fx%3D1",
    );
  });

  it("marks storage contention as retryable", async () => {
    const response = await app.request("/api/busy");
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
  });
});
