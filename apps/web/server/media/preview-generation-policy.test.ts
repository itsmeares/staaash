import { describe, expect, it } from "vitest";

import { shouldGenerateMediaPreview } from "./preview-generation-policy";

const settings = {
  mediaPreviewEnabled: true,
  mediaPreviewGenerateOnUpload: true,
  mediaPreviewGenerateOnFirstView: true,
  mediaPreviewGenerateOnShare: true,
};

describe("media preview generation policy", () => {
  it("requires the master capability and the matching trigger", () => {
    expect(shouldGenerateMediaPreview(settings, "upload")).toBe(true);
    expect(shouldGenerateMediaPreview(settings, "first-view")).toBe(true);
    expect(shouldGenerateMediaPreview(settings, "share")).toBe(true);
    expect(
      shouldGenerateMediaPreview(
        { ...settings, mediaPreviewEnabled: false },
        "first-view",
      ),
    ).toBe(false);
    expect(
      shouldGenerateMediaPreview(
        { ...settings, mediaPreviewGenerateOnShare: false },
        "share",
      ),
    ).toBe(false);
  });
});
