import { describe, expect, it } from "vite-plus/test";
import { getItemVisual } from "@staaash/ui/item-visuals";
import { filterWorkspaceItems } from "@/src/workspace/workspace-item-helpers";
import { batchLabel } from "@/src/workspace/recent/recent-helpers";

describe("file type presentation", () => {
  it.each([
    ["photo.HEIC", "application/octet-stream", "image"],
    ["photo.heif", "", "image"],
    ["photo.bin", " IMAGE/HEIC; charset=binary ", "image"],
    ["photo.heic", "application/pdf", "pdf"],
    ["notes.txt", "application/octet-stream", "file"],
  ] as const)(
    "uses the same icon and filter for %s",
    (name, mimeType, kind) => {
      expect(getItemVisual("file", mimeType, name).kind).toBe(kind);
      const item = { kind: "file" as const, mimeType, name };
      expect(filterWorkspaceItems([item], "image")).toEqual(
        kind === "image" ? [item] : [],
      );
      if (kind === "pdf")
        expect(filterWorkspaceItems([item], "pdf")).toEqual([item]);
    },
  );

  it("calls a group of legacy HEIC uploads photos", () => {
    expect(
      batchLabel({
        id: "photo-1",
        kind: "file",
        name: "photo.HEIC",
        mimeType: "application/octet-stream",
        locationLabel: "Photos",
        at: "2026-11-01T12:00:00Z",
        href: "/files",
        isFavorite: false,
        deletedAt: null,
        batchSize: 4,
      }),
    ).toBe("Uploaded 4 photos to Photos");
  });
});
