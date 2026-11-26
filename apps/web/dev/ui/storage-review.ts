import type { InferResponseType } from "hono/client";

import type { api } from "../../lib/api";
import { type State, timestamp } from "./state";

// The route adds who is asking; the sample is the change itself.
type Change = Omit<
  InferResponseType<
    (typeof api.api.views.admin.storage.changes)[":mutationId"]["$get"],
    200
  >,
  "isOwner"
>;
type Inspection = NonNullable<Change["inspection"]>;
export type FixedChange = InferResponseType<
  typeof api.api.views.admin.storage.$get,
  200
>["fixed"][number];

type Sample = {
  id: string;
  kind: string;
  ownerUserId: string;
  lastError: string;
  inspection: Omit<Inspection, "checkedAt" | "seen" | "stepId" | "auto">;
};

const copy = "Photos (recovered, 2026-11-25 14-09)";

const samples: Sample[] = [
  {
    id: "sample-move",
    kind: "folder_move",
    ownerUserId: "member",
    lastError: "Both rename source and target exist.",
    inspection: {
      group: "two_copies",
      itemName: "Photos",
      isFolder: true,
      places: [
        {
          role: "new",
          label: "Files / … / Photos",
          state: "changed",
          isFolder: true,
          sizeBytes: "1503238553",
          fileCount: 312,
          expectedSizeBytes: null,
          modifiedAt: "2026-11-25T14:02:00.000Z",
        },
        {
          role: "old",
          label: "Files / Photos",
          state: "changed",
          isFolder: true,
          sizeBytes: "220200960",
          fileCount: 12,
          expectedSizeBytes: null,
          modifiedAt: "2026-11-25T14:09:00.000Z",
        },
      ],
      choices: [
        { id: "finish", copyName: copy },
        { id: "undo", copyName: copy },
        { id: "retry" },
      ],
    },
  },
  {
    id: "sample-changed",
    kind: "file_move",
    ownerUserId: "member",
    lastError: "Mutation path checksum differs from intent.",
    inspection: {
      group: "changed",
      itemName: "report.pdf",
      isFolder: false,
      places: [
        {
          role: "new",
          label: "Files / … / report.pdf",
          state: "changed",
          isFolder: false,
          sizeBytes: "2202009",
          fileCount: 1,
          expectedSizeBytes: "2516582",
          modifiedAt: "2026-11-25T13:51:00.000Z",
        },
        {
          role: "old",
          label: "Files / report.pdf",
          state: "empty",
          isFolder: false,
          sizeBytes: null,
          fileCount: null,
          expectedSizeBytes: "2516582",
          modifiedAt: null,
        },
      ],
      choices: [{ id: "keep" }, { id: "undo" }, { id: "retry" }],
    },
  },
  {
    id: "sample-missing",
    kind: "file_move",
    ownerUserId: "member",
    lastError: "Both rename source and target are missing.",
    inspection: {
      group: "no_copy",
      itemName: "budget.xlsx",
      isFolder: false,
      places: [
        {
          role: "new",
          label: "Files / … / budget.xlsx",
          state: "missing",
          isFolder: false,
          sizeBytes: null,
          fileCount: null,
          expectedSizeBytes: "48230",
          modifiedAt: null,
        },
        {
          role: "old",
          label: "Files / budget.xlsx",
          state: "missing",
          isFolder: false,
          sizeBytes: null,
          fileCount: null,
          expectedSizeBytes: "48230",
          modifiedAt: null,
        },
      ],
      choices: [{ id: "remove" }, { id: "retry" }],
    },
  },
  {
    id: "sample-link",
    kind: "folder_trash",
    ownerUserId: "member",
    lastError: "Tree manifest contains symbolic link.",
    inspection: {
      group: "unsafe",
      itemName: "Camera",
      isFolder: true,
      unsafeReason: "shortcut_inside",
      places: [
        {
          role: "new",
          label: "Trash / … / Camera",
          state: "empty",
          isFolder: true,
          sizeBytes: null,
          fileCount: null,
          expectedSizeBytes: null,
          modifiedAt: null,
        },
        {
          role: "old",
          label: "Files / … / Camera",
          state: "unsafe",
          isFolder: true,
          sizeBytes: null,
          fileCount: null,
          expectedSizeBytes: null,
          modifiedAt: null,
        },
      ],
      choices: [{ id: "retry" }],
    },
  },
];

