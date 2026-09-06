import { beforeEach, describe, expect, it, vi } from "vitest";

import { StorageEntityUnavailableError } from "@/server/storage-read-guard";

const mocks = vi.hoisted(() => ({
  getFilesListing: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

vi.mock("@/server/auth/guards", () => ({
  requireSignedInPageSession: vi.fn(async () => ({
    user: { id: "user-1", role: "member" },
  })),
}));

vi.mock("@/server/files/service", () => ({
  filesService: { getFilesListing: mocks.getFilesListing },
}));

vi.mock("@/server/retrieval/recent-tracking", () => ({
  recordFolderAccessBestEffort: vi.fn(),
}));

vi.mock("@/server/retrieval/service", () => ({
  retrievalService: { listFavorites: vi.fn() },
}));

vi.mock("@/server/request", () => ({
  getShareBaseUrl: vi.fn(() => "http://localhost"),
}));

vi.mock("@/server/sharing/service", () => ({
  sharingService: { getFilesShareLookup: vi.fn() },
}));

vi.mock("@/app/(workspace)/files/files-explorer", () => ({
  FilesExplorer: () => null,
}));

const { default: FilesFolderPage } =
  await import("@/app/(workspace)/files/f/[folderId]/page");

describe("private files folder page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends an unreadable folder to the recoverable waiting page", async () => {
    mocks.getFilesListing.mockRejectedValue(
      new StorageEntityUnavailableError({
        id: "mutation-1",
        kind: "folder_move",
        status: "running",
      }),
    );

    await expect(
      FilesFolderPage({
        params: Promise.resolve({ folderId: "folder-1" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("redirect:/files/storage-unavailable?folderId=folder-1");
  });
});
