import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFile: vi.fn(),
  findDerivative: vi.fn(),
  getRequestSession: vi.fn(),
  getSystemSettings: vi.fn(),
  scheduleDerivativeGenerate: vi.fn(),
}));

vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({
    file: { findFirst: mocks.findFile },
    mediaDerivative: { findFirst: mocks.findDerivative },
  }),
}));

vi.mock("@staaash/db/media-derivatives", () => ({
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
    mocks.scheduleDerivativeGenerate.mockResolvedValueOnce({ id: "job-1" });

    const response = await POST(sameOriginPost(), routeContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "queued" });
    expect(mocks.scheduleDerivativeGenerate).toHaveBeenCalledWith({
      fileId: "file-1",
      reason: "manual-regenerate",
    });
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
