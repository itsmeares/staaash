import { sampleTemporaryPassword } from "./mutations";
import type { Hono } from "hono";
import type { PreviewEnv } from "./state";
import { z } from "zod";
import { jsonBody } from "./request";
import { streamSSE } from "hono/streaming";
import {
  type State,
  PreviewError,
  requireUser,
  rootOf,
  jobKinds,
  sampleJob,
  timestamp,
} from "./state";
import { devices } from "./views";
import {
  adminOverview,
  adminMaintenance,
  adminStorage,
  adminUsers,
  healthView,
  jobsView,
  storageSummary,
  updateView,
} from "./admin";
import { reviewStorageChange, storageChangeView } from "./storage-review";
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
export function mountAdmin(app: Hono<PreviewEnv>) {
  app.use("/api/views/admin/*", async (c, next) => {
    if (requireUser(c.var.state).role === "member")
      throw new PreviewError(403, "Admin access required.");
    if (c.var.state.scenario === "admin-unavailable")
      throw new PreviewError(503, "Sample admin pages are unavailable.");
    await next();
  });
  app.use("/api/admin/*", async (c, next) => {
    if (requireUser(c.var.state).role !== "owner")
      throw new PreviewError(403, "Owner access required.");
    await next();
  });
  app.get("/api/views/admin/overview", (c) =>
    c.json(adminOverview(c.var.state)),
  );
  app.get("/api/views/admin/maintenance", (c) =>
    c.json(adminMaintenance(c.var.state)),
  );
  app.get("/api/views/admin/storage", (c) =>
    c.json(adminStorage(c.var.state, c.req.query("mutationId"))),
  );
  app.get("/api/views/admin/users", (c) =>
    c.json(adminUsers(c.var.state, c.var.site)),
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
        hasPassword: true,
        oidcLinked: false,
      },
      sso: null,
      storage: {
        used: row.retainedBytes,
        files: row.retainedFileCount,
        folders: row.retainedFolderCount,
        lastChange: row.lastContentActivityAt,
      },
      // Only your own page has the browser you're using.
      devices: devices(state).map((device) => ({
        ...device,
        current: device.current && user.id === state.userId,
      })),
      keys: state.keys.get(user.id) ?? [],
      signInUrl: `${c.var.site}/`,
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
  app.get("/api/views/admin/storage/changes/:id", (c) => {
    const change = storageChangeView(c.var.state, c.req.param("id"));
    if (!change)
      throw new PreviewError(
        404,
        "Change not found.",
        "STORAGE_MUTATION_NOT_FOUND",
      );
    return c.json({
      ...change,
      isOwner: c.var.state.userId === "owner",
    });
  });
  app.post("/api/admin/storage/mutations/:id/review", async (c) => {
    const { choice } = (await c.req.json()) as { choice: string };
    return c.json({
      result: reviewStorageChange(c.var.state, c.req.param("id"), choice),
    });
  });
  app.get("/api/admin/health", (c) => c.json(healthView(c.var.state)));
  app.post("/api/admin/storage/mutations/:id/retry", (c) => {
    if (c.req.param("id") !== "sample-move")
      throw new PreviewError(404, "Sample mutation not found.");
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
  app.get("/api/admin/jobs/problems", (c) =>
    c.json({ items: jobsView(c.var.state).initialProblems }),
  );
  app.get("/api/admin/jobs/problem-targets", (c) => {
    const kind = z.enum(jobKinds).parse(c.req.query("kind"));
    return c.json({
      ids: c.var.state.jobs
        .filter(
          (job) =>
            job.kind === kind &&
            (job.status === "failed" || job.status === "dead"),
        )
        .map((job) => job.id),
    });
  });
  // The steps a real run records, in order, ending with how it went.
  app.get("/api/admin/jobs/:id/events", (c) => {
    const job = c.var.state.jobs.find((j) => j.id === c.req.param("id"));
    const event = (type: string, message: string) => ({
      id: `${c.req.param("id")}-${type}`,
      jobId: c.req.param("id"),
      type,
      message,
      metadataJson: {},
      workerId: "sample-worker",
      createdAt: job?.updatedAt ?? timestamp,
    });
    const end =
      job?.status === "failed" || job?.status === "dead"
        ? [event("failed", job.lastError ?? "Sample job could not finish.")]
        : job?.status === "succeeded"
          ? [event("succeeded", "Job completed successfully.")]
          : [];
    return c.json({
      items: [
        event("queued", "Job queued."),
        event("claimed", "Job claimed by worker."),
        event("started", "Job handler started."),
        ...end,
      ],
    });
  });
  app.post("/api/admin/jobs/run", async (c) => {
    const body = await jsonBody(c.req.raw);
    const kind = z.enum(jobKinds).parse(body.kind);
    let job = c.var.state.jobs.find((j) => j.kind === kind);
    if (!job) {
      job = sampleJob(kind, crypto.randomUUID());
      c.var.state.jobs.push(job);
    }
    job.status = "succeeded";
    job.lastError = null;
    return c.json({ message: "Sample job finished.", jobId: job.id });
  });
  app.post("/api/admin/jobs/:id/:action", (c) => {
    const state = c.var.state;
    const job = state.jobs.find((j) => j.id === c.req.param("id"));
    if (!job) throw new PreviewError(404, "Job not found.");
    const action = c.req.param("action");
    const actionApplied =
      (action !== "dismiss" && c.req.query("failedOnly") !== "1") ||
      job.status === "failed" ||
      job.status === "dead";
    if (!actionApplied)
      return c.json({
        message: "This job has already changed.",
        jobId: job.id,
        actionApplied: false,
        status: job.status,
      });
    if (action === "dismiss") job.status = "cancelled";
    else if (action === "cancel") job.status = "cancelled";
    else if (action === "retry") {
      job.status = "succeeded";
      job.lastError = null;
    } else throw new PreviewError(404, "Unknown job action.");
    return c.json({
      message: "Sample job updated.",
      jobId: job.id,
      actionApplied: true,
      status: job.status,
    });
  });
  // One reply per request, and the browser asks again after `retry`. A stream
  // held open keeps the demo's service worker busy, so a new build could never
  // take over.
  app.get("/api/admin/live", (c) =>
    streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: "update",
        data: JSON.stringify(updateView(c.var.state)),
        retry: 1000,
      });
      if (c.req.query("jobs") !== "1") return;
      const data = jobsView(c.var.state);
      await stream.writeSSE({
        event: "state",
        data: JSON.stringify({
          lastRuns: data.initialLastRuns,
          problems: data.initialProblems,
          summary: data.initialSummary,
        }),
      });
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
    const body = adminCreateUserInputSchema.parse(await jsonBody(c.req.raw));
    const temporaryPassword = sampleTemporaryPassword(body);
    const email = body.email;
    if (c.var.state.users.some((u) => u.email === email))
      throw new PreviewError(409, "That sample account already exists.");
    const user = {
      ...c.var.state.users[2]!,
      id: crypto.randomUUID(),
      email,
      displayName: null,
      role: body.isAdmin ? ("admin" as const) : ("member" as const),
      storageId: crypto.randomUUID(),
      storageLimitBytes: body.storageLimitBytes?.toString() ?? null,
      note: "Not signed in yet",
    };
    c.var.state.passwords.set(user.id, temporaryPassword);
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
      await jsonBody(c.req.raw),
    );
    if (
      c.var.state.users.some(
        (other) => other.id !== user.id && other.email === values.email,
      )
    )
      throw new PreviewError(409, "That sample account already exists.");
    Object.assign(user, plain(values));
    if (isAdmin !== undefined && user.role !== "owner")
      user.role = isAdmin ? "admin" : "member";
    return c.json({ user });
  });
  app.post("/api/admin/users/:id/password-reset", async (c) => {
    const user = editableUser(c.var.state, c.req.param("id"));
    const body = temporaryPasswordInputSchema
      .extend({ generateTemporaryPassword: z.boolean().default(true) })
      .parse(await jsonBody(c.req.raw));
    const temporaryPassword = sampleTemporaryPassword(body);
    c.var.state.passwords.set(user.id, temporaryPassword);
    c.var.state.keys.delete(user.id);
    const firstRun = c.var.state.firstRuns.get(user.id);
    if (body.requirePasswordChange !== false) {
      c.var.state.firstRuns.set(
        user.id,
        firstRun === "member" || firstRun === "member-password"
          ? "member-password"
          : "password",
      );
    } else if (firstRun === "password") {
      c.var.state.firstRuns.delete(user.id);
    } else if (firstRun === "member-password") {
      c.var.state.firstRuns.set(user.id, "member");
    }
    return c.json({
      user,
      temporaryPassword,
      signInUrl: `${c.var.site}/`,
    });
  });
  // Without a session id, every session but this browser signs out. The
  // sample keeps one list of sessions for every account.
  app.delete("/api/admin/users/:id/sessions/:sessionId?", (c) => {
    if (requireUser(c.var.state).role !== "owner")
      throw new PreviewError(403, "Owner access required.");
    const sessionId = c.req.param("sessionId");
    c.var.state.sessions = c.var.state.sessions.filter((id) =>
      sessionId ? id !== sessionId : id === "current",
    );
    const { keys } = c.var.state;
    const userId = c.req.param("id");
    keys.set(
      userId,
      sessionId
        ? (keys.get(userId) ?? []).filter((key) => key.id !== sessionId)
        : [],
    );
    return c.json({ ok: true });
  });
}
