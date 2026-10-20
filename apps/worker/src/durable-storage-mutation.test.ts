import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

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
    mocks.prepareStorageMutation.mockReset();
    mocks.findStorageMutation.mockReset().mockResolvedValue(null);
    mocks.claimAndExecuteStorageMutation
      .mockReset()
      .mockResolvedValue(undefined);
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

describe("artifact publication admission", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertStorageFilesystemSupported.mockResolvedValue(undefined);
    mocks.prepareStorageMutation.mockReset();
    mocks.findStorageMutation.mockReset().mockResolvedValue(null);
    mocks.claimAndExecuteStorageMutation
      .mockReset()
      .mockResolvedValue(undefined);
  });

  it("waits for a brief competing publication without running the job again", async () => {
    vi.useFakeTimers();
    const { StorageMutationConflictError } =
      await import("@staaash/db/storage-mutations");
    mocks.prepareStorageMutation
      .mockRejectedValueOnce(
        new StorageMutationConflictError(
          "STORAGE_MUTATION_IN_PROGRESS",
          "other",
        ),
      )
      .mockResolvedValueOnce({
        replayed: false,
        mutation: { id: input.mutationId },
      });
    const running = runWorkerStorageMutation(input);
    await vi.advanceTimersByTimeAsync(500);
    await running;
    expect(mocks.prepareStorageMutation).toHaveBeenCalledTimes(2);
    expect(mocks.claimAndExecuteStorageMutation).toHaveBeenCalledOnce();
  });

  it("keeps the existing bounded wait when a resource never becomes available", async () => {
    vi.useFakeTimers();
    const { StorageMutationConflictError } =
      await import("@staaash/db/storage-mutations");
    const busy = new StorageMutationConflictError(
      "STORAGE_MUTATION_IN_PROGRESS",
      "other",
    );
    mocks.prepareStorageMutation.mockRejectedValue(busy);
    const running = expect(runWorkerStorageMutation(input)).rejects.toBe(busy);
    await vi.advanceTimersByTimeAsync(5000);
    await running;
    expect(mocks.claimAndExecuteStorageMutation).not.toHaveBeenCalled();
  });

  it("stops admission on cancellation without accepting a new mutation", async () => {
    vi.useFakeTimers();
    const { StorageMutationConflictError } =
      await import("@staaash/db/storage-mutations");
    mocks.prepareStorageMutation.mockRejectedValue(
      new StorageMutationConflictError("STORAGE_MUTATION_IN_PROGRESS", "other"),
    );
    const controller = new AbortController();
    const running = expect(
      runWorkerStorageMutation({ ...input, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "UPLOAD_CANCELLED" });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await running;
    expect(mocks.prepareStorageMutation).toHaveBeenCalledOnce();
    expect(mocks.claimAndExecuteStorageMutation).not.toHaveBeenCalled();
  });

  it("does not retry a recovery block as a short resource conflict", async () => {
    const { StorageMutationConflictError } =
      await import("@staaash/db/storage-mutations");
    const blocked = new StorageMutationConflictError(
      "STORAGE_RECOVERY_REQUIRED",
      "other",
    );
    mocks.prepareStorageMutation.mockRejectedValue(blocked);
    await expect(runWorkerStorageMutation(input)).rejects.toBe(blocked);
    expect(mocks.prepareStorageMutation).toHaveBeenCalledOnce();
  });

  it("keeps durable ownership when an accepted journal appears during the wait", async () => {
    vi.useFakeTimers();
    const { StorageMutationConflictError } =
      await import("@staaash/db/storage-mutations");
    mocks.prepareStorageMutation
      .mockRejectedValueOnce(
        new StorageMutationConflictError(
          "STORAGE_MUTATION_IN_PROGRESS",
          "other",
        ),
      )
      .mockResolvedValueOnce({
        replayed: true,
        mutation: { id: input.mutationId, status: "prepared" },
      });
    const running = expect(
      runWorkerStorageMutation(input),
    ).rejects.toMatchObject({
      name: "StorageMutationOwnedError",
      mutationId: input.mutationId,
    });
    await vi.advanceTimersByTimeAsync(500);
    await running;
    expect(mocks.claimAndExecuteStorageMutation).not.toHaveBeenCalled();
  });
});