const sampleFixed: FixedChange[] = [
  {
    id: "fixed-auto",
    kind: "folder_move",
    status: "succeeded",
    ownerUserId: "member",
    reviewedAt: "2026-11-24T18:40:00.000Z",
    choice: "finish",
    automatic: true,
    byUserId: null,
    keptCount: 1,
  },
];

const fixedOf = (state: State, id: string) =>
  state.fixedChanges.find((change) => change.id === id);

export const activeReviewSamples = (state: State) =>
  samples.filter(
    (sample) =>
      !fixedOf(state, sample.id) &&
      (state.scenario === "review" ||
        (state.recovering && sample.id === "sample-move")),
  );

export const reviewSummary = (id: string) => {
  const sample = samples.find((candidate) => candidate.id === id);
  return sample
    ? {
        group: sample.inspection.group,
        itemName: sample.inspection.itemName,
        error: null,
      }
    : null;
};

export const fixedChangesView = (state: State) =>
  state.scenario === "review"
    ? [...state.fixedChanges, ...sampleFixed]
    : state.fixedChanges;

const ownerNameOf = (state: State, userId: string) => {
  const owner = state.users.find((user) => user.id === userId);
  return owner?.displayName ?? owner?.email ?? "Unknown user";
};

const baseView = (
  state: State,
  item: { id: string; kind: string; ownerUserId: string },
) => ({
  id: item.id,
  kind: item.kind,
  createdAt: timestamp,
  stoppedAt: "2026-11-25T14:09:00.000Z",
  ownerName: ownerNameOf(state, item.ownerUserId),
});

const stoppedView = (state: State, sample: Sample): Change => ({
  ...baseView(state, sample),
  status: "recovery_required",
  reviewedAt: null,
  lastError: sample.lastError,
  inspection: {
    ...sample.inspection,
    checkedAt: "2026-11-25T14:10:00.000Z",
    seen: `${sample.id}-seen`,
    stepId: `${sample.id}-step`,
    auto: null,
  },
  fixes: [],
});

const fixedView = (
  state: State,
  fixed: FixedChange,
  sample: Sample | undefined,
): Change => ({
  ...baseView(state, fixed),
  status: fixed.status,
  reviewedAt: fixed.reviewedAt,
  lastError: sample?.lastError ?? null,
  inspection: null,
  fixes: [
    {
      id: `${fixed.id}-fix`,
      choice: fixed.choice ?? "finish",
      automatic: fixed.automatic,
      byUserId: fixed.byUserId,
      byName: fixed.automatic ? null : "Alex Morgan",
      at: fixed.reviewedAt,
      group: sample?.inspection.group ?? "in_the_way",
      guard: `${fixed.id}-step:in_the_way`,
      kept: Array.from({ length: fixed.keptCount }, () => ({
        itemId: "member-recovered",
        kind: "folder" as const,
        name: copy,
        keepMutationId: `${fixed.id}-keep`,
      })),
      removedEmptyFolders: 0,
    },
  ],
});

export function storageChangeView(state: State, id: string): Change | null {
  const sample = samples.find((candidate) => candidate.id === id);
  const fixed =
    fixedOf(state, id) ?? sampleFixed.find((item) => item.id === id);
  if (fixed) return fixedView(state, fixed, sample);
  return sample ? stoppedView(state, sample) : null;
}

export function reviewStorageChange(state: State, id: string, choice: string) {
  const sample = activeReviewSamples(state).find((item) => item.id === id);
  if (!sample) return "changed" as const;
  if (choice === "retry") return "stopped" as const;
  state.fixedChanges.unshift({
    id,
    kind: sample.kind,
    status: choice === "undo" ? "aborted" : "succeeded",
    ownerUserId: sample.ownerUserId,
    reviewedAt: new Date().toISOString(),
    choice: choice as FixedChange["choice"],
    automatic: false,
    byUserId: state.userId,
    keptCount: sample.inspection.choices.some(
      (item) => item.id === choice && item.copyName,
    )
      ? 1
      : 0,
  });
  return "fixed" as const;
}
