import type { Plugin } from "vite-plus";
import { getRequestListener } from "@hono/node-server";

const sharePage = /^\/s\/[^/]+(?:\/(?:f|files)\/[^/]+)?\/?$/;

function handlesRequest(path: string, method: string) {
  if (["/__ui/", "/api/"].some((prefix) => path.startsWith(prefix)))
    return true;
  if (path === "/auth/device-callback") return true;
  return path.startsWith("/s/") && !(method === "GET" && sharePage.test(path));
}
export function uiPreview(): Plugin {
  let close = () => {};
  return {
    name: "staaash-ui-preview",
    apply: "serve",
    async configureServer(server) {
      const { createPreviewApp } = (await server.ssrLoadModule(
        "/dev/ui/app.ts",
      )) as typeof import("./app");
      const preview = createPreviewApp();
      close = preview.close;
      const app = preview.app;
      const listener = getRequestListener(app.fetch);
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? "/", "http://preview.invalid")
          .pathname;
        if (path === "/__ui") {
          request.url = "/dev/ui/index.html";
          next();
        } else if (handlesRequest(path, request.method ?? "GET")) {
          void listener(request, response);
        } else next();
      });
      server.httpServer?.once("close", close);
    },
    closeBundle: () => close(),
  };
}
