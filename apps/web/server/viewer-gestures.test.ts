import { describe, expect, it } from "vite-plus/test";

import { readSwipe } from "@/components/file-list/use-viewer-gestures";

describe("readSwipe", () => {
  it("reads swipes, pulls and taps", () => {
    expect(readSwipe(-120, 10, false)).toBe("next");
    expect(readSwipe(120, -10, false)).toBe("previous");
    expect(readSwipe(5, 160, false)).toBe("close");
    expect(readSwipe(3, 2, false)).toBe("tap");
    expect(readSwipe(30, 40, false)).toBe("none");
  });

  it("only looks around while zoomed in", () => {
    expect(readSwipe(-200, 0, true)).toBe("pan");
    expect(readSwipe(2, 1, true)).toBe("tap");
  });
});
