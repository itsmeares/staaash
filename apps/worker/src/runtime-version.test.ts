import { afterEach, describe, expect, it } from "vitest";

import packageMetadata from "../package.json" with { type: "json" };

import { resolveWorkerVersion } from "./runtime-version.js";

const originalAppVersion = process.env.APP_VERSION;

afterEach(() => {
  if (originalAppVersion === undefined) {
    delete process.env.APP_VERSION;
  } else {
    process.env.APP_VERSION = originalAppVersion;
  }
});

describe("worker runtime version", () => {
  it("uses packaged metadata when no override is configured", () => {
    delete process.env.APP_VERSION;

    expect(resolveWorkerVersion()).toBe(packageMetadata.version);
  });

  it("uses a valid APP_VERSION override", () => {
    expect(resolveWorkerVersion("1.2.3-rc.4")).toBe("1.2.3-rc.4");
  });
});
