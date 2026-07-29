import { beforeEach, describe, expect, it, vi } from "vitest";

import { StorageEntityUnavailableError } from "@/server/storage-read-guard";

const mocks = vi.hoisted(() => ({
  getSharedNestedFileContent: vi.fn(),
  resolvePublicShare: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
  })),
}));

vi.mock("@/server/sharing/service", () => ({
  sharingService: {
    getSharedNestedFileContent: mocks.getSharedNestedFileContent,
    resolvePublicShare: mocks.resolvePublicShare,
  },
}));

const { GET } = await import("@/app/s/[token]/storage-unavailable/route");

describe("public storage-unavailable route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns explicit 503 HTML and the verified mutation ID", async () => {
    mocks.resolvePublicShare.mockRejectedValue(
      new StorageEntityUnavailableError({
        id: "mutation-1",
        kind: "folder_move",
        status: "retrying",
      }),
    );

    const response = await GET(
      new Request(
        "http://localhost/s/token/storage-unavailable?folderId=folder-1",
      ),
      { params: Promise.resolve({ token: "token" }) },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("x-storage-mutation-id")).toBe("mutation-1");
    await expect(response.text()).resolves.toContain(
      "Storage operation finishing",
    );
  });
});
