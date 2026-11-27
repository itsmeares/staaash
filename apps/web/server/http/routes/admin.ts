import { ALL_SUPPORTED_JOB_KINDS } from "@staaash/db/jobs";
import { retryStorageMutationNow } from "@staaash/db/storage-mutations";
import { z } from "zod";

import {
  enqueueAdminRestoreReconciliation,
  getAdminIntegritySummary,
  toJsonAdminIntegritySummary,
} from "@/server/admin/integrity";
import {
  cancelAdminJob,
  dismissAdminJob,
  enqueueAdminStagingCleanup,
  enqueueAdminTrashRetention,
  getAdminJobEvents,
  getAdminProblemJobIds,
  getAdminJobListResponse,
  getAdminProblemJobs,
  getAdminJobSummary,
  parseAdminJobFilters,
  retryAdminJob,
  toJsonAdminJobSummary,
} from "@/server/admin/jobs";
import { createAdminLiveStream } from "@/server/admin/live";
import { saveSystemSettings } from "@/server/admin/settings";
import {
  getAdminStorageSummary,
  toJsonAdminStorageSummary,
} from "@/server/admin/storage";
import { startStorageReviewChoice } from "@/server/admin/storage-review";
import {
  enqueueAdminUpdateCheck,
  getAdminUpdateCheckJob,
  getUpdateState,
} from "@/server/admin/updates";
import { env } from "@/lib/env";
import { issueOidcInvite } from "@/server/auth/oidc";
import { adminUpdateUserInputSchema } from "@/server/auth/schema";
import { authService } from "@/server/auth/service";
import {
  getAdminHealthSummary,
  toJsonInstanceHealthSummary,
} from "@/server/health";
import {
  httpError,
  requireOwner,
  requireUser,
  router,
} from "@/server/http/core";
import { getBaseUrl } from "@/server/request";
import { validator } from "hono/validator";

// Owner-only routes for the bundled web UI. They are not part of the public
// API contract, so they stay out of openapi.json.

const json = <T extends z.ZodType>(schema: T) =>
  validator("json", (value) => schema.parse(value) as z.output<T>);

const jobFailure = (fallback: string) => (error: unknown) => {
  throw httpError(
    400,
    "JOB_ACTION_FAILED",
    error instanceof Error ? error.message : fallback,
  );
};

const DecimalBytes = z
  .string()
  .regex(/^\d+$/, "Storage limit must be a non-negative integer string.")
  .nullish()
  .transform((value) => (value == null ? null : BigInt(value)));

const OptionalString = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);

const CreateUserBody = z.object({
  email: z.string().default(""),
  signInWith: z.enum(["password", "oidc"]).default("password"),
  temporaryPassword: OptionalString,
  confirmTemporaryPassword: OptionalString,
  generateTemporaryPassword: z.boolean().default(false),
  storageLimitBytes: DecimalBytes,
  isAdmin: z.boolean().default(false),
  requirePasswordChange: z.boolean().default(true),
});

// A field left out stays as it is.
const UpdateUserBody = z.object({
  email: z.string().optional(),
  displayName: z.string().nullable().optional(),
  storageLimitBytes: DecimalBytes.optional(),
  isAdmin: z.boolean().optional(),
});

const PasswordResetBody = z.object({
  temporaryPassword: OptionalString,
  confirmTemporaryPassword: OptionalString,
  generateTemporaryPassword: z.boolean().default(true),
  requirePasswordChange: z.boolean().default(true),
});

const RunJobBody = z.object({ kind: z.enum(ALL_SUPPORTED_JOB_KINDS) });

const userView = <User extends { storageLimitBytes: bigint | null }>(
  user: User,
) => ({
  ...user,
  storageLimitBytes: user.storageLimitBytes?.toString() ?? null,
});

const queued = (created: boolean, done: string, already: string) =>
  created ? done : already;

const admin = router().basePath("/api/admin");
admin.use("*", requireUser, requireOwner);

