import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { app } from "@/server/http/app";
import { normalizeFolderName } from "@/server/files/storage-layout";

const mocks = vi.hoisted(() => ({
  session: { user: { id: "owner-1", role: "owner", isOwner: true } },
  getRequestSession: vi.fn(),
  getSession: vi.fn(),
  signIn: vi.fn(),
  bootstrap: vi.fn(),
  revokeSession: vi.fn(),
  changeRequiredPassword: vi.fn(),
  savePreferences: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  setStorageLimit: vi.fn(),
  resetTemporaryPassword: vi.fn(),
  fileMutation: vi.fn(),
  shareMutation: vi.fn(),
  retrievalMutation: vi.fn(),
  createResumableSession: vi.fn(),
  beginSessionCommit: vi.fn(),
  scheduleJob: vi.fn(),
  prepareMutation: vi.fn(),
  storageReady: vi.fn(),
}));
vi.mock("@/server/auth/guards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/guards")>()),
  getRequestSession: mocks.getRequestSession,
}));
vi.mock("@/server/auth/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/service")>()),
  authService: {
    getSession: mocks.getSession,
    signIn: mocks.signIn,
    bootstrap: mocks.bootstrap,
    revokeSession: mocks.revokeSession,
    changeRequiredPassword: mocks.changeRequiredPassword,
    savePreferences: mocks.savePreferences,
    createUser: mocks.createUser,
    updateUser: mocks.updateUser,
    setStorageLimit: mocks.setStorageLimit,
    resetTemporaryPassword: mocks.resetTemporaryPassword,
  },
}));
vi.mock("@/server/files/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/files/service")>()),
  filesService: Object.fromEntries(
    [
      "createFolder",
      "renameFolder",
      "moveFolder",
      "restoreFolder",
      "trashFolder",
      "renameFile",
      "moveFile",
      "restoreFile",
      "trashFile",
      "deleteFile",
      "clearTrash",
      "listTrashFolders",
      "commitResumableUpload",
      "ensureFolderPaths",
    ].map((name) => [name, mocks.fileMutation]),
  ),
}));
vi.mock("@/server/sharing/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/sharing/service")>()),
  sharingService: Object.fromEntries(
    [
      "createOrReissueShare",
      "reissueShare",
      "updateShare",
      "updateSharePassword",
      "revokeShare",
      "deleteShare",
    ].map((name) => [name, mocks.shareMutation]),
  ),
}));
vi.mock("@/server/retrieval/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/retrieval/service")>()),
  retrievalService: Object.fromEntries(
    [
      "setFileFavorite",
      "setFolderFavorite",
      "setFolderFavoriteQuickAccess",
    ].map((name) => [name, mocks.retrievalMutation]),
  ),
}));
vi.mock("@/server/retrieval/recent-tracking", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/retrieval/recent-tracking")
  >()),
  recordFileAccessBestEffort: vi.fn(),
  recordFolderAccessBestEffort: vi.fn(),
}));
vi.mock("@/server/durable-storage-mutation", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/durable-storage-mutation")
  >()),
  assertStorageProtocolReady: mocks.storageReady,
  hashDurableStorageRequest: () => "fixture-hash",
  prepareDurableStorageMutationParent: mocks.prepareMutation,
  findDurableStorageMutationReplay: vi.fn(),
  StorageProtocolNotReadyError: class extends Error {},
}));
vi.mock("@/server/uploads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/uploads")>()),
  assertUploadSizeAllowed: vi.fn(),
  computeFileSha256: vi.fn(),
  UploadError: class extends Error {},
}));
vi.mock("@/server/uploads/admission", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/uploads/admission")>()),
  UploadAdmissionError: class extends Error {},
}));
vi.mock("@/server/uploads/session-service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/uploads/session-service")
  >()),
  createResumableSession: mocks.createResumableSession,
  beginSessionCommit: mocks.beginSessionCommit,
  findActiveResumableSession: vi.fn(async () => ({
    id: "upload-1",
    ownerUserId: "owner-1",
    originalName: "file.txt",
    totalSizeBytes: 1,
    receivedBytes: 1,
    protocolVersion: 2,
    chunkSizeBytes: 1,
    completedChunks: [
      { chunkIndex: 0, startByte: 0, endByte: 0, sizeBytes: 1 },
    ],
  })),
  failAndCleanupResumableSession: vi.fn(),
  recordResumableCommitRecoveryError: vi.fn(),
  restoreResumableSessionAfterCommitRollback: vi.fn(),
}));
vi.mock("@/server/files/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/files/repository")>()),
  prismaFilesRepository: { findFileById: vi.fn(), findFolderById: vi.fn() },
  findArchiveSelectionItems: vi.fn(),
}));
vi.mock("@staaash/db/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@staaash/db/jobs")>()),
  scheduleZipArchiveGenerate: mocks.scheduleJob,
  ALL_SUPPORTED_JOB_KINDS: ["staging.cleanup"],
}));
vi.mock("@staaash/db/zip-archives", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@staaash/db/zip-archives")>()),
  buildZipContentKey: vi.fn(),
  findOrCreateZipArchive: vi.fn(),
  ZIP_ARCHIVE_STATUS_FAILED: "failed",
  ZIP_ARCHIVE_STATUS_READY: "ready",
}));
vi.mock("@/server/admin/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/admin/jobs")>()),
  enqueueAdminStagingCleanup: mocks.scheduleJob,
  enqueueAdminTrashRetention: mocks.scheduleJob,
}));
vi.mock("@/server/admin/updates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/admin/updates")>()),
  enqueueAdminUpdateCheck: mocks.scheduleJob,
}));
vi.mock("@/server/admin/integrity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/admin/integrity")>()),
  enqueueAdminRestoreReconciliation: mocks.scheduleJob,
}));
const routes = [
  {
    path: "/api/auth/password-change-required",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/auth/setup",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/auth/sign-in",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/auth/sign-out",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/files/file-1/delete",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/files/file-1/favorite",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/files/file-1/move",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/files/file-1/rename",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/files/file-1/restore",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/files/file-1/trash",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/folders/folder-1/favorite",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/folders/folder-1/move",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/folders/folder-1/rename",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/folders/folder-1/restore",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/folders/folder-1/trash",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/folders",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/trash/clear",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/shares/share-1/delete",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/shares/share-1/password",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/shares/share-1/revoke",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/shares/share-1/update",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/shares",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/admin/jobs/run",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/admin/users/member-1/password-reset",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/admin/users/member-1",
    method: "PATCH",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/admin/users/member-1/storage-limit",
    method: "PATCH",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/admin/users",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/archives",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/folders/ensure",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/files/move",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/uploads/sessions/upload-1/complete",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/uploads/sessions",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
  {
    path: "/api/user/preferences",
    method: "POST",
    invoke: (request: Request) => app.request(request),
  },
];
// These routes take no body, so only the origin check applies.
const BODYLESS = new Set([
  "/api/auth/sign-out",
  "/api/files/files/file-1/delete",
  "/api/files/files/file-1/restore",
  "/api/files/files/file-1/trash",
  "/api/files/folders/folder-1/restore",
  "/api/files/folders/folder-1/trash",
  "/api/files/trash/clear",
  "/api/shares/share-1/delete",
  "/api/shares/share-1/revoke",
]);
const requestFor = (
  path: string,
  method: string,
  body: string,
  origin = "http://localhost:3000",
  accept = "application/json",
) =>
  new Request(`http://localhost:3000${path}`, {
    method,
    headers: {
      accept,
      "content-type": "application/json",
      host: "localhost:3000",
      origin,
    },
    body,
  });
const expectNoMutation = () => {
  for (const fn of [
    mocks.signIn,
    mocks.bootstrap,
    mocks.revokeSession,
    mocks.changeRequiredPassword,
    mocks.savePreferences,
    mocks.createUser,
    mocks.updateUser,
    mocks.setStorageLimit,
    mocks.resetTemporaryPassword,
    mocks.fileMutation,
    mocks.shareMutation,
    mocks.retrievalMutation,
    mocks.createResumableSession,
    mocks.beginSessionCommit,
    mocks.scheduleJob,
    mocks.prepareMutation,
  ])
    expect(fn).not.toHaveBeenCalled();
};
describe("request validation contracts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getRequestSession.mockResolvedValue(mocks.session);
    mocks.getSession.mockResolvedValue(mocks.session);
  });
  for (const route of routes) {
    if (!BODYLESS.has(route.path))
      it.each(["{", "", "null", "[]", '"string"', "123"])(
        `${route.method} ${route.path} rejects body %s without mutation`,
        async (body) => {
          const request = requestFor(route.path, route.method, body);
          const response = await route.invoke(request);
          expect(response.status).toBe(400);
          expect((await response.json()).error).toEqual(expect.any(String));
          expectNoMutation();
        },
      );
    it(`${route.method} ${route.path} refuses a wrong origin before parsing`, async () => {
      const request = requestFor(
        route.path,
        route.method,
        "{",
        "https://evil.example",
      );
      const response = await route.invoke(request);
      expect(response.status).toBe(403);
      expect(request.bodyUsed).toBe(false);
      expectNoMutation();
    });
  }
  it("missing share targets return a schema validation response", async () => {
    const response = await app.request(requestFor("/api/shares", "POST", "{}"));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_REQUEST");
    expectNoMutation();
  });
  it("an unrelated service SyntaxError remains a 500", async () => {
    mocks.signIn.mockRejectedValueOnce(
      new SyntaxError("Internal service failure"),
    );
    const response = await app.request(
      requestFor(
        "/api/auth/sign-in",
        "POST",
        JSON.stringify({ email: "owner@example.com", password: "password" }),
      ),
    );
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("INTERNAL_ERROR");
  });
  it("upload names are rejected before admission, then a valid request succeeds", async () => {
    const route = routes.find(
      (route) => route.path === "/api/uploads/sessions",
    )!;
    const body = {
      originalName: "bad\u0000name.txt",
      mimeType: "text/plain",
      totalSizeBytes: 1,
    };
    const invalid = await route.invoke(
      requestFor(route.path, route.method, JSON.stringify(body)),
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe("FILE_NAME_INVALID_CHARACTER");
    expect(mocks.createResumableSession).not.toHaveBeenCalled();
    mocks.createResumableSession.mockResolvedValueOnce({
      id: "new-session",
      receivedBytes: 0,
      protocolVersion: 2,
      chunkSizeBytes: 1,
      completedChunks: [],
      expiresAt: new Date("2099-01-01"),
    });
    const valid = await route.invoke(
      requestFor(
        route.path,
        route.method,
        JSON.stringify({ ...body, originalName: "résumé-日本語.txt" }),
      ),
    );
    expect(valid.status).toBe(201);
    expect(mocks.createResumableSession).toHaveBeenCalledOnce();
  });
  it("folder name validation returns 400 and retains error mutation headers", async () => {
    mocks.fileMutation.mockImplementationOnce(({ name }) =>
      normalizeFolderName(name),
    );
    const response = await app.request(
      requestFor(
        "/api/files/folders",
        "POST",
        JSON.stringify({ name: "bad\u0000folder" }),
      ),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("FOLDER_NAME_INVALID_CHARACTER");
    mocks.fileMutation.mockRejectedValueOnce(
      Object.assign(new Error("Storage is busy."), {
        mutationId: "mutation-1",
        status: 503,
        code: "STORAGE_MUTATION_IN_PROGRESS",
      }),
    );
    const retry = await app.request(
      requestFor(
        "/api/files/folders",
        "POST",
        JSON.stringify({ name: "Normal" }),
      ),
    );
    expect(retry.status).toBe(503);
    expect(retry.headers.get("retry-after")).toBe("1");
    expect(retry.headers.get("x-storage-mutation-id")).toBe("mutation-1");
  });
  it("unauthenticated and non-owner requests retain their authorization response", async () => {
    mocks.getRequestSession.mockResolvedValueOnce(null);
    const preferencesRoute = routes.find(
      (route) => route.path === "/api/files/archives",
    )!;
    const response = await preferencesRoute.invoke(
      requestFor(preferencesRoute.path, "POST", "{}"),
    );
    expect(response.status).toBe(401);
    mocks.getRequestSession.mockResolvedValueOnce({
      user: { id: "member", role: "member", isOwner: false },
    });
    const admin = routes.find((route) => route.path === "/api/admin/users")!;
    const denied = await admin.invoke(requestFor(admin.path, "POST", "{"));
    expect(denied.status).toBe(403);
    expectNoMutation();
  });
});
