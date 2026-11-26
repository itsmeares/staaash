import { getPrisma } from "@staaash/db/client";
import {
  applyStorageReviewChoice,
  executeReviewedStorageMutation,
  readStorageReview,
  refreshStorageReviewInspection,
  type StorageReviewChoice,
} from "@staaash/db/storage-review";

import { getStorageRoot } from "@/server/storage";

const inspecting = new Set<string>();

// A page view starts the disk check once; the page polls until it is saved.
const inspectInBackground = (mutationId: string) => {
  if (inspecting.has(mutationId)) return;
  inspecting.add(mutationId);
  void refreshStorageReviewInspection({
    mutationId,
    filesRoot: getStorageRoot(),
  })
    .catch((error) => {
      console.warn("[storage-review] Check failed.", {
        mutationId,
        error: error instanceof Error ? error.message : "Unknown error.",
      });
    })
    .finally(() => inspecting.delete(mutationId));
};

export const getStorageChangeView = async (mutationId: string) => {
  const review = await readStorageReview(mutationId);
  if (!review) return null;
  const people = await getPrisma().user.findMany({
    where: {
      id: {
        in: [
          review.ownerUserId,
          ...review.review.fixes.flatMap((fix) =>
            fix.byUserId ? [fix.byUserId] : [],
          ),
        ],
      },
    },
    select: { id: true, displayName: true, email: true },
  });
  const nameOf = (userId: string | null) => {
    const person = people.find((candidate) => candidate.id === userId);
    return person ? person.displayName || person.email : null;
  };
  const checking =
    review.status === "recovery_required" && !review.inspectionIsCurrent;
  if (checking) inspectInBackground(mutationId);
  return {
    id: review.id,
    kind: review.kind,
    status: review.status,
    createdAt: review.createdAt,
    stoppedAt: review.recoveryRequiredAt,
    reviewedAt: review.reviewedAt,
    lastError: review.lastError,
    ownerName: nameOf(review.ownerUserId) ?? "Unknown user",
    inspection: checking ? null : (review.review.inspection ?? null),
    fixes: review.review.fixes.map((fix) => ({
      ...fix,
      byName: nameOf(fix.byUserId),
    })),
  };
};

// Long enough for a single file or a small folder; bigger fixes keep running
// and the page shows them as finishing.
const WAIT_FOR_FIX_MS = 10_000;

const runChoice = async (
  mutationId: string,
  choice: StorageReviewChoice,
  userId: string,
) => {
  const filesRoot = getStorageRoot();
  const result = await applyStorageReviewChoice({
    mutationId,
    choice,
    filesRoot,
    byUserId: userId,
  });
  if (result.outcome !== "resumed") return result.outcome;
  const status = await executeReviewedStorageMutation({
    mutationId,
    filesRoot,
    leaseOwner: `storage-review:web:${process.pid}`,
  }).catch(() => null);
  if (status === "succeeded" || status === "aborted") return "fixed";
  return status === "recovery_required" ? "stopped" : "running";
};

export const startStorageReviewChoice = async (
  mutationId: string,
  choice: StorageReviewChoice,
  userId: string,
) => {
  const run = runChoice(mutationId, choice, userId);
  run.catch((error) => {
    console.warn("[storage-review] Fix failed.", {
      mutationId,
      error: error instanceof Error ? error.message : "Unknown error.",
    });
  });
  const timeout = new Promise<"running">((resolve) => {
    setTimeout(() => resolve("running"), WAIT_FOR_FIX_MS).unref();
  });
  return Promise.race([run, timeout]);
};
