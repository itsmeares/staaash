import { describe, expect, it } from "vitest";

import {
  compareSemanticVersions,
  findReleaseVersionMismatches,
  formatVersionLabel,
  isPrereleaseVersion,
  normalizeSemanticVersion,
  resolveRuntimeVersion,
} from "../src/version.js";

describe("version helpers", () => {
  it("normalizes valid versions and rejects moving aliases", () => {
    expect(normalizeSemanticVersion("v1.0.0-rc.4")).toBe("1.0.0-rc.4");
    expect(normalizeSemanticVersion("latest")).toBeNull();
    expect(normalizeSemanticVersion("main")).toBeNull();
    expect(normalizeSemanticVersion("1.0")).toBeNull();
    expect(normalizeSemanticVersion("1.0.0-rc.04")).toBeNull();
  });

  it("formats one leading v", () => {
    expect(formatVersionLabel("1.0.0-rc.4")).toBe("v1.0.0-rc.4");
    expect(formatVersionLabel("v1.0.0-rc.4")).toBe("v1.0.0-rc.4");
    expect(formatVersionLabel("development")).toBe("development");
  });

  it("orders stable and prerelease versions using SemVer rules", () => {
    expect(compareSemanticVersions("1.0.0-rc.3", "1.0.0-rc.4")).toBe(-1);
    expect(compareSemanticVersions("1.0.0-rc.10", "1.0.0-rc.4")).toBe(1);
    expect(compareSemanticVersions("1.0.0-rc.4", "1.0.0")).toBe(-1);
    expect(compareSemanticVersions("1.0.0", "1.0.1-alpha.1")).toBe(-1);
    expect(isPrereleaseVersion("v1.0.0-rc.4")).toBe(true);
    expect(isPrereleaseVersion("v1.0.0")).toBe(false);
  });

  it("uses only valid APP_VERSION overrides", () => {
    expect(
      resolveRuntimeVersion({
        packageVersion: "1.0.0-rc.4",
        appVersion: "2.0.0",
      }),
    ).toBe("2.0.0");
    expect(
      resolveRuntimeVersion({
        packageVersion: "1.0.0-rc.4",
        appVersion: "latest",
      }),
    ).toBe("1.0.0-rc.4");
  });

  it("reports release tag and package version drift", () => {
    expect(
      findReleaseVersionMismatches({
        tag: "v1.0.0-rc.4",
        packageVersions: {
          root: "1.0.0-rc.4",
          web: "1.0.0-rc.3",
        },
      }),
    ).toEqual(["web has 1.0.0-rc.3; expected 1.0.0-rc.4"]);
  });
});
