import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const getRequestSession = vi.fn();
const ensureFolderPaths = vi.fn();
const readStorageIdempotencyKey = vi.fn();

vi.mock("@/server/auth/guards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/guards")>()),
  getRequestSession,
}));

vi.mock("@/server/files/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/files/service")>()),
  filesService: {
    ensureFolderPaths,
  },
}));

vi.mock("@/server/retrieval/recent-tracking", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/retrieval/recent-tracking")
  >()),
  recordFolderAccessBestEffort: vi.fn(),
}));

vi.mock("@/server/storage-idempotency", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/storage-idempotency")>()),
  attachStorageMutationHeader: (response: Response) => response,
  readStorageIdempotencyKey,
}));

const jsonRequest = (
  body: unknown,
  url = "http://localhost:3000/api/files/folders/ensure",
) =>
  new Request(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });

describe("ensure folder paths route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests before reading the body", async () => {
    getRequestSession.mockResolvedValueOnce(null);
    const request = jsonRequest({ folderId: "root", paths: ["Project"] });
    const { app } = await import("@/server/http/app");

    const response = await app.request(request);

    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(ensureFolderPaths).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before auth or body parsing", async () => {
    const request = jsonRequest({ folderId: "root", paths: ["Project"] });
    request.headers.set("origin", "https://evil.example");
    const { app } = await import("@/server/http/app");

    const response = await app.request(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Cross-origin requests are not allowed.",
    });
    expect(getRequestSession).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
  });

  it("validates the path request before calling the service", async () => {
    getRequestSession.mockResolvedValueOnce({
      user: { id: "user-1", role: "member" },
    });
    const request = jsonRequest({ folderId: "root", paths: [] });
    const { app } = await import("@/server/http/app");

    const response = await app.request(request);

    expect(response.status).toBe(400);
    expect(ensureFolderPaths).not.toHaveBeenCalled();
  });

  it("delegates an authenticated request with its idempotency key", async () => {
    getRequestSession.mockResolvedValueOnce({
      user: { id: "user-1", role: "member" },
    });
    readStorageIdempotencyKey.mockReturnValueOnce("mutation-1");
    ensureFolderPaths.mockResolvedValueOnce({
      folders: [{ path: "Project/src", folderId: "folder-2" }],
    });
    const request = jsonRequest({
      folderId: "root",
      paths: ["Project/src"],
    });
    const { app } = await import("@/server/http/app");

    const response = await app.request(request);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      folders: [{ path: "Project/src", folderId: "folder-2" }],
    });
    expect(ensureFolderPaths).toHaveBeenCalledWith({
      actorUserId: "user-1",
      actorRole: "member",
      parentId: "root",
      paths: ["Project/src"],
      idempotencyKey: "mutation-1",
    });
  });
});
