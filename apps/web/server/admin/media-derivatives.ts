import { getPrisma } from "@staaash/db/client";
import { cancelBackgroundJob } from "@staaash/db/jobs";
import {
  buildDerivativeDedupeKey,
  DERIVATIVE_KIND_PREVIEW,
  DERIVATIVE_KIND_THUMBNAIL,
  DERIVATIVE_PROFILE_1080P,
  markDerivativeStale,
  scheduleDerivativeGenerate,
} from "@staaash/db/media-derivatives";
import { calculateStorageFileChecksum } from "@staaash/db/storage-mutation-executor";

import { runDurableStorageMutation } from "@/server/durable-storage-mutation";
import { httpError } from "@/server/http/core";
import { getSystemSettings } from "@/server/settings";
import { getStoragePath } from "@/server/storage";

export type AdminMediaDerivativeRow = {
  id: string;
  fileId: string;
  status: string;
  sizeBytes: bigint | null;
  generatedAt: Date | null;
  pinnedByAdmin: boolean;
  error: string | null;
  file: {
    originalName: string;
    sizeBytes: bigint;
    owner: {
      email: string;
      displayName: string | null;
    };
  };
};

export type AdminMediaDerivativeSummary = {
  rows: AdminMediaDerivativeRow[];
  deletedCount: number;
};

export type JsonAdminMediaDerivativeRow = Omit<
  AdminMediaDerivativeRow,
  "sizeBytes" | "generatedAt" | "file"
> & {
  sizeBytes: string | null;
  generatedAt: string | null;
  originalName: string;
  originalSizeBytes: string;
  ownerLabel: string;
};

export type JsonAdminMediaDerivativeSummary = {
  rows: JsonAdminMediaDerivativeRow[];
  deletedCount: number;
};

export const getAdminMediaDerivativeSummary =
  async (): Promise<AdminMediaDerivativeSummary> => {
    const db = getPrisma();
    const [rows, deletedCount] = await Promise.all([
      db.mediaDerivative.findMany({
        // Thumbnails are small and automatic; the list is for video previews.
        where: {
          file: { deletedAt: null },
          kind: { not: DERIVATIVE_KIND_THUMBNAIL },
        },
        orderBy: { updatedAt: "desc" },
        take: 200,
        select: {
          id: true,
          fileId: true,
          status: true,
          sizeBytes: true,
          generatedAt: true,
          pinnedByAdmin: true,
          error: true,
          file: {
            select: {
              originalName: true,
              sizeBytes: true,
              owner: { select: { email: true, displayName: true } },
            },
          },
        },
      }),
      db.mediaDerivative.count({
        where: {
          file: { deletedAt: { not: null } },
          kind: { not: DERIVATIVE_KIND_THUMBNAIL },
        },
      }),
    ]);

    return { rows, deletedCount };
  };

export const toJsonAdminMediaDerivativeSummary = (
  summary: AdminMediaDerivativeSummary,
): JsonAdminMediaDerivativeSummary => ({
  deletedCount: summary.deletedCount,
  rows: summary.rows.map((row) => ({
    id: row.id,
    fileId: row.fileId,
    status: row.status,
    sizeBytes: row.sizeBytes?.toString() ?? null,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    pinnedByAdmin: row.pinnedByAdmin,
    error: row.error,
    originalName: row.file.originalName,
    originalSizeBytes: row.file.sizeBytes.toString(),
    ownerLabel: row.file.owner.displayName ?? row.file.owner.email,
  })),
});

const notFound = () =>
  httpError(404, "DERIVATIVE_NOT_FOUND", "Preview file not found.");

export async function regenerateDerivative(fileId: string) {
  if (!(await getSystemSettings()).mediaPreviewEnabled) {
    throw httpError(409, "PREVIEWS_DISABLED", "Media previews are disabled.");
  }
  try {
    await scheduleDerivativeGenerate({
      fileId,
      kind: DERIVATIVE_KIND_PREVIEW,
      profile: DERIVATIVE_PROFILE_1080P,
      reason: "manual-regenerate",
    });
  } catch {
    throw httpError(503, "QUEUE_FAILED", "Failed to queue preview file.");
  }
}

export async function setDerivativePinned(id: string, pinned: boolean) {
  await getPrisma().mediaDerivative.update({
    where: { id },
    data: { pinnedByAdmin: pinned },
  });
}

const cancelDerivativeGeneration = async (
  id: string,
  fileId: string,
  actorUserId: string,
): Promise<string | null> => {
  const db = getPrisma();
  const job = await db.backgroundJob.findFirst({
    where: {
      dedupeKey: buildDerivativeDedupeKey(
        fileId,
        DERIVATIVE_KIND_PREVIEW,
        DERIVATIVE_PROFILE_1080P,
      ),
      status: { in: ["queued", "running"] },
    },
    select: { id: true },
  });
  if (!job) {
    await db.mediaDerivative.updateMany({
      where: { id, status: { in: ["queued", "processing"] } },
      data: { status: "stale", storageKey: null, sizeBytes: null },
    });
    return null;
  }
  try {
    await cancelBackgroundJob({ jobId: job.id, actorUserId });
    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Failed to cancel preview file.";
  }
};

export async function cancelDerivative(id: string, actorUserId: string) {
  const db = getPrisma();
  const derivative = await db.mediaDerivative.findUnique({
    where: { id },
    select: { fileId: true, status: true },
  });
  if (!derivative) throw notFound();
  if (derivative.status !== "queued" && derivative.status !== "processing") {
    throw httpError(
      409,
      "DERIVATIVE_NOT_ACTIVE",
      "Only queued or processing preview files can be cancelled.",
    );
  }

  const error = await cancelDerivativeGeneration(
    id,
    derivative.fileId,
    actorUserId,
  );
  if (error) throw httpError(400, "CANCEL_FAILED", error);
}

export async function removeDerivative(id: string) {
  const db = getPrisma();
  const derivative = await db.mediaDerivative.findUnique({
    where: { id },
    include: { file: { select: { ownerUserId: true } } },
  });
  if (!derivative) throw notFound();

  if (derivative.storageKey) {
    const checksum = await calculateStorageFileChecksum(
      getStoragePath(""),
      derivative.storageKey,
    );
    await runDurableStorageMutation({
      kind: "derivative_purge",
      ownerUserId: derivative.file.ownerUserId,
      idempotencyKey: `admin-derivative-purge:${id}:${derivative.storageRevision}`,
      metadataOperations: [
        {
          action: "update",
          entityType: "derivative",
          entityId: id,
          preRevision: derivative.storageRevision,
          data: { status: "stale", storageKey: null, sizeBytes: null },
        },
      ],
      steps: [
        {
          action: "delete_file",
          targetKey: derivative.storageKey,
          expectedNodeType: "file",
          expectedSizeBytes: derivative.sizeBytes,
          expectedChecksum: checksum,
        },
      ],
      entities: [
        {
          entityType: "derivative",
          entityId: id,
          preRevision: derivative.storageRevision,
          postRevision: derivative.storageRevision + 1,
          beforeJson: { storageKey: derivative.storageKey },
          afterJson: { status: "stale" },
        },
      ],
    });
  } else {
    await markDerivativeStale(id);
  }
}
