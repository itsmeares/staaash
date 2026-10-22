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
  getAdminJobListResponse,
  getAdminJobSummary,
  parseAdminJobFilters,
  retryAdminJob,
  toJsonAdminJobSummary,
} from "@/server/admin/jobs";
import { createAdminLiveStream } from "@/server/admin/live";
import {
  cancelDerivative,
  regenerateDerivative,
  removeDerivative,
  setDerivativePinned,
} from "@/server/admin/media-derivatives";
import {
  ownerOnboardingSettingsSchema,
  saveOwnerOnboardingSettings,
  saveSystemSettings,
} from "@/server/admin/settings";
import {
  getAdminStorageSummary,
  toJsonAdminStorageSummary,
} from "@/server/admin/storage";
import {
  enqueueAdminUpdateCheck,
  getAdminUpdateCheckJob,
  getUpdateState,
} from "@/server/admin/updates";
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
  type AppEnv,
} from "@/server/http/core";
import { getBaseUrl } from "@/server/request";
import type { Context } from "hono";

// Owner-only routes for the bundled web UI. They are not part of the public
// API contract, so they stay out of openapi.json.

const parseJson = async <T extends z.ZodType>(c: Context<AppEnv>, schema: T) =>
  schema.parse(await c.req.json().catch(() => null)) as z.output<T>;

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
  temporaryPassword: OptionalString,
  confirmTemporaryPassword: OptionalString,
  generateTemporaryPassword: z.boolean().default(false),
  storageLimitBytes: DecimalBytes,
  isAdmin: z.boolean().default(false),
  requirePasswordChange: z.boolean().default(true),
});

const UpdateUserBody = z.object({
  email: z.string().optional(),
  displayName: z.string().nullable().optional(),
  storageLimitBytes: DecimalBytes,
  isAdmin: z.boolean().default(false),
});

const PasswordResetBody = z.object({
  temporaryPassword: OptionalString,
  confirmTemporaryPassword: OptionalString,
  generateTemporaryPassword: z.boolean().default(true),
  requirePasswordChange: z.boolean().default(true),
});

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
  .get("/jobs/summary", async (c) =>
    c.json(toJsonAdminJobSummary(await getAdminJobSummary())),
  )
  .post("/jobs/run", async (c) => {
    const { kind } = await parseJson(
      c,
      z.object({ kind: z.enum(ALL_SUPPORTED_JOB_KINDS) }),
    );
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
    return c.json({ message: "Job dismissed.", jobId: job.id });
  })
  .post("/jobs/:jobId/retry", async (c) => {
    const job = await retryAdminJob(
      c.req.param("jobId"),
      c.var.session.user.id,
    ).catch(jobFailure("Failed to retry job."));
    return c.json({ message: "Job queued for retry.", jobId: job.id });
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
  .put("/settings", async (c) => {
    const result = await saveSystemSettings(
      await parseJson(c, z.record(z.string(), z.string())),
    );
    return c.json(result, result.fieldErrors ? 400 : 200);
  })
  .post("/settings/onboarding", async (c) => {
    await saveOwnerOnboardingSettings(
      await parseJson(c, ownerOnboardingSettingsSchema),
    );
    return c.json({ ok: true as const });
  })
  .post("/derivatives/files/:fileId/regenerate", async (c) => {
    await regenerateDerivative(c.req.param("fileId"));
    return c.json({ ok: true as const });
  })
  .post("/derivatives/:id/pin", async (c) => {
    const { pinned } = await parseJson(c, z.object({ pinned: z.boolean() }));
    await setDerivativePinned(c.req.param("id"), pinned);
    return c.json({ ok: true as const });
  })
  .post("/derivatives/:id/cancel", async (c) => {
    await cancelDerivative(c.req.param("id"), c.var.session.user.id);
    return c.json({ ok: true as const });
  })
  .post("/derivatives/:id/remove", async (c) => {
    await removeDerivative(c.req.param("id"));
    return c.json({ ok: true as const });
  })
  .post("/users", async (c) => {
    const result = await authService.createUser(
      c.var.session.user.id,
      await parseJson(c, CreateUserBody),
    );
    return c.json(
      {
        user: userView(result.user),
        temporaryPassword: result.temporaryPassword,
      },
      201,
    );
  })
  .patch("/users/:userId", async (c) => {
    const user = await authService.updateUser(
      c.var.session.user.id,
      c.req.param("userId"),
      adminUpdateUserInputSchema.parse(await parseJson(c, UpdateUserBody)),
    );
    return c.json({ user: userView(user) });
  })
  .post("/users/:userId/password-reset", async (c) => {
    const body = c.req.header("content-type")?.includes("application/json")
      ? await parseJson(c, PasswordResetBody)
      : PasswordResetBody.parse({});
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
  .delete("/users/:userId/sessions/:sessionId", async (c) => {
    await authService.revokeUserSession(
      c.var.session.user.id,
      c.req.param("userId"),
      c.req.param("sessionId"),
      c.var.session.id,
    );
    return c.json({ ok: true as const });
  })
  .patch("/users/:userId/storage-limit", async (c) => {
    const { limitBytes } = await parseJson(
      c,
      z.object({ limitBytes: DecimalBytes }),
    );
    const user = await authService.setStorageLimit(
      c.var.session.user.id,
      c.req.param("userId"),
      limitBytes,
    );
    return c.json({
      id: user.id,
      storageLimitBytes: user.storageLimitBytes?.toString() ?? null,
    });
  });
