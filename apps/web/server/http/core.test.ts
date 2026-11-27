import { describe, expect, it, vi } from "vite-plus/test";

const sessions = vi.hoisted(() => {
  const key = (use: "ai" | "script", readOnly = false) => ({
    deviceName: "Key",
    key: { use, readOnly, folderId: null, noEnd: false },
  });
  return {
    stsh_ai: key("ai"),
    stsh_script: key("script"),
    stsh_read: key("script", true),
    "device-token": { deviceName: "Laptop", key: null },
  } as Record<string, object>;
});

vi.mock("@/server/auth/guards", () => ({
  getRequestSession: vi.fn(async (token: string | null) =>
    token ? (sessions[token] ?? null) : null,
  ),
}));

import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import { createApp, requireDevice, requireUser } from "@/server/http/core";

const app = createApp();
const ok = () => Response.json({ ok: true });
app.post("/api/write", (c) => c.json({ ok: true }));
app.get("/api/private", requireUser, (c) => c.json({ ok: true }));
app.on(["GET", "POST"], "/api/files/item", requireUser, ok);
app.post("/api/files/archives", requireUser, ok);
app.get("/api/user/me", requireUser, ok);
app.all("/mcp", requireUser, ok);
app.get("/api/sync/device-only", requireUser, requireDevice, ok);
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

describe("API keys", () => {
  const call = (
    method: string,
    path: string,
    token: string,
    via: "header" | "cookie" = "header",
  ) =>
    app.request(
      new Request(`http://localhost:3000${path}`, {
        method,
        headers: {
          accept: "application/json",
          ...(via === "header"
            ? { authorization: `Bearer ${token}` }
            : { cookie: `${SESSION_COOKIE_NAME}=${token}` }),
        },
      }),
    );
  const codeOf = async (response: Response) =>
    ((await response.json()) as { code?: string }).code;

  it("keeps an AI key to MCP", async () => {
    expect((await call("POST", "/mcp", "stsh_ai")).status).toBe(200);
    const rest = await call("GET", "/api/files/item", "stsh_ai");
    expect(rest.status).toBe(403);
    expect(await codeOf(rest)).toBe("KEY_AI_ONLY");
  });

  it("lets a script key read and change files", async () => {
    expect((await call("GET", "/api/files/item", "stsh_script")).status).toBe(
      200,
    );
    expect((await call("POST", "/api/files/item", "stsh_script")).status).toBe(
      200,
    );
  });

  it("lets a read-only key read and pack zips, but not change", async () => {
    expect((await call("GET", "/api/files/item", "stsh_read")).status).toBe(
      200,
    );
    expect(
      (await call("POST", "/api/files/archives", "stsh_read")).status,
    ).toBe(200);
    const write = await call("POST", "/api/files/item", "stsh_read");
    expect(write.status).toBe(403);
    expect(await codeOf(write)).toBe("KEY_READ_ONLY");
  });

  it("treats a key outside the file routes as not signed in", async () => {
    const response = await call("GET", "/api/user/me", "stsh_script");
    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("NOT_SIGNED_IN");
  });

  it("refuses a key sent as a browser cookie", async () => {
    const response = await call(
      "GET",
      "/api/files/item",
      "stsh_script",
      "cookie",
    );
    expect(response.status).toBe(401);
  });

  it("keeps keys off device-only routes", async () => {
    const response = await call("GET", "/api/sync/device-only", "stsh_script");
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("DEVICE_REQUIRED");
    expect(
      (await call("GET", "/api/sync/device-only", "device-token")).status,
    ).toBe(200);
  });

  it("still lets a desktop device use account routes", async () => {
    expect((await call("GET", "/api/user/me", "device-token")).status).toBe(
      200,
    );
  });
});
