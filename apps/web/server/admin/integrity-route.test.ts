import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const requireOwnerApiSession = vi.fn();
const enforceSameOrigin = vi.fn();
const getAdminIntegritySummary = vi.fn();
const toJsonAdminIntegritySummary = vi.fn();
const enqueueAdminRestoreReconciliation = vi.fn();

vi.mock("@/server/admin/http", () => ({
  requireOwnerApiSession,
  enforceSameOrigin,
}));

vi.mock("@/server/admin/integrity", () => ({
  getAdminIntegritySummary,
  toJsonAdminIntegritySummary,
  enqueueAdminRestoreReconciliation,
}));

describe("admin integrity route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns serialized integrity data for owners", async () => {
    const { GET } = await import("@/app/api/admin/integrity/route");
    requireOwnerApiSession.mockResolvedValueOnce({
      ok: true,
      session: {
        user: {
          id: "owner-1",
          role: "owner",
        },
      },
    });
    getAdminIntegritySummary.mockResolvedValueOnce({
      health: {
        status: "healthy",
      },
    });
    toJsonAdminIntegritySummary.mockReturnValueOnce({
      health: {
        status: "healthy",
      },
    });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/integrity"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      health: {
        status: "healthy",
      },
    });
  });

  it("rejects cross-origin POST requests before auth", async () => {
    const { POST } = await import("@/app/api/admin/integrity/route");
    enforceSameOrigin.mockReturnValueOnce(
      NextResponse.json(
        { error: "Cross-origin requests are not allowed." },
        { status: 403 },
      ),
    );

    const response = await POST(
      new NextRequest("http://localhost/api/admin/integrity", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(requireOwnerApiSession).not.toHaveBeenCalled();
  });

  it("queues reconciliation for owners and reports dedupe", async () => {
    const { POST } = await import("@/app/api/admin/integrity/route");
    enforceSameOrigin.mockReturnValueOnce(null).mockReturnValueOnce(null);
    requireOwnerApiSession
      .mockResolvedValueOnce({
        ok: true,
        session: {
          user: {
            id: "owner-1",
            role: "owner",
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        session: {
          user: {
            id: "owner-1",
            role: "owner",
          },
        },
      });
    enqueueAdminRestoreReconciliation
      .mockResolvedValueOnce({
        created: true,
        job: {
          id: "job-1",
        },
        run: {
          id: "run-1",
        },
      })
      .mockResolvedValueOnce({
        created: false,
        job: {
          id: "job-1",
        },
        run: {
          id: "run-1",
        },
      });

    const createdResponse = await POST(
      new NextRequest("http://localhost/api/admin/integrity", {
        method: "POST",
      }),
    );
    await expect(createdResponse.json()).resolves.toEqual({
      message: "Restore reconciliation queued.",
      jobId: "job-1",
      runId: "run-1",
    });

    const dedupedResponse = await POST(
      new NextRequest("http://localhost/api/admin/integrity", {
        method: "POST",
      }),
    );
    await expect(dedupedResponse.json()).resolves.toEqual({
      message: "An active restore reconciliation is already queued or running.",
      jobId: "job-1",
      runId: "run-1",
    });
  });
});
