import type { InferResponseType } from "hono/client";
import type { api } from "../../lib/api";
import type { Plain } from "../../lib/plain";
import type { InstanceHealthSummary } from "../../server/types";
import type { UpdateState } from "../../server/admin/updates";
import { version } from "../../../../package.json";
import { type State, timestamp, jobKinds, previewStatus } from "./state";
import { storageView } from "./views";

function updateStatus(state: State): UpdateState["status"] {
  if (!state.settings.updateCheckEnabled) return "off";
  if (state.scenario === "update") return "update-available";
  return state.scenario === "error" ? "error" : "up-to-date";
}
export function updateView(state: State): UpdateState {
  const latest =
    state.scenario === "update"
      ? {
          version: "2.1.0",
          name: "Sample release",
          notes:
            "## Sample release\n\nThis release exists only in the frontend preview.",
          publishedAt: timestamp,
          url: null,
        }
      : null;
  return {
    currentVersion: version,
    enabled: state.settings.updateCheckEnabled,
    channel: state.settings.updateChannel ?? "rc",
    channelChosen: !!state.settings.updateChannel,
    repository: null,
    lastCheckedAt: timestamp,
    error: state.scenario === "error" ? "Sample update check failed." : null,
    status: updateStatus(state),
    latest,
    missed: latest ? [latest] : [],
    kind: latest ? "minor" : null,
  };
}
export function storageSummary(state: State) {
  const rows = state.users.map((user) => {
    const files = state.files.filter((f) => f.ownerUserId === user.id);
    return {
      userId: user.id,
      email: user.email,
      storageId: user.storageId,
      displayName: user.displayName,
      isOwner: user.role === "owner",
      isAdmin: user.role !== "member",
      createdAt: user.createdAt,
      retainedFileCount: files.length,
      retainedFolderCount: state.folders.filter(
        (f) => f.ownerUserId === user.id && !f.isFilesRoot,
      ).length,
      retainedBytes: String(storageView(state, user.id).usedBytes),
      lastContentActivityAt: files.length ? timestamp : null,
    };
  });
  return {
    rows,
    totalUsers: rows.length,
    retainedFileCount: rows.reduce((sum, r) => sum + r.retainedFileCount, 0),
    retainedFolderCount: rows.reduce(
      (sum, r) => sum + r.retainedFolderCount,
      0,
    ),
    retainedBytes: String(
      rows.reduce((sum, r) => sum + Number(r.retainedBytes), 0),
    ),
  };
}
const disk = { capacityBytes: "536870912000", usedBytes: "53687091200" };
export function jobsView(state: State) {
  const statusCounts = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
    cancelled: 0,
    total: state.jobs.length,
  };
  const countsByKind: Record<string, Partial<typeof statusCounts>> = {};
  for (const job of state.jobs) {
    statusCounts[job.status]++;
    const counts = countsByKind[job.kind] ?? {};
    counts[job.status] = (counts[job.status] ?? 0) + 1;
    countsByKind[job.kind] = counts;
  }
  const summary = {
    statusCounts,
    countsByKind,
    oldestQueuedAgeSeconds: null,
    oldestDueQueuedAgeSeconds: null,
    nextQueuedRunAt: null,
    staleRunning: 0,
    failed: statusCounts.failed,
    dead: statusCounts.dead,
    workers: [
      {
        id: "sample-worker",
        hostname: "sample-drive",
        pid: 100,
        version,
        startedAt: timestamp,
        lastHeartbeatAt: new Date().toISOString(),
        stoppedAt: null,
        status: "idle",
        currentJobId: null,
        metadataJson: {},
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
  const lastRuns = Object.fromEntries(state.jobs.map((j) => [j.kind, j]));
  return {
    initialLastRuns: lastRuns,
    initialProblems: state.jobs.filter(
      (j) => j.status === "failed" || j.status === "dead",
    ),
    initialSummary: summary,
    initialDerivatives: {
      rows: state.files
        .filter(
          (f) =>
            f.viewerKind === "video" && previewStatus(state, f.id) !== "none",
        )
        .map((f) => ({
          id: `derivative-${f.id}`,
          fileId: f.id,
          status: previewStatus(state, f.id),
          sizeBytes: String(f.sizeBytes),
          generatedAt: timestamp,
          pinnedByAdmin: state.pinnedPreviews.has(f.id),
          error:
            state.scenario === "error" ? "Sample conversion failed." : null,
          originalName: f.name,
          originalSizeBytes: String(f.sizeBytes),
          ownerLabel: state.users.find((u) => u.id === f.ownerUserId)!
            .displayName!,
        })),
      deletedCount: 0,
    },
    jobKinds: [...jobKinds],
  } satisfies InferResponseType<typeof api.api.views.admin.jobs.$get, 200>;
}
function mutationHealth(
  state: State,
): Plain<InstanceHealthSummary>["storageMutations"] {
  if (!state.recovering) return { counts: {}, oldest: null, active: [] };
  const mutation = {
    id: "sample-move",
    kind: "folder_move",
    status: "recovery_required" as const,
    ownerUserId: "owner",
    createdAt: timestamp,
    ageMs: 120000,
  };
  return {
    counts: { recovery_required: 1 },
    oldest: mutation,
    active: [
      {
        ...mutation,
        lastError: "Sample move needs recovery.",
        canRetryNow: true,
        safePathLabels: ["Files / Photos"],
      },
    ],
  };
}
export function healthView(state: State): Plain<InstanceHealthSummary> {
  const failed = state.scenario === "error";
  const incidents = failed ? ["Sample job needs attention."] : [];
  const status = failed ? ("error" as const) : ("healthy" as const);
  const counts = jobsView(state).initialSummary.statusCounts;
  return {
    ok: !failed,
    failures: incidents,
    operational: {
      status,
      incidents,
    },
    checks: {
      app: { status: "healthy" },
      database: { status: "healthy" },
      storage: { status },
      settings: { status: "healthy" },
      storageMutations: { status: "healthy" },
      queue: { status: "healthy" },
    },
    worker: {
      status: "healthy",
      lastSeenAt: new Date().toISOString(),
      message: "Sample worker is ready.",
    },
    queue: {
      queued: counts.queued,
      running: counts.running,
      failed: counts.failed,
      dead: counts.dead,
      cancelled: counts.cancelled,
      oldestQueuedAgeSeconds: null,
      staleRunning: 0,
      status: failed ? "warning" : "healthy",
      probeStatus: "healthy",
    },
    reconciliation: {
      status: "healthy",
      runStatus: "succeeded",
      lastCompletedAt: timestamp,
      missingOriginalCount: 0,
      orphanedStorageCount: 0,
      message: "Sample files match their records.",
    },
    storageMutations: mutationHealth(state),
    storageWarnings: {
      status: "healthy",
      freeBytes: "483183820800",
      totalBytes: disk.capacityBytes,
      message: "Sample disk has space.",
    },
    version: {
      currentVersion: version,
      lastUpdateCheckAt: timestamp,
      updateStatus: updateView(state).status,
      latestVersion: updateView(state).latest?.version ?? null,
    },
  };
}
export function adminOverview(state: State) {
  const health = healthView(state);
  const storage = storageSummary(state);
  return {
    summary: {
      health,
      storage,
      jobs: { ...health.queue, total: state.jobs.length },
      users: {
        total: state.users.length,
        owners: state.users.filter((u) => u.role === "owner").length,
        admins: state.users.filter((u) => u.role === "admin").length,
        members: state.users.filter((u) => u.role === "member").length,
      },
      updates: updateView(state),
    },
    disk,
  } satisfies InferResponseType<typeof api.api.views.admin.overview.$get, 200>;
}
export function adminStorage(state: State) {
  return {
    summary: storageSummary(state),
    mutations: healthView(state).storageMutations.active,
    disk,
  } satisfies InferResponseType<typeof api.api.views.admin.storage.$get, 200>;
}
export function adminUsers(state: State, origin: string) {
  return {
    canInvite: state.userId === "owner",
    signInUrl: `${origin}/`,
    users: state.users.map((u) => ({
      ...u,
      storageUsedBytes: String(storageView(state, u.id).usedBytes),
    })),
  } satisfies InferResponseType<typeof api.api.views.admin.users.$get, 200>;
}
