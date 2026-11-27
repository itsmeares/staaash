import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMiddleware } from "hono/factory";

import { AuthError } from "@/server/auth/errors";
import {
  type AppEnv,
  MCP_PATH,
  requireUser,
  router,
  type Session,
} from "@/server/http/core";
import { createMcpServer } from "@/server/mcp";

/** MCP takes API keys only: never a browser cookie or a desktop device. */
const requireKey = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.session.key) throw new AuthError("KEY_REQUIRED");
  await next();
});

// Holds nothing between requests: each one gets a server for its own key.
const handler = createMcpHandler(
  ({ authInfo }) => createMcpServer(authInfo?.extra?.session as Session),
  { onerror: (error) => console.error("[mcp]", error) },
);

export const mcpRoutes = router().all(MCP_PATH, requireUser, requireKey, (c) =>
  handler.fetch(c.req.raw, {
    authInfo: {
      token: "",
      clientId: c.var.session.id,
      scopes: [],
      extra: { session: c.var.session },
    },
  }),
);
