import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyStorageMutationIntentMetadata: vi.fn(),
  assertStorageFilesystemSupported: vi.fn(),
  claimAndExecuteStorageMutation: vi.fn(),
  findStorageMutation: vi.fn(),
  findStorageMutationByIdempotencyKey: vi.fn(),
  prepareStorageMutation: vi.fn(),
}));

vi.mock("@staaash/db/storage-mutations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@staaash/db/storage-mutations")>()),
  applyStorageMutationIntentMetadata: mocks.applyStorageMutationIntentMetadata,
  findStorageMutation: mocks.findStorageMutation,
  findStorageMutationByIdempotencyKey:
    mocks.findStorageMutationByIdempotencyKey,
  prepareStorageMutation: mocks.prepareStorageMutation,
}));

vi.mock("@staaash/db/storage-mutation-executor", () => ({
  assertStorageFilesystemSupported: mocks.assertStorageFilesystemSupported,
  claimAndExecuteStorageMutation: mocks.claimAndExecuteStorageMutation,
}));

const {
  buildArtifactPublishSteps,
  hashWorkerStorageRequest,
  runWorkerStorageMutation,
} = await import("./durable-storage-mutation.js");

const storagePaths = {
  filesRoot: "C:/storage",
  tmpRoot: "C:/storage/tmp",
  heartbeatPath: "C:/storage/tmp/worker-heartbeat.json",
  pendingDeleteRoot: "C:/storage/tmp/pending-delete",
  uploadStagingTtlMs: 1,
};

const input = {
  mutationId: "publish-1",
  kind: "derivative_publish" as const,
  ownerUserId: "owner-1",
  idempotencyKey: "publish-key-1",
  metadataOperations: [],
  steps: [],
  storagePaths,
  requestHashPayload: { artifactId: "derivative-1" },
};

describe("worker durable mutation prepare ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertStorageFilesystemSupported.mockResolvedValue(undefined);
  });

  it("retains the generated mutation identity when prepare fails after taking ownership", async () => {
    const rejection = new Error("connection lost after commit");
    mocks.prepareStorageMutation.mockRejectedValueOnce(rejection);
    mocks.findStorageMutation.mockImplementationOnce(async (id) => ({
      id,
      kind: input.kind,
      ownerUserId: input.ownerUserId,
      requestHash: hashWorkerStorageRequest(input.requestHashPayload),
    }));
    const pending = runWorkerStorageMutation({
      ...input,
      mutationId: undefined,
    });
    await expect(pending).rejects.toMatchObject({
      name: "StorageMutationOwnedError",
      mutationId: expect.any(String),
      cause: rejection,
    });
    const generatedId = mocks.prepareStorageMutation.mock.calls[0][0].id;
    expect(generatedId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.findStorageMutation).toHaveBeenCalledWith(generatedId);
    expect(mocks.claimAndExecuteStorageMutation).not.toHaveBeenCalled();
  });

  it("does not claim a generated source after a definite prepare rejection", async () => {
    const rejection = new Error("namespace conflict");
    mocks.prepareStorageMutation.mockRejectedValue(rejection);
    mocks.findStorageMutation.mockResolvedValue(null);

    await expect(runWorkerStorageMutation(input)).rejects.toBe(rejection);
  });

  it("preserves a generated source when prepare committed before throwing", async () => {
    const rejection = new Error("connection lost after commit");
    mocks.prepareStorageMutation.mockRejectedValue(rejection);
    mocks.findStorageMutation.mockResolvedValue({
      id: input.mutationId,
      kind: input.kind,
      ownerUserId: input.ownerUserId,
      requestHash: hashWorkerStorageRequest(input.requestHashPayload),
    });

    await expect(runWorkerStorageMutation(input)).rejects.toMatchObject({
      name: "StorageMutationOwnedError",
      mutationId: input.mutationId,
      cause: rejection,
    });
  });
});

describe("generated artifact replacement steps", () => {
  it("isolates incoming and backup paths by mutation ID", () => {
    const first = buildArtifactPublishSteps({
      mutationId: "publish-1",
      tmpKey: "tmp/archives/a.tmp",
      storageKey: "archives/a.zip",
      sizeBytes: 3n,
      checksum: "new",
      oldChecksum: "old",
    });
    const second = buildArtifactPublishSteps({
      mutationId: "publish-2",
      tmpKey: "tmp/archives/a.tmp",
      storageKey: "archives/a.zip",
      sizeBytes: 3n,
      checksum: "new",
      oldChecksum: "old",
    });

    expect(first.map((step) => step.targetKey)).toContain(
      "tmp/incoming/publish-1/a.zip",
    );
    expect(first.map((step) => step.targetKey)).toContain(
      "tmp/backup/publish-1/a.zip",
    );
    expect(second.map((step) => step.targetKey)).toContain(
      "tmp/incoming/publish-2/a.zip",
    );
    expect(second).not.toEqual(first);
  });
});
