import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/server/auth/guards", () => ({
  getRequestSession: mocks.getRequestSession,
}));
vi.mock("@/server/auth/service", () => ({
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
vi.mock("@/server/files/service", () => ({
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
vi.mock("@/server/sharing/service", () => ({
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
vi.mock("@/server/retrieval/service", () => ({
  retrievalService: Object.fromEntries(
    [
      "setFileFavorite",
      "setFolderFavorite",
      "setFolderFavoriteQuickAccess",
    ].map((name) => [name, mocks.retrievalMutation]),
  ),
}));
vi.mock("@/server/retrieval/recent-tracking", () => ({
  recordFileAccessBestEffort: vi.fn(),
  recordFolderAccessBestEffort: vi.fn(),
}));
vi.mock("@/server/durable-storage-mutation", () => ({
  assertStorageProtocolReady: mocks.storageReady,
  hashDurableStorageRequest: () => "fixture-hash",
  prepareDurableStorageMutationParent: mocks.prepareMutation,
  findDurableStorageMutationReplay: vi.fn(),
  StorageProtocolNotReadyError: class extends Error {},
}));
vi.mock("@/server/uploads", () => ({
  assertUploadSizeAllowed: vi.fn(),
  computeFileSha256: vi.fn(),
  UploadError: class extends Error {},
}));
vi.mock("@/server/uploads/admission", () => ({
  UploadAdmissionError: class extends Error {},
}));
vi.mock("@/server/uploads/session-service", () => ({
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
vi.mock("@/server/files/repository", () => ({
  prismaFilesRepository: { findFileById: vi.fn(), findFolderById: vi.fn() },
}));
vi.mock("@staaash/db/jobs", () => ({
  scheduleZipArchiveGenerate: mocks.scheduleJob,
  ALL_SUPPORTED_JOB_KINDS: ["staging.cleanup"],
}));
vi.mock("@staaash/db/zip-archives", () => ({
  buildZipContentKey: vi.fn(),
  findOrCreateZipArchive: vi.fn(),
  ZIP_ARCHIVE_STATUS_FAILED: "failed",
  ZIP_ARCHIVE_STATUS_READY: "ready",
}));
vi.mock("@/server/admin/jobs", () => ({
  enqueueAdminStagingCleanup: mocks.scheduleJob,
  enqueueAdminTrashRetention: mocks.scheduleJob,
}));
vi.mock("@/server/admin/updates", () => ({
  enqueueAdminUpdateCheck: mocks.scheduleJob,
}));
vi.mock("@/server/admin/integrity", () => ({
  enqueueAdminRestoreReconciliation: mocks.scheduleJob,
}));
import { POST as postAuthPasswordChangeRequired } from "@/app/api/auth/password-change-required/route";
import { POST as postAuthSetup } from "@/app/api/auth/setup/route";
import { POST as postAuthSignIn } from "@/app/api/auth/sign-in/route";
import { POST as postAuthSignOut } from "@/app/api/auth/sign-out/route";
import { POST as postFilesFilesFileidDelete } from "@/app/api/files/files/[fileId]/delete/route";
import { POST as postFilesFilesFileidFavorite } from "@/app/api/files/files/[fileId]/favorite/route";
import { POST as postFilesFilesFileidMove } from "@/app/api/files/files/[fileId]/move/route";
import { POST as postFilesFilesFileidRename } from "@/app/api/files/files/[fileId]/rename/route";
import { POST as postFilesFilesFileidRestore } from "@/app/api/files/files/[fileId]/restore/route";
import { POST as postFilesFilesFileidTrash } from "@/app/api/files/files/[fileId]/trash/route";
import { POST as postFilesFoldersFolderidFavorite } from "@/app/api/files/folders/[folderId]/favorite/route";
import { POST as postFilesFoldersFolderidMove } from "@/app/api/files/folders/[folderId]/move/route";
import { POST as postFilesFoldersFolderidRename } from "@/app/api/files/folders/[folderId]/rename/route";
import { POST as postFilesFoldersFolderidRestore } from "@/app/api/files/folders/[folderId]/restore/route";
import { POST as postFilesFoldersFolderidTrash } from "@/app/api/files/folders/[folderId]/trash/route";
import { POST as postFilesFolders } from "@/app/api/files/folders/route";
import { POST as postFilesTrashClear } from "@/app/api/files/trash/clear/route";
import { POST as postSharesShareidDelete } from "@/app/api/shares/[shareId]/delete/route";
import { POST as postSharesShareidPassword } from "@/app/api/shares/[shareId]/password/route";
import { POST as postSharesShareidRevoke } from "@/app/api/shares/[shareId]/revoke/route";
import { POST as postSharesShareidUpdate } from "@/app/api/shares/[shareId]/update/route";
import { POST as postShares } from "@/app/api/shares/route";
import { POST as postAdminJobsRun } from "@/app/api/admin/jobs/run/route";
import { POST as postAdminUsersUseridPasswordReset } from "@/app/api/admin/users/[userId]/password-reset/route";
import { PATCH as patchAdminUsersUserid } from "@/app/api/admin/users/[userId]/route";
import { PATCH as patchAdminUsersUseridStorageLimit } from "@/app/api/admin/users/[userId]/storage-limit/route";
import { POST as postAdminUsers } from "@/app/api/admin/users/route";
import { POST as postFilesArchives } from "@/app/api/files/archives/route";
import { POST as postFilesFoldersEnsure } from "@/app/api/files/folders/ensure/route";
import { POST as postFilesMove } from "@/app/api/files/move/route";
import { POST as postUploadsSessionsIdComplete } from "@/app/api/uploads/sessions/[id]/complete/route";
import { POST as postUploadsSessions } from "@/app/api/uploads/sessions/route";
import { POST as postUserPreferences } from "@/app/api/user/preferences/route";
const context = {
  params: Promise.resolve({
    fileId: "file-1",
    folderId: "folder-1",
    shareId: "share-1",
    userId: "member-1",
    id: "upload-1",
  }),
};
const routes = [
  {
    path: "/api/auth/password-change-required",
    method: "POST",
    invoke: (request: NextRequest) => postAuthPasswordChangeRequired(request),
  },
  {
    path: "/api/auth/setup",
    method: "POST",
    invoke: (request: NextRequest) => postAuthSetup(request),
  },
  {
    path: "/api/auth/sign-in",
    method: "POST",
    invoke: (request: NextRequest) => postAuthSignIn(request),
  },
  {
    path: "/api/auth/sign-out",
    method: "POST",
    invoke: (request: NextRequest) => postAuthSignOut(request),
  },
  {
    path: "/api/files/files/file-1/delete",
    method: "POST",
    invoke: (request: NextRequest) =>
      postFilesFilesFileidDelete(request, context),
  },
  {
    path: "/api/files/files/file-1/favorite",
    method: "POST",
    invoke: (request: NextRequest) =>
      postFilesFilesFileidFavorite(request, context),
  },
  {
    path: "/api/files/files/file-1/move",
    method: "POST",
    invoke: (request: NextRequest) =>
      postFilesFilesFileidMove(request, context),
  },
  {
    path: "/api/files/files/file-1/rename",
    method: "POST",
    invoke: (request: NextRequest) =>
      postFilesFilesFileidRename(request, context),
  },
  {
    path: "/api/files/files/file-1/restore",
    method: "POST",
    invoke: (request: NextRequest) =>
      postFilesFilesFileidRestore(request, context),
  },
  {
    path: "/api/files/files/file-1/trash",
    method: "POST",
    invoke: (request: NextRequest) =>
      postFilesFilesFileidTrash(request, context),
  },
  {
    path: "/api/files/folders/folder-1/favorite",
    method: "POST",
    invoke: (request: NextRequest) =>
      postFilesFoldersFolderidFavorite(request, context),
  },
  {
    path: "/api/files/folders/folder-1/move",
    method: "POST",
    invoke: (request: NextRequest) =>
      postFilesFoldersFolderidMove(request, context),
  },
  {
    path: "/api/files/folders/folder-1/rename",
    method: "POST",
    invoke: (request: NextRequest) =>
      postFilesFoldersFolderidRename(request, context),
  },
  {
    path: "/api/files/folders/folder-1/restore",
    method: "POST",
    invoke: (request: NextRequest) =>
      postFilesFoldersFolderidRestore(request, context),
  },
  {
    path: "/api/files/folders/folder-1/trash",
    method: "POST",
    invoke: (request: NextRequest) =>
      postFilesFoldersFolderidTrash(request, context),
  },
  {
    path: "/api/files/folders",
    method: "POST",
    invoke: (request: NextRequest) => postFilesFolders(request),
  },
  {
    path: "/api/files/trash/clear",
    method: "POST",
    invoke: (request: NextRequest) => postFilesTrashClear(request),
  },
  {
    path: "/api/shares/share-1/delete",
    method: "POST",
    invoke: (request: NextRequest) => postSharesShareidDelete(request, context),
  },
  {
    path: "/api/shares/share-1/password",
    method: "POST",
    invoke: (request: NextRequest) =>
      postSharesShareidPassword(request, context),
  },
  {
    path: "/api/shares/share-1/revoke",
    method: "POST",
    invoke: (request: NextRequest) => postSharesShareidRevoke(request, context),
  },
  {
    path: "/api/shares/share-1/update",
    method: "POST",
    invoke: (request: NextRequest) => postSharesShareidUpdate(request, context),
  },
  {
    path: "/api/shares",
    method: "POST",
    invoke: (request: NextRequest) => postShares(request),
  },
  {
    path: "/api/admin/jobs/run",
    method: "POST",
    invoke: (request: NextRequest) => postAdminJobsRun(request),
  },
  {
    path: "/api/admin/users/member-1/password-reset",
    method: "POST",
    invoke: (request: NextRequest) =>
      postAdminUsersUseridPasswordReset(request, context),
  },
  {
    path: "/api/admin/users/member-1",
    method: "PATCH",
    invoke: (request: NextRequest) => patchAdminUsersUserid(request, context),
  },
  {
    path: "/api/admin/users/member-1/storage-limit",
    method: "PATCH",
    invoke: (request: NextRequest) =>
      patchAdminUsersUseridStorageLimit(request, context),
  },
  {
    path: "/api/admin/users",
    method: "POST",
    invoke: (request: NextRequest) => postAdminUsers(request),
  },
  {
    path: "/api/files/archives",
    method: "POST",
    invoke: (request: NextRequest) => postFilesArchives(request),
  },
  {
    path: "/api/files/folders/ensure",
    method: "POST",
    invoke: (request: NextRequest) => postFilesFoldersEnsure(request),
  },
  {
    path: "/api/files/move",
    method: "POST",
    invoke: (request: NextRequest) => postFilesMove(request),
  },
  {
    path: "/api/uploads/sessions/upload-1/complete",
    method: "POST",
    invoke: (request: NextRequest) =>
      postUploadsSessionsIdComplete(request, context),
  },
  {
    path: "/api/uploads/sessions",
    method: "POST",
    invoke: (request: NextRequest) => postUploadsSessions(request),
  },
  {
    path: "/api/user/preferences",
    method: "POST",
    invoke: (request: NextRequest) => postUserPreferences(request),
  },
];
const requestFor = (
  path: string,
  method: string,
  body: string,
  origin = "http://localhost:3000",
  accept = "application/json",
) =>
  new NextRequest(`http://localhost:3000${path}`, {
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
    it.each(["{", "", "null", "[]", '"string"', "123"])(
      `${route.method} ${route.path} rejects body %s without mutation`,
      async (body) => {
        const request = requestFor(route.path, route.method, body);
        const parse = vi.spyOn(request, "json");
        const response = await route.invoke(request);
        expect(parse).toHaveBeenCalledOnce();
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
      const parse = vi.spyOn(request, "json");
      const response = await route.invoke(request);
      expect(response.status).toBe(403);
      expect(parse).not.toHaveBeenCalled();
      expectNoMutation();
    });
  }
  it("missing share targets return a schema validation response", async () => {
    const response = await postShares(requestFor("/api/shares", "POST", "{}"));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_REQUEST");
    expectNoMutation();
  });
  it("malformed form callers redirect to a safe fallback with an error", async () => {
    const response = await postFilesFolders(
      requestFor(
        "/api/files/folders",
        "POST",
        "{",
        "http://localhost:3000",
        "text/html",
      ),
    );
    expect(response.status).toBe(303);
    const url = new URL(response.headers.get("location")!);
    expect(url.pathname).toBe("/files");
    expect(url.searchParams.get("error")).toBe("Invalid JSON body.");
    expectNoMutation();
  });
  it("an unrelated service SyntaxError remains a 500", async () => {
    mocks.signIn.mockRejectedValueOnce(
      new SyntaxError("Internal service failure"),
    );
    const response = await postAuthSignIn(
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
    const response = await postFilesFolders(
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
    const retry = await postFilesFolders(
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
