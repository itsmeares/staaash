import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

type Row = {
  id: string;
  fileId: string;
  kind: string;
  status: string;
  storageKey: string | null;
  pinnedByAdmin: boolean;
  lastViewedAt: Date | null;
  lastSharedAt: Date | null;
  generatedAt: Date | null;
  updatedAt: Date;
  storageRevision: number;
  sizeBytes: bigint | null;
};

type Where = { id?: string; kind?: string; status?: string | { in: string[] } };

const mocks = vi.hoisted(() => ({
  rows: [] as Row[],
  retentionDays: 14,
  runWorkerStorageMutation: vi.fn(
    async (_input: { metadataOperations: { entityId: string }[] }) => undefined,
  ),
}));

const matches = (row: Row, where: Where) =>
  (where.id === undefined || row.id === where.id) &&
  (where.kind === undefined || row.kind === where.kind) &&
  (where.status === undefined ||
    (typeof where.status === "string"
      ? row.status === where.status
      : where.status.in.includes(row.status)));

vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({
    mediaDerivative: {
      findMany: async ({ where }: { where: Where }) =>
        mocks.rows.filter((row) => matches(row, where)),
    },
    shareLink: { findFirst: async () => null },
    folder: { findUnique: async () => null },
    file: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        ownerUserId: "owner-1",
        folderId: null,
        storageKey: `files/owner/${where.id}.mp4`,
      }),
    },
    systemSettings: {
      findUnique: async () => ({
        mediaPreviewRetentionDays: mocks.retentionDays,
      }),
    },
  }),
}));

vi.mock("@staaash/db/jobs", () => ({
  recoverOrphanedDerivativeGenerations: async () => undefined,
}));

vi.mock("../durable-storage-mutation.js", () => ({
  calculateStorageChecksumIfPresent: async () => "checksum",
  runWorkerStorageMutation: mocks.runWorkerStorageMutation,
}));

import { handleMediaDerivativeCleanup } from "./media-derivative-cleanup.js";

const longAgo = new Date("2020-01-01T00:00:00Z");

const unusedDerivative = (kind: string): Row => ({
  id: `${kind}-1`,
  fileId: "file-1",
  kind,
  status: "ready",
  storageKey: `derivatives/file-1/${kind}`,
  pinnedByAdmin: false,
  lastViewedAt: longAgo,
  lastSharedAt: null,
  generatedAt: longAgo,
  updatedAt: longAgo,
  storageRevision: 3,
  sizeBytes: 1024n,
});

const purgedIds = () =>
  mocks.runWorkerStorageMutation.mock.calls.map(
    ([input]) => input.metadataOperations[0]?.entityId,
  );

describe("media derivative cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.retentionDays = 14;
    mocks.rows = ["thumbnail", "poster", "preview"].map(unusedDerivative);
  });

  it("keeps unused thumbnails and posters and purges only unused video copies", async () => {
    await handleMediaDerivativeCleanup(
      {} as never,
      {
        filesRoot: "unused",
      } as never,
    );

    expect(purgedIds()).toEqual(["preview-1"]);
    expect(mocks.runWorkerStorageMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "derivative_purge",
        steps: [
          expect.objectContaining({
            action: "delete_file",
            targetKey: "derivatives/file-1/preview",
          }),
        ],
      }),
    );
  });

  it("keeps every video copy when retention is 0", async () => {
    mocks.retentionDays = 0;

    await handleMediaDerivativeCleanup(
      {} as never,
      {
        filesRoot: "unused",
      } as never,
    );

    expect(mocks.runWorkerStorageMutation).not.toHaveBeenCalled();
  });
});
