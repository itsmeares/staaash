import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Handler } from "hono";
import { getCookie } from "hono/cookie";

import { app } from "@/server/http/app";
import { getShareBaseUrl } from "@/server/request";
import { SHARE_ACCESS_COOKIE_NAME } from "@/server/sharing/access-cookie";
import { getSharePageMetadata, toMetaTags } from "@/server/sharing/metadata";
import { startup } from "@/server/startup";

// The built app sits next to this file in production. In development Vite
// serves it and forwards API calls here.
const clientDir =
  process.env.STAAASH_CLIENT_DIR ??
  path.resolve(import.meta.dirname, "../client");
const serveClient =
  process.env.NODE_ENV === "production" &&
  existsSync(path.join(clientDir, "index.html"));

const withClient = async () => {
  const indexHtml = await readFile(path.join(clientDir, "index.html"), "utf8");

  app.use(
    "/assets/*",
    serveStatic({
      root: clientDir,
      onFound: (_path, c) => {
        // File names carry a content hash, so they never change.
        c.header("cache-control", "public, max-age=31536000, immutable");
      },
    }),
  );
  app.use("*", serveStatic({ root: clientDir }));

  // A link preview shows the shared item, so share pages carry its tags.
  const sharePage =
    (kind?: "folder" | "file"): Handler =>
    async (c) => {
      const token = c.req.param("token")!;
      const id = c.req.param("id");
      const metadata = await getSharePageMetadata({
        token,
        baseUrl: getShareBaseUrl(c.req.raw.headers),
        folderId: kind === "folder" ? id : undefined,
        fileId: kind === "file" ? id : undefined,
        shareAccessCookieValue: getCookie(c, SHARE_ACCESS_COOKIE_NAME) ?? null,
      });
      return c.html(
        indexHtml
          .replace(/<title>.*?<\/title>\s*/, "")
          .replace(/<meta\s+name="description"[^>]*>\s*/, "")
          .replace("<!--share-meta-->", toMetaTags(metadata)),
      );
    };
  // Separate routes: one pattern with two optional parts lost the item id
  // once the API routes were registered.
  app.get("/s/:token", sharePage());
  app.get("/s/:token/f/:id", sharePage("folder"));
  app.get("/s/:token/files/:id", sharePage("file"));

  // Every other page is the app, which routes in the browser.
  app.get("*", (c) =>
    c.req.path.startsWith("/api/") ? c.notFound() : c.html(indexHtml),
  );
};

// A failed startup check, such as storage usage that does not add up, keeps
// the server up but answers every request with 500 until an operator fixes it.
const failed = await startup().then(
  () => false,
  (error: unknown) => {
    console.error("[startup] Staaash cannot serve requests.", error);
    return true;
  },
);
if (serveClient && !failed) await withClient();

const port = Number(process.env.PORT ?? (serveClient ? 2113 : 3001));
const hostname = process.env.HOST ?? (serveClient ? "0.0.0.0" : "127.0.0.1");
const fetch = failed
  ? () =>
      Response.json(
        {
          error: "Staaash failed its startup checks. See the server log.",
          code: "STARTUP_FAILED",
        },
        { status: 500 },
      )
  : app.fetch;
serve({ fetch, port, hostname }, () => {
  console.log(`Staaash is listening on http://${hostname}:${port}`);
});
