import { describe, expect, it } from "vitest";

import {
  canBrowseSharedFolder,
  getFolderArchiveDownloadAllowed,
  getSharedDownloadAllowed,
  getSharedPreviewAllowed,
  getSharedTreeExposureMode,
  getSharingBoundary,
} from "@/server/sharing";

describe("folder public link behavior", () => {
  it("allows traversal across the full linked subtree", () => {
    expect(
      canBrowseSharedFolder({
        rootFolderId: "root",
        requestedFolderId: "child",
        subtreeFolderIds: ["child", "grandchild"],
      }),
    ).toBe(true);
  });

  it("disables file and archive downloads when the policy disables downloads", () => {
    expect(getSharedDownloadAllowed({ downloadDisabled: true })).toBe(false);
    expect(getFolderArchiveDownloadAllowed({ downloadDisabled: true })).toBe(
      false,
    );
  });

  it("allows previews even when downloads are disabled", () => {
    expect(getSharedPreviewAllowed({ downloadDisabled: true })).toBe(true);
  });

  it("exposes the full subtree with no hidden child filtering", () => {
    expect(getSharedTreeExposureMode()).toBe("full-subtree");
    expect(getSharingBoundary()).toEqual({
      recipientsCanReshare: false,
      hiddenChildFiltering: false,
    });
  });
});
