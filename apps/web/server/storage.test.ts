import { describe, expect, it } from "vitest";

import {
  buildStoredFileRef,
  getOriginalStorageKey,
  getPreviewStorageKey,
} from "@/server/storage";

describe("storage layout", () => {
  it("stores originals by immutable owner and file ID", () => {
    expect(getOriginalStorageKey("user-1", "file-1")).toBe(
      "originals/user-1/file-1/source",
    );
  });

  it("stores previews under an immutable preview path", () => {
    expect(getPreviewStorageKey("user-1", "file-1", "image")).toBe(
      "previews/user-1/file-1/image.preview",
    );
  });

  it("builds stored file refs that are independent from logical folder path changes", () => {
    expect(buildStoredFileRef("user-1", "file-1")).toEqual({
      ownerUserId: "user-1",
      fileId: "file-1",
      storageKey: "originals/user-1/file-1/source",
    });
  });
});
