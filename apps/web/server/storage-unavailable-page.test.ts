import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StorageEntityUnavailableError } from "@/server/storage-read-guard";
import { getRefreshDelay } from "@/app/(workspace)/files/storage-unavailable/storage-unavailable-view";

const mocks = vi.hoisted(() => ({
  getFilesListing: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/server/auth/guards", () => ({
  requireSignedInPageSession: vi.fn(async () => ({
    user: { id: "user-1", role: "member" },
  })),
}));

vi.mock("@/server/files/service", () => ({
  filesService: { getFilesListing: mocks.getFilesListing },
}));

const { default: StorageUnavailablePage } =
  await import("@/app/(workspace)/files/storage-unavailable/page");

describe("private storage unavailable page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("slows automatic checks as the wait gets longer", () => {
    expect(getRefreshDelay(0)).toBe(2_000);
    expect(getRefreshDelay(30_000)).toBe(10_000);
    expect(getRefreshDelay(5 * 60_000)).toBe(30_000);
  });

  it("renders a recoverable waiting screen for an active move", async () => {
    mocks.getFilesListing.mockRejectedValue(
      new StorageEntityUnavailableError({
        id: "mutation-1",
        kind: "folder_move",
        status: "running",
      }),
    );

    const page = await StorageUnavailablePage({
      searchParams: Promise.resolve({ folderId: "folder-1" }),
    });
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("Folder is getting ready.");
    expect(markup).toContain(">Refresh</button>");
    expect(markup).toContain("Back to Files");
    expect(markup).toContain("storage-unavailable-spinner");
  });

  it("stops the spinner when the move needs recovery", async () => {
    mocks.getFilesListing.mockRejectedValue(
      new StorageEntityUnavailableError({
        id: "mutation-1",
        kind: "folder_move",
        status: "recovery_required",
      }),
    );

    const page = await StorageUnavailablePage({
      searchParams: Promise.resolve({ folderId: "folder-1" }),
    });
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("This operation could not finish.");
    expect(markup).not.toContain("storage-unavailable-spinner");
  });

  it("returns to the requested folder after it becomes readable", async () => {
    mocks.getFilesListing.mockResolvedValue({
      currentFolder: { isFilesRoot: false },
    });

    await expect(
      StorageUnavailablePage({
        searchParams: Promise.resolve({ folderId: "folder-1" }),
      }),
    ).rejects.toThrow("redirect:/files/f/folder-1");
  });
});
