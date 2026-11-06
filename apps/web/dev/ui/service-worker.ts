/// <reference lib="webworker" />
import { version } from "../../../../package.json";
import { createPreviewApp, seedState } from "./app";
import type { Assets } from "./media";
import { handlesRequest } from "./requests";
import { openSavedDrive } from "./saved-drive";

declare const self: ServiceWorkerGlobalScope;
declare const __DEMO_ASSET_SIZES__: Record<string, number>;

const base = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const site = `${self.location.origin}${base}`;
// Sample files are copied next to the app at build time and fetched only
// when someone opens them.
const assets: Assets = {
  size: (name) => __DEMO_ASSET_SIZES__[name] ?? 0,
  async bytes(name) {
    const response = await fetch(`${base}/samples/${name}`);
    if (!response.ok) throw new Error(`Could not load sample ${name}.`);
    return new Uint8Array(await response.arrayBuffer());
  },
};

// The browser stops an idle worker after about 30 seconds, so the drive is
// read back from browser storage whenever the worker starts again.
let drive: ReturnType<typeof openSavedDrive> | undefined;
const { app } = createPreviewApp(async (c, next) => {
  const { state, save } = await (drive ??= openSavedDrive(version, () =>
    seedState(assets, "demo"),
  ));
  c.set("state", state);
  c.set("assets", assets);
  c.set("site", site);
  await next();
  if (!["GET", "HEAD"].includes(c.req.method)) await save();
});

self.addEventListener("install", () => void self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
// A hard reload opens the page without a worker; the page asks to be claimed.
self.addEventListener("message", (event) => {
  if (event.data === "claim") event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Pages fetch "/api/..." from the origin root, while links and forms carry
  // the base path. Both reach the same sample API.
  const path = url.pathname.startsWith(`${base}/`)
    ? url.pathname.slice(base.length)
    : url.pathname;
  if (!handlesRequest(path, event.request.method)) return;
  event.respondWith(answer(event.request, `${url.origin}${path}${url.search}`));
});

async function answer(request: Request, url: string) {
  const response = await app.fetch(
    new Request(url, {
      method: request.method,
      headers: request.headers,
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : await request.arrayBuffer(),
      signal: request.signal,
    }),
  );
  const location = response.headers.get("location");
  if (!location?.startsWith("/")) return response;
  const moved = new Response(response.body, response);
  moved.headers.set("location", `${base}${location}`);
  return moved;
}
