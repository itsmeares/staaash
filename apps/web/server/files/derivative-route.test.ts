import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFile: vi.fn(),
  findDerivative: vi.fn(),
  findJob: vi.fn(),
  transaction: vi.fn(),
  getRequestSession: vi.fn(),
  getSystemSettings: vi.fn(),
  scheduleDerivativeGenerate: vi.fn(),
}));

vi.mock("@staaash/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@staaash/db/client")>()),
  getPrisma: () => ({
    file: { findFirst: mocks.findFile },
    mediaDerivative: { findUnique: mocks.findDerivative },
    backgroundJob: { findFirst: mocks.findJob },
    $transaction: mocks.transaction,
  }),
}));

vi.mock("@staaash/db/media-derivatives", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@staaash/db/media-derivatives")>()),
  scheduleDerivativeGenerate: mocks.scheduleDerivativeGenerate,
}));

vi.mock("@/server/auth/guards", () => ({
  getRequestSession: mocks.getRequestSession,
}));

vi.mock("@/server/settings", () => ({
  getSystemSettings: mocks.getSystemSettings,
}));

import { GET, POST } from "@/app/api/files/files/[fileId]/derivative/route";

const routeContext = (fileId = "file-1") => ({
  params: Promise.resolve({ fileId }),
});

const sameOriginPost = () =>
  new NextRequest("http://localhost:3000/api/files/files/file-1/derivative", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
    },
  });

const setFile = (ownerUserId = "member-1", mimeType = "video/mp4") => {
  mocks.findFile.mockResolvedValueOnce({ ownerUserId, mimeType });
};

const setSession = (id: string, role: "owner" | "member") => {
  mocks.getRequestSession.mockResolvedValueOnce({
    user: { id, role },
  });
};

