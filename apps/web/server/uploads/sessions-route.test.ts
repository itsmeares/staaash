import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageTransactionUnavailableError } from "@staaash/db/storage-transactions";
import { UploadAdmissionError } from "./admission";

const mocks = vi.hoisted(() => ({
  getRequestSession: vi.fn(),
  createResumableSession: vi.fn(),
}));

vi.mock("@/server/auth/guards", () => ({
  getRequestSession: mocks.getRequestSession,
}));
vi.mock("@/server/durable-storage-mutation", () => ({
  assertStorageProtocolReady: vi.fn(),
  StorageProtocolNotReadyError: class extends Error {},
}));
vi.mock("@/server/uploads", () => ({
  assertUploadSizeAllowed: vi.fn(),
  UploadError: class extends Error {},
}));
vi.mock("@/server/uploads/session-service", () => ({
  createResumableSession: mocks.createResumableSession,
}));

import { POST } from "@/app/api/uploads/sessions/route";

const request = () =>
  new NextRequest("http://localhost:3000/api/uploads/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      originalName: "file.txt",
      mimeType: "text/plain",
      totalSizeBytes: 4,
    }),
  });

describe("resumable session admission responses", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getRequestSession.mockResolvedValue({
      user: { id: "owner-1", role: "member" },
    });
  });

  it("supplies retry timing for busy admission and preserves its details", async () => {
    const error = new UploadAdmissionError("UPLOAD_ADMISSION_BUSY", {
      activeSessions: 2,
    });
    mocks.createResumableSession.mockRejectedValue(error);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      error: error.message,
      code: error.code,
      details: error.details,
    });
    expect(mocks.createResumableSession).toHaveBeenCalledOnce();
  });

  it("returns transaction unavailability without promising a safe retry", async () => {
    const error = new StorageTransactionUnavailableError(
      new Error(
        "Client has encountered a connection error and is not queryable",
      ),
    );
    mocks.createResumableSession.mockRejectedValue(error);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.has("Retry-After")).toBe(false);
    await expect(response.json()).resolves.toEqual({
      error: error.message,
      code: error.code,
    });
    expect(mocks.createResumableSession).toHaveBeenCalledOnce();
  });

  it("keeps non-busy admission failures and their details without a retry header", async () => {
    const error = new UploadAdmissionError("USER_STORAGE_QUOTA_EXCEEDED", {
      requestedBytes: 4,
    });
    mocks.createResumableSession.mockRejectedValue(error);
    const response = await POST(request());
    expect(response.status).toBe(413);
    expect(response.headers.has("Retry-After")).toBe(false);
    await expect(response.json()).resolves.toEqual({
      error: error.message,
      code: error.code,
      details: error.details,
    });
  });

  it("does not convert an unrelated error into transaction unavailability", async () => {
    const error = new Error("Invalid upload reservation");
    mocks.createResumableSession.mockRejectedValue(error);
    await expect(POST(request())).rejects.toBe(error);
  });
});
