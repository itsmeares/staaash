import { createRoute, z } from "@hono/zod-openapi";

import { getWorkspaceLocationLabel } from "@/src/workspace/workspace-item-helpers";
import { errorResponses, requireUser, router } from "@/server/http/core";
import { json } from "@/server/http/schemas";
import { getQuickResults } from "@/server/retrieval/quick";

const search = createRoute({
  method: "get",
  path: "/api/search",
  tags: ["Search"],
  summary:
    "Quick results by name: a few folders, then files. With no query, what was opened lately.",
  middleware: [requireUser],
  request: { query: z.object({ q: z.string().optional() }) },
  responses: {
    200: json(
      z.object({
        total: z.number().int(),
        results: z.array(
          z.object({
            id: z.string(),
            kind: z.enum(["file", "folder"]),
            name: z.string(),
            href: z.string(),
            mimeType: z.string().nullable(),
            location: z.string(),
          }),
        ),
      }),
      "Results.",
    ),
    ...errorResponses,
  },
});

export const searchRoutes = router().openapi(search, async (c) => {
  const page = await getQuickResults(
    c.var.session.user.id,
    c.req.valid("query").q?.trim() ?? "",
  );
  c.header("cache-control", "no-store");
  return c.json(
    {
      total: page.total,
      results: page.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        name: item.name,
        href: item.href,
        mimeType: item.kind === "file" ? item.mimeType : null,
        location: getWorkspaceLocationLabel(item),
      })),
    },
    200,
  );
});
