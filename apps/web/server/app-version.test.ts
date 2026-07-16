import { describe, expect, it } from "vitest";

import { version as packageVersion } from "../package.json";

import { resolveAppVersion } from "./app-version";

describe("resolveAppVersion", () => {
  it("uses a valid app version override", () => {
    expect(resolveAppVersion("2.0.0")).toBe("2.0.0");
  });

  it("ignores moving tag aliases", () => {
    expect(resolveAppVersion("latest")).toBe(packageVersion);
  });

  it("falls back to packaged version", () => {
    expect(resolveAppVersion(undefined)).toBe(packageVersion);
  });
});
