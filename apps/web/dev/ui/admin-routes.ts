import type { Hono } from "hono";
import type { PreviewEnv } from "./state";
import { z } from "zod";
import { jsonBody } from "./request";
import { randomUUID } from "node:crypto";
import { streamSSE } from "hono/streaming";
import {
  type State,
  PreviewError,
  requireUser,
  rootOf,
  fileOf,
  password,
  timestamp,
} from "./state";
import { devices } from "./views";
import {
  adminOverview,
  adminStorage,
  adminUsers,
  healthView,
  jobsView,
  storageSummary,
  updateView,
} from "./admin";
import {
  settingsSchema,
  toSettingsValues,
} from "../../server/admin/settings-schema";
import { plain } from "../../lib/plain";
import {
  adminCreateUserInputSchema,
  adminUpdateUserInputSchema,
  temporaryPasswordInputSchema,
} from "../../server/auth/schema";

function editableUser(state: State, id: string) {
  if (requireUser(state).role !== "owner")
    throw new PreviewError(403, "Owner access required.");
  const user = state.users.find((u) => u.id === id);
  if (!user) throw new PreviewError(404, "User not found.");
  return user;
}
export function mountAdmin(app: Hono<PreviewEnv>, streams: Set<() => void>) {
  app.use("/api/views/admin/*", async (c, next) => {
    if (requireUser(c.var.state).role === "member")
      throw new PreviewError(403, "Admin access required.");
    if (c.var.state.scenario === "admin-unavailable")
      throw new PreviewError(503, "Sample admin pages are unavailable.");
    await next();
  });
  app.use("/api/admin/*", async (c, next) => {
    if (requireUser(c.var.state).role === "member")
      throw new PreviewError(403, "Admin access required.");
    await next();
  });
  app.get("/api/views/admin/overview", (c) =>
    c.json(adminOverview(c.var.state)),
  );
  app.get("/api/views/admin/storage", (c) => c.json(adminStorage(c.var.state)));
  app.get("/api/views/admin/users", (c) =>
    c.json(adminUsers(c.var.state, new URL(c.req.url).origin)),
  );
  app.get("/api/views/admin/users/:id", (c) => {
    const state = c.var.state;
    const user = state.users.find((u) => u.id === c.req.param("id"));
    if (!user) throw new PreviewError(404, "User not found.");
    const row = storageSummary(state).rows.find((r) => r.userId === user.id)!;
    return c.json({
      canEdit: state.userId === "owner",
      user: {
        ...user,
        isOwner: user.role === "owner",
        isAdmin: user.role !== "member",
      },
      storage: {
        used: row.retainedBytes,
        files: row.retainedFileCount,
        folders: row.retainedFolderCount,
        lastChange: row.lastContentActivityAt,
      },
      devices: devices(state),
      signInUrl: `${new URL(c.req.url).origin}/`,
    });
  });
  app.get("/api/views/admin/jobs", (c) => c.json(jobsView(c.var.state)));
  app.get("/api/views/admin/settings", (c) => {
    if (requireUser(c.var.state).role !== "owner")
      throw new PreviewError(403, "Owner access required.");
    return c.json({
      settings: c.var.state.settings,
      updateState: updateView(c.var.state),
    });
  });
  app.get("/api/admin/health", (c) => c.json(healthView(c.var.state)));
  app.post("/api/admin/storage/mutations/:id/retry", (c) => {
    if (c.req.param("id") !== "sample-move")
      throw new PreviewError(404, "Sample mutation not found.");
    c.var.state.recovering = false;
    return c.json({ ok: true });
  });
  app.get("/api/admin/jobs", (c) => {
    const state = c.var.state;
    const statuses = c.req.query("status")?.split(",");
    const kind = c.req.query("kind");
    const items = state.jobs.filter(
      (j) =>
        (!statuses || statuses.includes(j.status)) &&
        (!kind || j.kind === kind),
    );
    const limit = Math.min(
      100,
      Math.max(1, Number(c.req.query("limit")) || 25),
    );
    const page = Math.max(1, Number(c.req.query("page")) || 1);
    return c.json({
      items: items.slice((page - 1) * limit, page * limit),
      nextCursor: null,
      page,
      pageCount: Math.max(1, Math.ceil(items.length / limit)),
      pageSize: limit,
      totalCount: items.length,
      hasNextPage: page * limit < items.length,
      hasPreviousPage: page > 1,
      availableKinds: jobsView(state).jobKinds,
      statusCounts: jobsView(state).initialSummary.statusCounts,
    });
  });
  app.get("/api/admin/jobs/:id/events", (c) =>
    c.json({
      items: [
        {
          id: "event-1",
          jobId: c.req.param("id"),
          type: "completed",
          message: "Sample job finished.",
          metadataJson: {},
          workerId: "sample-worker",
          createdAt: timestamp,
        },
      ],
    }),
  );
  app.post("/api/admin/jobs/run", async (c) => {
    const body = await jsonBody(c.req.raw);
    const job = c.var.state.jobs.find((j) => j.kind === body.kind);
    if (!job) throw new PreviewError(400, "Choose a sample job kind.");
    job.status = "succeeded";
    job.lastError = null;
    return c.json({ message: "Sample job finished.", jobId: job.id });
  });
  app.post("/api/admin/jobs/:id/:action", (c) => {
    const state = c.var.state;
    const job = state.jobs.find((j) => j.id === c.req.param("id"));
    if (!job) throw new PreviewError(404, "Job not found.");
    const action = c.req.param("action");
    if (action === "dismiss") state.jobs = state.jobs.filter((j) => j !== job);
    else if (action === "cancel") job.status = "cancelled";
    else if (action === "retry") {
      job.status = "succeeded";
      job.lastError = null;
    } else throw new PreviewError(404, "Unknown job action.");
    return c.json({ message: "Sample job updated.", jobId: job.id });
  });
  app.get("/api/admin/live", (c) =>
    streamSSE(c, async (stream) => {
      let stopped = false;
      const stop = () => {
        stopped = true;
        stream.abort();
      };
      streams.add(stop);
      stream.onAbort(stop);
      try {
        while (!stopped) {
          const data = jobsView(c.var.state);
          await stream.writeSSE({
            event: "update",
            data: JSON.stringify(updateView(c.var.state)),
          });
          if (c.req.query("jobs") === "1")
            await stream.writeSSE({
              event: "state",
              data: JSON.stringify({
                lastRuns: data.initialLastRuns,
                summary: data.initialSummary,
              }),
            });
          await stream.sleep(1000);
        }
      } finally {
        streams.delete(stop);
      }
    }),
  );
  app.get("/api/admin/updates", (c) => c.json(updateView(c.var.state)));
  app.post("/api/admin/updates/check", (c) =>
    c.json({
      message: "Sample update check finished.",
      jobId: "sample-update",
    }),
  );
  app.get("/api/admin/updates/check", (c) =>
    c.json({
      job: { id: "sample-update", status: "succeeded", lastError: null },
      updateState: updateView(c.var.state),
    }),
  );
  app.put("/api/admin/settings", async (c) => {
    if (requireUser(c.var.state).role !== "owner")
      throw new PreviewError(403, "Owner access required.");
    const body = await jsonBody(c.req.raw);
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        {
          fieldErrors: Object.fromEntries(
            parsed.error.issues.map((i) => [i.path[0], i.message]),
          ),
          values: body,
        },
        400,
      );
    Object.assign(c.var.state.settings, plain(parsed.data));
    return c.json({
      success: true,
      values: toSettingsValues(c.var.state.settings),
    });
  });
  app.post("/api/admin/users", async (c) => {
    if (requireUser(c.var.state).role !== "owner")
      throw new PreviewError(403, "Owner access required.");
    const body = adminCreateUserInputSchema.parse(await c.req.json());
    const email = body.email;
    if (c.var.state.users.some((u) => u.email === email))
      throw new PreviewError(409, "That sample account already exists.");
    const user = {
      ...c.var.state.users[2]!,
      id: randomUUID(),
      email,
      displayName: null,
      role: body.isAdmin ? ("admin" as const) : ("member" as const),
      storageId: randomUUID(),
      storageLimitBytes: body.storageLimitBytes?.toString() ?? null,
      note: "Not signed in yet",
    };
    c.var.state.passwords.set(user.id, body.temporaryPassword ?? password);
    c.var.state.firstRuns.set(
      user.id,
      body.requirePasswordChange === false ? "member" : "member-password",
    );
    c.var.state.users.push(user);
    c.var.state.folders.push({
      ...rootOf(c.var.state),
      id: `${user.id}-root`,
      ownerUserId: user.id,
      ownerStorageId: user.storageId,
    });
    return c.json(
      { user, temporaryPassword: c.var.state.passwords.get(user.id) },
      201,
    );
  });
  app.patch("/api/admin/users/:id", async (c) => {
    const user = editableUser(c.var.state, c.req.param("id"));
    const { isAdmin, ...values } = adminUpdateUserInputSchema.parse(
      await c.req.json(),
    );
    Object.assign(user, plain(values));
    if (isAdmin !== undefined && user.role !== "owner")
      user.role = isAdmin ? "admin" : "member";
    return c.json({ user });
  });
  app.post("/api/admin/users/:id/password-reset", async (c) => {
    const user = editableUser(c.var.state, c.req.param("id"));
    const body = temporaryPasswordInputSchema.parse(await c.req.json());
    const temporaryPassword = body.temporaryPassword ?? password;
    if (
      body.temporaryPassword &&
      body.confirmTemporaryPassword !== body.temporaryPassword
    )
      throw new PreviewError(400, "Passwords do not match.");
    c.var.state.passwords.set(user.id, temporaryPassword);
    if (body.requirePasswordChange !== false)
      c.var.state.firstRuns.set(user.id, "password");
    return c.json({
      user,
      temporaryPassword,
      signInUrl: `${new URL(c.req.url).origin}/`,
    });
  });
  app.delete("/api/admin/users/:id/sessions/:sessionId", (c) => {
    if (requireUser(c.var.state).role !== "owner")
      throw new PreviewError(403, "Owner access required.");
    c.var.state.sessions = c.var.state.sessions.filter(
      (id) => id !== c.req.param("sessionId"),
    );
    return c.json({ ok: true });
  });
  app.post("/api/admin/derivatives/files/:id/regenerate", (c) => {
    const file = fileOf(c.var.state, c.req.param("id"));
    c.var.state.previewStates.set(file.id, "ready");
    return c.json({ ok: true });
  });
  app.post("/api/admin/derivatives/:id/:action", async (c) => {
    const state = c.var.state;
    const file = fileOf(state, c.req.param("id").replace(/^derivative-/, ""));
    const action = c.req.param("action");
    if (action === "pin") {
      const body = z.object({ pinned: z.boolean() }).parse(await c.req.json());
      if (body.pinned) state.pinnedPreviews.add(file.id);
      else state.pinnedPreviews.delete(file.id);
    } else if (action === "cancel") state.previewStates.set(file.id, "failed");
    else if (action === "remove") state.previewStates.set(file.id, "none");
    else throw new PreviewError(404, "Unknown sample preview action.");
    return c.json({ ok: true });
  });
}
