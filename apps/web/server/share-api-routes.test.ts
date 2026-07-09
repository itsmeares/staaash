import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredShareLink } from "@/server/sharing/types";

const mocks = vi.hoisted(() => ({
  createOrReissueShare: vi.fn(),
  getRequestSession: vi.fn(),
  getShareBaseUrl: vi.fn(),
  reissueShare: vi.fn(),
  revokeShare: vi.fn(),
  updateShare: vi.fn(),
  updateSharePassword: vi.fn(),
}));

vi.mock("@/server/auth/guards", () => ({
  getRequestSession: mocks.getRequestSession,
}));

vi.mock("@/server/request", () => ({
  getBaseUrl: vi.fn(() => "https://drive.example.com"),
  getShareBaseUrl: mocks.getShareBaseUrl,
}));

vi.mock("@/server/sharing/service", () => ({
  sharingService: {
    createOrReissueShare: mocks.createOrReissueShare,
    reissueShare: mocks.reissueShare,
    revokeShare: mocks.revokeShare,
    updateShare: mocks.updateShare,
    updateSharePassword: mocks.updateSharePassword,
  },
}));

import { POST as createShare } from "@/app/api/shares/route";
import { POST as updatePassword } from "@/app/api/shares/[shareId]/password/route";
import { POST as revokeShare } from "@/app/api/shares/[shareId]/revoke/route";
import { POST as updateShare } from "@/app/api/shares/[shareId]/update/route";

const futureExpiry = new Date("2026-08-01T12:00:00.000Z");

const makeShare = (
  overrides: Partial<StoredShareLink> = {},
): StoredShareLink => ({
  id: "share-1",
  createdByUserId: "user-1",
  targetType: "file",
  fileId: "file-1",
  folderId: null,
  tokenLookupKey: "lookup-key",
  tokenHash: "token-hash",
  passwordHash: "password-hash",
  downloadDisabled: false,
  expiresAt: futureExpiry,
  revokedAt: null,
  createdAt: new Date("2026-07-01T12:00:00.000Z"),
  updatedAt: new Date("2026-07-01T12:00:00.000Z"),
  ...overrides,
});

const jsonRequest = (path: string, body: Record<string, unknown>) =>
  new NextRequest(`https://drive.example.com${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      host: "drive.example.com",
      origin: "https://drive.example.com",
    },
    body: JSON.stringify(body),
  });

const expectSafeShare = async (
  response: Response,
  status: "active" | "revoked" = "active",
) => {
  const payload = (await response.json()) as {
    share: Record<string, unknown>;
  };

  expect(payload.share).toMatchObject({
    id: "share-1",
    hasPassword: true,
    expiresAt: futureExpiry.toISOString(),
    status,
  });
  expect(payload.share).not.toHaveProperty("tokenLookupKey");
  expect(payload.share).not.toHaveProperty("tokenHash");
  expect(payload.share).not.toHaveProperty("passwordHash");
  expect(payload).not.toHaveProperty("shareUrl");
  return payload.share;
};

describe("share mutation API responses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestSession.mockResolvedValue({
      user: { id: "user-1", role: "owner" },
    });
    mocks.getShareBaseUrl.mockReturnValue("https://drive.example.com");
  });

  it("returns a safe DTO when creating a share", async () => {
    mocks.createOrReissueShare.mockResolvedValue({
      share: makeShare(),
      shareUrl: "https://drive.example.com/s/token",
    });

    const response = await createShare(
      jsonRequest("/api/shares", { targetType: "file", fileId: "file-1" }),
    );

    expect(response.status).toBe(201);
    await expectSafeShare(response);
  });

  it("returns a safe DTO when reissuing a share", async () => {
    mocks.reissueShare.mockResolvedValue({
      share: makeShare(),
      shareUrl: "https://drive.example.com/s/reissued-token",
    });

    const response = await createShare(
      jsonRequest("/api/shares", { mode: "reissue", shareId: "share-1" }),
    );

    expect(response.status).toBe(200);
    await expectSafeShare(response);
  });

  it("returns a safe DTO when updating policy or password", async () => {
    mocks.updateShare.mockResolvedValue(makeShare());
    mocks.updateSharePassword.mockResolvedValue(makeShare());

    const policyResponse = await updateShare(
      jsonRequest("/api/shares/share-1/update", {
        expiresAt: futureExpiry.toISOString(),
        downloadDisabled: false,
      }),
      { params: Promise.resolve({ shareId: "share-1" }) },
    );
    const passwordResponse = await updatePassword(
      jsonRequest("/api/shares/share-1/password", { password: "new-password" }),
      { params: Promise.resolve({ shareId: "share-1" }) },
    );

    await expectSafeShare(policyResponse);
    await expectSafeShare(passwordResponse);
  });

  it("returns a safe DTO when revoking a share", async () => {
    mocks.revokeShare.mockResolvedValue(
      makeShare({ revokedAt: new Date("2026-07-09T12:00:00.000Z") }),
    );

    const response = await revokeShare(
      jsonRequest("/api/shares/share-1/revoke", {}),
      { params: Promise.resolve({ shareId: "share-1" }) },
    );

    await expectSafeShare(response, "revoked");
  });
});
