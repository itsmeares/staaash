import { describe, expect, it } from "vitest";

import { describeDevice } from "@/lib/user-agent";

describe("describeDevice", () => {
  it("names the browser and system", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
      ),
    ).toBe("Firefox on Linux");
    expect(
      describeDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iPhone");
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      ),
    ).toBe("Edge on Windows");
  });

  it("falls back when there is nothing to read", () => {
    expect(describeDevice(null)).toBe("Unknown browser");
  });
});
