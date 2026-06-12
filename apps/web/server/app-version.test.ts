import { describe, expect, it } from "vitest";

import { version as packageVersion } from "../package.json";

import { resolveAppVersion } from "./app-version";

describe("resolveAppVersion", () => {
  it("prefers the explicit Staaash version override", () => {
    expect(resolveAppVersion("1.2.3", "2.0.0")).toBe("1.2.3");
  });

  it("uses the app version override when the Staaash version is unset", () => {
    expect(resolveAppVersion(undefined, "2.0.0")).toBe("2.0.0");
  });

  it("falls back to the package version", () => {
    expect(resolveAppVersion(undefined, undefined)).toBe(packageVersion);
  });
});
