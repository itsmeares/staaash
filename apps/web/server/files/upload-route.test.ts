import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestSession = vi.fn();
const uploadFiles = vi.fn();
const pairUploadRequestItems = vi.fn();
const parseUploadManifest = vi.fn();
const readStorageIdempotencyKey = vi.fn();

vi.mock("@/server/auth/guards", () => ({
  getRequestSession,
}));

vi.mock("@/server/files/service", () => ({
  filesService: {
    uploadFiles,
  },
}));

vi.mock("@/server/retrieval/recent-tracking", () => ({
  recordFileAccessBestEffort: vi.fn(),
}));

vi.mock("@/server/uploads", () => ({
  pairUploadRequestItems,
  parseUploadManifest,
}));

vi.mock("@/server/storage-idempotency", () => ({
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

  return new NextRequest(url, {
    method: "POST",
    headers: {
      accept,
      host: "localhost:3000",
      origin: "http://localhost:3000",
    },
    body,
  });
};

describe("direct upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated multipart requests before reading the body", async () => {
    getRequestSession.mockResolvedValueOnce(null);
    const request = multipartRequest("application/json");
    const { POST } = await import("@/app/api/files/files/route");

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  it("keeps form callers on the safe sign-in redirect without reading the body", async () => {
    getRequestSession.mockResolvedValueOnce(null);
    const request = multipartRequest(
      "text/html",
      "http://localhost:3000/api/files/files?redirectTo=%2Fhome",
    );
    const { POST } = await import("@/app/api/files/files/route");

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/?next=%2Fhome",
    );
    expect(request.bodyUsed).toBe(false);
  });

  it("rejects cross-origin multipart requests before auth or body parsing", async () => {
    const request = multipartRequest("application/json");
    request.headers.set("origin", "https://evil.example");
    const { POST } = await import("@/app/api/files/files/route");

    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
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
    const { POST } = await import("@/app/api/files/files/route");

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(request.bodyUsed).toBe(true);
    expect(uploadFiles).toHaveBeenCalledWith({
      actorUserId: "user-1",
      actorRole: "member",
      folderId: null,
      items: ["upload-item"],
      idempotencyKey: "mutation-1",
    });
  });

  it("rejects oversized authenticated requests before parsing the body", async () => {
    getRequestSession.mockResolvedValueOnce({
      user: { id: "user-1", role: "member" },
    });
    const request = multipartRequest("application/json");
    request.headers.set("content-length", String(Number.MAX_SAFE_INTEGER));
    const { POST } = await import("@/app/api/files/files/route");

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
    expect(uploadFiles).not.toHaveBeenCalled();
  });
});
