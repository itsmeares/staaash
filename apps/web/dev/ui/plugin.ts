import type { Plugin } from "vite-plus";
import { getRequestListener } from "@hono/node-server";
import { handlesRequest } from "./requests";

export function uiPreview(): Plugin {
  let close = () => {};
  return {
    name: "staaash-ui-preview",
    apply: "serve",
    async configureServer(server) {
      const { createNodePreviewApp } = (await server.ssrLoadModule(
        "/dev/ui/node.ts",
      )) as typeof import("./node");
      const preview = createNodePreviewApp();
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