describe("private media derivative routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findJob.mockResolvedValue(null);
    mocks.findDerivative.mockResolvedValue(null);
    mocks.transaction.mockImplementation((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    );
    mocks.getSystemSettings.mockResolvedValue({ mediaPreviewEnabled: true });
  });

  it("lets the file owner read derivative status", async () => {
    setSession("member-1", "member");
    setFile("member-1");
    mocks.findDerivative.mockResolvedValueOnce({
      status: "ready",
      generatedAt: new Date("2026-09-08T12:00:00.000Z"),
    });

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/files/files/file-1/derivative",
      ),
      routeContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      generatedAt: "2026-09-08T12:00:00.000Z",
    });
  });

  it("denies owners access to member derivative status", async () => {
    setSession("owner-1", "owner");
    setFile("member-1");

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/files/files/file-1/derivative",
      ),
      routeContext(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "File not found.",
    });
    expect(mocks.findDerivative).not.toHaveBeenCalled();
  });

  it("lets the file owner queue video regeneration", async () => {
    setSession("member-1", "member");
    setFile("member-1");
    mocks.scheduleDerivativeGenerate.mockResolvedValueOnce({
      created: true,
      job: { id: "job-1", status: "queued" },
    });

    const response = await POST(sameOriginPost(), routeContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "queued",
      generatedAt: null,
    });
    expect(mocks.scheduleDerivativeGenerate).toHaveBeenCalledWith({
      fileId: "file-1",
      reason: "manual-regenerate",
    });
  });

  it("reads the exact preview profile and matching job in a consistent snapshot", async () => {
    setSession("member-1", "member");
    setFile();
    const response = await GET(sameOriginPost(), routeContext());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "none",
      generatedAt: null,
    });
    expect(mocks.findDerivative).toHaveBeenCalledWith({
      where: {
        fileId_kind_profile: {
          fileId: "file-1",
          kind: "preview",
          profile: "preview-1080p",
        },
      },
      select: { status: true, generatedAt: true, generationJobId: true },
    });
    expect(mocks.findJob).toHaveBeenCalledWith({
      where: {
        kind: "media.derivative.generate",
        dedupeKey: "media.derivative.generate:file-1:preview:preview-1080p",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true },
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Array), {
      isolationLevel: "RepeatableRead",
    });
  });

  it.each([
    ["queued", null, null, "queued"],
    ["queued", "ready", "old-job", "queued"],
    ["queued", "failed", "job-1", "queued"],
    ["running", null, null, "processing"],
    ["running", "ready", "old-job", "processing"],
    ["running", "processing", "job-1", "processing"],
    ["running", "ready", "job-1", "ready"],
    ["failed", null, null, "failed"],
    ["dead", "ready", "old-job", "failed"],
    ["cancelled", null, null, "none"],
    ["cancelled", "ready", "old-job", "ready"],
    ["cancelled", "processing", "job-1", "stale"],
    ["cancelled", "stale", "job-1", "stale"],
    ["succeeded", null, null, "none"],
    ["succeeded", "ready", "job-1", "ready"],
  ])(
    "reports %s job with %s derivative owned by %s as %s",
    async (jobStatus, derivativeStatus, generationJobId, expectedStatus) => {
      setSession("member-1", "member");
      setFile();
      mocks.findJob.mockResolvedValueOnce({ id: "job-1", status: jobStatus });
      if (derivativeStatus)
        mocks.findDerivative.mockResolvedValueOnce({
          status: derivativeStatus,
          generationJobId,
          generatedAt: null,
        });
      const response = await GET(sameOriginPost(), routeContext());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: expectedStatus,
        generatedAt: null,
      });
    },
  );

  it("reports a reused running job as processing", async () => {
    setSession("member-1", "member");
    setFile();
    mocks.scheduleDerivativeGenerate.mockResolvedValueOnce({
      created: false,
      job: { id: "job-1", status: "running" },
    });
    const response = await POST(sameOriginPost(), routeContext());
    await expect(response.json()).resolves.toEqual({
      status: "processing",
      generatedAt: null,
    });
  });

  it("returns a safe unavailable response when status queries fail", async () => {
    setSession("member-1", "member");
    setFile();
    mocks.findDerivative.mockRejectedValueOnce(
      new Error("private database details"),
    );
    const response = await GET(sameOriginPost(), routeContext());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Preview status unavailable.",
    });
  });

  it("returns a safe error when queueing fails", async () => {
    setSession("member-1", "member");
    setFile();
    mocks.scheduleDerivativeGenerate.mockRejectedValueOnce(
      new Error("private database details"),
    );
    const response = await POST(sameOriginPost(), routeContext());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to queue preview.",
    });
  });

  it.each([GET, POST])(
    "rejects anonymous access before reading preview metadata",
    async (handler) => {
      mocks.getRequestSession.mockResolvedValueOnce(null);
      const response = await handler(sameOriginPost(), routeContext());
      expect(response.status).toBe(401);
      expect(mocks.findFile).not.toHaveBeenCalled();
      expect(mocks.findJob).not.toHaveBeenCalled();
      expect(mocks.scheduleDerivativeGenerate).not.toHaveBeenCalled();
    },
  );

  it.each([GET, POST])(
    "returns 404 for a missing file without reading generation metadata",
    async (handler) => {
      setSession("member-1", "member");
      mocks.findFile.mockResolvedValueOnce(null);
      const response = await handler(sameOriginPost(), routeContext());
      expect(response.status).toBe(404);
      expect(mocks.findJob).not.toHaveBeenCalled();
      expect(mocks.scheduleDerivativeGenerate).not.toHaveBeenCalled();
    },
  );

  it.each([GET, POST])(
    "returns a safe 503 when file authorization cannot query storage",
    async (handler) => {
      setSession("member-1", "member");
      mocks.findFile.mockRejectedValueOnce(
        new Error("private connection details"),
      );
      const response = await handler(sameOriginPost(), routeContext());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("private");
    },
  );

  it("rejects cross-origin generation before authentication", async () => {
    const response = await POST(
      new NextRequest(
        "http://localhost:3000/api/files/files/file-1/derivative",
        {
          method: "POST",
          headers: { host: "localhost:3000", origin: "https://other.example" },
        },
      ),
      routeContext(),
    );
    expect(response.status).toBe(403);
    expect(mocks.getRequestSession).not.toHaveBeenCalled();
    expect(mocks.scheduleDerivativeGenerate).not.toHaveBeenCalled();
  });

  it("rejects generation for non-video files", async () => {
    setSession("member-1", "member");
    setFile("member-1", "image/png");
    const response = await POST(sameOriginPost(), routeContext());
    expect(response.status).toBe(400);
    expect(mocks.scheduleDerivativeGenerate).not.toHaveBeenCalled();
  });

  it("denies owners from queueing regeneration for member videos", async () => {
    setSession("owner-1", "owner");
    setFile("member-1");

    const response = await POST(sameOriginPost(), routeContext());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "File not found.",
    });
    expect(mocks.scheduleDerivativeGenerate).not.toHaveBeenCalled();
  });

  it("does not queue manual regeneration when previews are disabled", async () => {
    setSession("member-1", "member");
    setFile("member-1");
    mocks.getSystemSettings.mockResolvedValueOnce({
      mediaPreviewEnabled: false,
    });

    const response = await POST(sameOriginPost(), routeContext());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Media previews are disabled.",
    });
    expect(mocks.scheduleDerivativeGenerate).not.toHaveBeenCalled();
  });
});