export const adminRoutes = admin
  .get("/health", async (c) =>
    c.json(toJsonInstanceHealthSummary(await getAdminHealthSummary())),
  )
  .get("/integrity", async (c) =>
    c.json(toJsonAdminIntegritySummary(await getAdminIntegritySummary())),
  )
  .post("/integrity", async (c) => {
    const result = await enqueueAdminRestoreReconciliation(
      c.var.session.user.id,
    );
    return c.json({
      message: queued(
        result.created,
        "Restore check queued.",
        "A restore check is already queued or running.",
      ),
      jobId: result.job.id,
      runId: result.run?.id ?? null,
    });
  })
  .get("/storage", async (c) =>
    c.json(toJsonAdminStorageSummary(await getAdminStorageSummary())),
  )
  .post("/storage/mutations/:mutationId/retry", async (c) => {
    await retryStorageMutationNow(c.req.param("mutationId"));
    return c.json({ ok: true as const });
  })
  .post(
    "/storage/mutations/:mutationId/review",
    json(
      z.object({
        choice: z.enum(["finish", "keep", "undo", "remove", "retry"]),
        seen: z.string().max(100).nullable(),
      }),
    ),
    async (c) =>
      c.json({
        result: await startStorageReviewChoice(
          c.req.param("mutationId"),
          c.req.valid("json"),
          c.var.session.user.id,
        ),
      }),
  )
  .get("/jobs", async (c) =>
    c.json(
      await getAdminJobListResponse(
        parseAdminJobFilters({
          status: c.req.query("status") ?? null,
          kind: c.req.query("kind") ?? null,
          cursor: c.req.query("cursor") ?? null,
          limit: c.req.query("limit") ?? null,
          page: c.req.query("page") ?? null,
        }),
      ),
    ),
  )
  .get("/jobs/problems", async (c) =>
    c.json({ items: await getAdminProblemJobs() }),
  )
  .get("/jobs/problem-targets", async (c) => {
    const kind = z.enum(ALL_SUPPORTED_JOB_KINDS).parse(c.req.query("kind"));
    return c.json({ ids: await getAdminProblemJobIds(kind) });
  })
  .get("/jobs/summary", async (c) =>
    c.json(toJsonAdminJobSummary(await getAdminJobSummary())),
  )
  .post("/jobs/run", json(RunJobBody), async (c) => {
    const { kind } = c.req.valid("json");
    const enqueue = {
      "staging.cleanup": () => enqueueAdminStagingCleanup(),
      "trash.retention": () => enqueueAdminTrashRetention(),
      "update.check": () => enqueueAdminUpdateCheck(),
      "restore.reconcile": () =>
        enqueueAdminRestoreReconciliation(c.var.session.user.id),
    }[kind as string];
    if (!enqueue)
      throw httpError(400, "INVALID_JOB_KIND", "Unhandled job kind.");
    const result = await enqueue();
    return c.json({
      message: queued(
        result.created,
        "Job queued.",
        "Job already queued or running.",
      ),
      jobId: result.job.id,
    });
  })
  .post("/jobs/:jobId/cancel", async (c) => {
    const job = await cancelAdminJob(
      c.req.param("jobId"),
      c.var.session.user.id,
    ).catch(jobFailure("Failed to cancel job."));
    return c.json({ message: "Job cancelled.", jobId: job.id });
  })
  .post("/jobs/:jobId/dismiss", async (c) => {
    const job = await dismissAdminJob(
      c.req.param("jobId"),
      c.var.session.user.id,
    ).catch(jobFailure("Failed to dismiss job."));
    return c.json({
      message: job.actionApplied
        ? "Job dismissed."
        : "This job has already changed.",
      jobId: job.id,
      actionApplied: job.actionApplied,
      status: job.status,
    });
  })
  .post("/jobs/:jobId/retry", async (c) => {
    const job = await retryAdminJob(
      c.req.param("jobId"),
      c.var.session.user.id,
      c.req.query("failedOnly") === "1",
    ).catch(jobFailure("Failed to retry job."));
    return c.json({
      message: job.actionApplied
        ? "Job queued for retry."
        : "This job has already changed.",
      jobId: job.id,
      actionApplied: job.actionApplied,
      status: job.status,
    });
  })
  .get("/jobs/:jobId/events", async (c) => {
    const events = await getAdminJobEvents(c.req.param("jobId"));
    return c.json({
      items: events.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
      })),
    });
  })
  .get("/live", (c) =>
    createAdminLiveStream(c.req.raw, c.req.query("jobs") === "1"),
  )
  .get("/updates", async (c) => c.json(await getUpdateState()))
  .get("/updates/check", async (c) => {
    const jobId = c.req.query("jobId")?.trim();
    if (!jobId) throw httpError(400, "INVALID_REQUEST", "jobId is required.");
    const job = await getAdminUpdateCheckJob(jobId);
    if (!job) {
      throw httpError(404, "JOB_NOT_FOUND", "Update check job not found.");
    }
    return c.json({
      job: { id: job.id, status: job.status, lastError: job.lastError },
      updateState: await getUpdateState(),
    });
  })
  .post("/updates/check", async (c) => {
    const result = await enqueueAdminUpdateCheck();
    return c.json({
      message: queued(
        result.created,
        "Update check queued.",
        "An active update check is already queued or running.",
      ),
      jobId: result.job.id,
    });
  })
  .put("/settings", json(z.record(z.string(), z.string())), async (c) => {
    const result = await saveSystemSettings(c.req.valid("json"));
    return c.json(result, result.fieldErrors ? 400 : 200);
  })
  .post("/users", json(CreateUserBody), async (c) => {
    const result = await authService.createUser(
      c.var.session.user.id,
      c.req.valid("json"),
    );
    return c.json(
      {
        user: userView(result.user),
        temporaryPassword: result.temporaryPassword,
        // No password means the account joins through a one-time link.
        inviteUrl:
          env.oidc && !result.user.hasPassword
            ? await issueOidcInvite(env.oidc, result.user.id)
            : null,
      },
      201,
    );
  })
  .post("/users/:userId/oidc-invite", async (c) => {
    const user = await authService.requireOidcInvitable(
      c.var.session.user.id,
      c.req.param("userId"),
    );
    return c.json({
      email: user.email,
      inviteUrl: await issueOidcInvite(env.oidc!, user.id),
    });
  })
  .post("/users/:userId/oidc-disconnect", async (c) => {
    await authService.disconnectUserOidc(
      c.var.session.user.id,
      c.req.param("userId"),
    );
    return c.json({ ok: true as const });
  })
  .patch("/users/:userId", json(UpdateUserBody), async (c) => {
    const user = await authService.updateUser(
      c.var.session.user.id,
      c.req.param("userId"),
      adminUpdateUserInputSchema.parse(c.req.valid("json")),
    );
    return c.json({ user: userView(user) });
  })
  .post("/users/:userId/password-reset", json(PasswordResetBody), async (c) => {
    const body = c.req.valid("json");
    const result = await authService.resetTemporaryPassword(
      c.var.session.user.id,
      c.req.param("userId"),
      body,
    );
    return c.json({
      user: userView(result.user),
      temporaryPassword: result.temporaryPassword,
      signInUrl: new URL("/", getBaseUrl(c.req.raw.headers)).toString(),
    });
  })
  .delete("/users/:userId/sessions", async (c) => {
    await authService.revokeAllUserSessions(
      c.var.session.user.id,
      c.req.param("userId"),
      c.var.session.id,
    );
    return c.json({ ok: true as const });
  })
  .delete("/users/:userId/sessions/:sessionId", async (c) => {
    await authService.revokeUserSession(
      c.var.session.user.id,
      c.req.param("userId"),
      c.req.param("sessionId"),
      c.var.session.id,
    );
    return c.json({ ok: true as const });
  });
