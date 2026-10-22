import { createRoute, z } from "@hono/zod-openapi";

import { router } from "@/server/http/core";

import { getReadiness } from "@/server/health";

const Status = z.enum(["healthy", "warning", "error"]);

const live = createRoute({
  method: "get",
  path: "/api/health/live",
  tags: ["Health"],
  summary: "The web process is up.",
  responses: {
    200: {
      description: "Up.",
      content: {
        "application/json": {
          schema: z.object({
            ok: z.literal(true),
            checks: z.object({ app: z.literal("healthy") }),
          }),
        },
      },
    },
  },
});

const Readiness = z
  .object({
    ok: z.boolean(),
    checks: z.object({
      app: Status,
      database: Status,
      storage: Status,
      worker: Status,
      queue: Status,
      settings: Status,
      reconciliation: Status,
      storageMutations: Status,
    }),
    failures: z.array(z.string()),
    operational: z.object({
      status: Status,
      incidents: z.array(z.string()),
    }),
  })
  .openapi("Readiness");

const ready = createRoute({
  method: "get",
  path: "/api/health/ready",
  tags: ["Health"],
  summary: "Database, storage, and worker can serve requests.",
  responses: {
    200: {
      description: "Ready.",
      content: { "application/json": { schema: Readiness } },
    },
    503: {
      description: "Not ready. `failures` lists why.",
      content: { "application/json": { schema: Readiness } },
    },
  },
});

export const healthRoutes = router()
  .openapi(live, (c) => c.json({ ok: true, checks: { app: "healthy" } }, 200))
  .openapi(ready, async (c) => {
    const summary = await getReadiness();
    const body = {
      ok: summary.ok,
      checks: {
        app: summary.checks.app.status,
        database: summary.checks.database.status,
        storage: summary.checks.storage.status,
        worker: summary.worker.status,
        queue: summary.checks.queue.status,
        settings: summary.checks.settings.status,
        reconciliation: summary.reconciliation.status,
        storageMutations: summary.checks.storageMutations.status,
      },
      failures: summary.failures,
      operational: summary.operational,
    };
    return summary.ok ? c.json(body, 200) : c.json(body, 503);
  });
