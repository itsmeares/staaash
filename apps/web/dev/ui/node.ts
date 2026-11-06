import { readdirSync, readFileSync, statSync } from "node:fs";
import { getCookie, setCookie } from "hono/cookie";
import { createPreviewApp, seedState } from "./app";
import type { Assets } from "./media";
import type { State } from "./state";

const dir = new URL("./assets/", import.meta.url);
const files = new Map(
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.replaceAll("\\", "/"))
    .filter((name) => statSync(new URL(name, dir)).isFile())
    .map((name) => [name, Uint8Array.from(readFileSync(new URL(name, dir)))]),
);
const assets: Assets = {
  size: (name) => files.get(name)?.byteLength ?? 0,
  bytes: async (name) => files.get(name)!,
};

/** The dev preview: one sample drive per browser cookie, kept in memory. */
export function createNodePreviewApp() {
  const sessions = new Map<string, { state: State; lastSeen: number }>();
  const preview = createPreviewApp(async (c, next) => {
    for (const [id, session] of sessions)
      if (Date.now() - session.lastSeen > 2 * 60 * 60 * 1000)
        sessions.delete(id);
    let id = getCookie(c, "staaash_ui_session");
    if (!id || !sessions.has(id)) {
      if (sessions.size >= 16) sessions.delete(sessions.keys().next().value!);
      id = crypto.randomUUID();
      sessions.set(id, { state: seedState(assets), lastSeen: Date.now() });
      setCookie(c, "staaash_ui_session", id, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
      });
    }
    const session = sessions.get(id)!;
    session.lastSeen = Date.now();
    c.set("state", session.state);
    c.set("assets", assets);
    c.set("site", new URL(c.req.url).origin);
    await next();
  });
  return {
    app: preview.app,
    close: () => {
      preview.close();
      sessions.clear();
    },
  };
}
