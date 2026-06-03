import { describe, expect, it } from "vitest";

import {
  compareWorkspaceStrings,
  filterWorkspaceItems,
  formatWorkspaceFileSize,
  formatWorkspaceRelativeTime,
  getWorkspaceItemDownloadHref,
  getWorkspaceItemType,
  getWorkspaceLocationLabel,
  sortWorkspaceItems,
} from "@/app/(workspace)/workspace-item-helpers";

const item = (
  overrides: Partial<{
    id: string;
    kind: "file" | "folder";
    locationLabel: string;
    mimeType?: string;
    name: string;
    pathLabel: string;
    sizeBytes?: number;
  }> = {},
) => ({
  id: "file-1",
  kind: "file" as const,
  locationLabel: "Design",
  mimeType: "image/png",
  name: "hero.png",
  pathLabel: "Files / Design / hero.png",
  sizeBytes: 2400000,
  ...overrides,
});

describe("workspace item helpers", () => {
  it("builds compact location labels from retrieval path labels", () => {
    expect(getWorkspaceLocationLabel(item())).toBe("Design");
    expect(
      getWorkspaceLocationLabel(
        item({
          name: "Q1.pdf",
          pathLabel: "Files / Client / Reports / Q1.pdf",
        }),
      ),
    ).toBe("Client / Reports");
    expect(
      getWorkspaceLocationLabel(
        item({
          kind: "folder",
          name: "Design",
          pathLabel: "Files / Design",
        }),
      ),
    ).toBe("/");
  });

  it("maps file and folder MIME types to workspace filters", () => {
    expect(
      getWorkspaceItemType(item({ kind: "folder", mimeType: undefined })),
    ).toBe("folder");
    expect(getWorkspaceItemType(item({ mimeType: "image/png" }))).toBe("image");
    expect(getWorkspaceItemType(item({ mimeType: "video/mp4" }))).toBe("video");
    expect(getWorkspaceItemType(item({ mimeType: "audio/wav" }))).toBe("audio");
    expect(getWorkspaceItemType(item({ mimeType: "application/pdf" }))).toBe(
      "pdf",
    );
    expect(getWorkspaceItemType(item({ mimeType: "text/markdown" }))).toBe(
      "text",
    );
    expect(getWorkspaceItemType(item({ mimeType: "application/gzip" }))).toBe(
      "archive",
    );
    expect(
      getWorkspaceItemType(item({ mimeType: "application/octet-stream" })),
    ).toBe("all");
  });

  it("filters items by workspace type", () => {
    const items = [
      item({ id: "a", mimeType: "image/png" }),
      item({ id: "b", mimeType: "video/mp4" }),
      item({ id: "c", kind: "folder", mimeType: undefined }),
    ];

    expect(filterWorkspaceItems(items, "all").map((entry) => entry.id)).toEqual(
      ["a", "b", "c"],
    );
    expect(
      filterWorkspaceItems(items, "folder").map((entry) => entry.id),
    ).toEqual(["c"]);
  });

  it("formats file sizes and relative time labels", () => {
    const now = new Date("2026-05-19T12:00:00.000Z");

    expect(formatWorkspaceFileSize(undefined)).toBe("-");
    expect(formatWorkspaceFileSize(400)).toBe("400 B");
    expect(formatWorkspaceFileSize(4200)).toBe("4 KB");
    expect(formatWorkspaceFileSize(2_400_000)).toBe("2.3 MB");
    expect(formatWorkspaceFileSize(4_500_000_000)).toBe("4.2 GB");

    expect(formatWorkspaceRelativeTime("2026-05-19T12:00:00.000Z", now)).toBe(
      "Just now",
    );
    expect(formatWorkspaceRelativeTime("2026-05-19T11:55:00.000Z", now)).toBe(
      "5m ago",
    );
    expect(formatWorkspaceRelativeTime("2026-05-19T10:00:00.000Z", now)).toBe(
      "2h ago",
    );
    expect(formatWorkspaceRelativeTime("2026-05-18T10:00:00.000Z", now)).toBe(
      "Yesterday",
    );
  });

  it("sorts with workspace string and tie-break rules", () => {
    const items = [
      item({ id: "file-b", kind: "file", name: "Report 2" }),
      item({ id: "folder-a", kind: "folder", name: "Report 2" }),
      item({ id: "file-a", kind: "file", name: "Report 10" }),
    ];

    expect(compareWorkspaceStrings("Report 2", "Report 10")).toBeLessThan(0);
    expect(
      sortWorkspaceItems(
        items,
        "asc",
        (left, right) => compareWorkspaceStrings(left.name, right.name),
        { includeKindTieBreak: true },
      ).map((entry) => entry.id),
    ).toEqual(["file-b", "folder-a", "file-a"]);
    expect(
      sortWorkspaceItems(items, "desc", () => 0).map((entry) => entry.id),
    ).toEqual(["file-a", "folder-a", "file-b"]);
  });

  it("builds direct file download hrefs and leaves folders to archive flow", () => {
    expect(getWorkspaceItemDownloadHref({ id: "file-1", kind: "file" })).toBe(
      "/api/files/files/file-1/download",
    );
    expect(
      getWorkspaceItemDownloadHref({ id: "folder-1", kind: "folder" }),
    ).toBeNull();
  });
});
