import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findExpiredZipArchives: vi.fn(),
  runWorkerStorageMutation: vi.fn(async () => undefined),
  settings: vi.fn(),
}));

vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({
    systemSettings: { findUnique: mocks.settings },
  }),
}));

vi.mock("@staaash/db/zip-archives", () => ({
  findExpiredZipArchives: mocks.findExpiredZipArchives,
}));

vi.mock("../durable-storage-mutation.js", () => ({
  runWorkerStorageMutation: mocks.runWorkerStorageMutation,
}));

import { handleZipArchiveCleanup } from "./zip-archive-cleanup.js";

describe("zip archive cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.mockResolvedValue({ zipArchiveRetentionDays: 7 });
  });

  it("durably deletes expired metadata when no archive bytes were published", async () => {
    mocks.findExpiredZipArchives.mockResolvedValue([
      {
        id: "archive-1",
        userId: "owner-1",
        storageKey: null,
        storageRevision: 2,
        sizeBytes: null,
      },
    ]);

    await handleZipArchiveCleanup(
      {} as never,
      {
        filesRoot: "unused",
      } as never,
    );

    expect(mocks.runWorkerStorageMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "archive_purge",
        ownerUserId: "owner-1",
        steps: [],
        metadataOperations: [
          expect.objectContaining({
            action: "delete",
            entityType: "archive",
            entityId: "archive-1",
            preRevision: 2,
          }),
        ],
      }),
    );
  });
});
