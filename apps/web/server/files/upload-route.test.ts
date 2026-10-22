import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { StorageTransactionUnavailableError } from "@staaash/db/storage-transactions";

const getRequestSession = vi.fn();
const uploadFiles = vi.fn();
const pairUploadRequestItems = vi.fn();
const parseUploadManifest = vi.fn();
const readStorageIdempotencyKey = vi.fn();

vi.mock("@/server/auth/guards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/guards")>()),
  getRequestSession,
}));

vi.mock("@/server/files/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/files/service")>()),
  filesService: {
    uploadFiles,
  },
}));

vi.mock("@/server/retrieval/recent-tracking", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/retrieval/recent-tracking")
  >()),
  recordFileAccessBestEffort: vi.fn(),
}));

vi.mock("@/server/uploads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/uploads")>()),
  pairUploadRequestItems,
  parseUploadManifest,
}));

vi.mock("@/server/storage-idempotency", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/storage-idempotency")>()),
  attachStorageMutationHeader: (response: Response) => response,
  readStorageIdempotencyKey,
}));

const multipartRequest = (
  accept: string,
  url = "http://localhost:3000/api/files/files",
) => {
  const body = new FormData();
  body.append("redirectTo", "/home");
  body.append(
    "manifest",
    JSON.stringify([{ clientKey: "client-1", originalName: "notes.txt" }]),
  );
  body.append(
    "files",
    new File(["hello"], "notes.txt", { type: "text/plain" }),
  );

  return new Request(url, {
    method: "POST",
    headers: {
      accept,
      host: "localhost:3000",
      origin: "http://localhost:3000",
    },
    body,
  });
};

const malformedMultipartRequest = () =>
  new Request("http://localhost:3000/api/files/files", {
    method: "POST",
    headers: {
      accept: "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "content-type": "multipart/form-data; boundary=missing-end",
    },
    body: "--missing-end\r\n",
  });

describe("direct upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated multipart requests before reading the body", async () => {
    getRequestSession.mockResolvedValueOnce(null);
    const request = multipartRequest("application/json");
    const { app } = await import("@/server/http/app");

    const response = await app.request(request);

    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  it("answers signed-out uploads with 401 without reading the body", async () => {
    getRequestSession.mockResolvedValueOnce(null);
    const request = multipartRequest("text/html");
    const { app } = await import("@/server/http/app");

    const response = await app.request(request);

    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });

  it("rejects cross-origin multipart requests before auth or body parsing", async () => {
    const request = multipartRequest("application/json");
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

  it("parses and delegates authenticated multipart uploads", async () => {
    getRequestSession.mockResolvedValueOnce({
      user: { id: "user-1", role: "member" },
    });
    readStorageIdempotencyKey.mockReturnValueOnce("mutation-1");
    parseUploadManifest.mockReturnValueOnce([
      { clientKey: "client-1", originalName: "notes.txt" },
    ]);
    pairUploadRequestItems.mockReturnValueOnce(["upload-item"]);
    uploadFiles.mockResolvedValueOnce({ uploadedFiles: [], conflicts: [] });
    const request = multipartRequest("application/json");
    const { app } = await import("@/server/http/app");

    const response = await app.request(request);

    expect(response.status).toBe(201);
    expect(request.bodyUsed).toBe(true);
    expect(uploadFiles).toHaveBeenCalledWith({
      actorUserId: "user-1",
      actorRole: "member",
      folderId: null,
      items: ["upload-item"],
      idempotencyKey: "mutation-1",
      signal: request.signal,
    });
  });

  it("rejects oversized authenticated requests before parsing the body", async () => {
    getRequestSession.mockResolvedValueOnce({
      user: { id: "user-1", role: "member" },
    });
    const request = multipartRequest("application/json");
    request.headers.set("content-length", String(Number.MAX_SAFE_INTEGER));
    const { app } = await import("@/server/http/app");

    const response = await app.request(request);

    expect(response.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  it("returns a classified unavailable response for an invalidated storage transaction", async () => {
    getRequestSession.mockResolvedValueOnce({
      user: { id: "user-1", role: "member" },
    });
    const error = new StorageTransactionUnavailableError(
      new Error(
        "Client has encountered a connection error and is not queryable",
      ),
    );
    uploadFiles.mockRejectedValueOnce(error);
    const { app } = await import("@/server/http/app");
    const response = await app.request(multipartRequest("application/json"));
    expect(response.status).toBe(503);
    expect(response.headers.has("Retry-After")).toBe(false);
    await expect(response.json()).resolves.toMatchObject({
      error: error.message,
      code: "STORAGE_TRANSACTION_UNAVAILABLE",
    });
    expect(uploadFiles).toHaveBeenCalledOnce();
  });

  it("returns a clear error for an incomplete multipart body", async () => {
    getRequestSession.mockResolvedValueOnce({
      user: { id: "user-1", role: "member" },
    });
    const request = malformedMultipartRequest();
    const { app } = await import("@/server/http/app");

    const response = await app.request(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "The upload request was incomplete or invalid.",
      code: "INVALID_MULTIPART_BODY",
    });
    expect(uploadFiles).not.toHaveBeenCalled();
  });
});
