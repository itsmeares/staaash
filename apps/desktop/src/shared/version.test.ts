import { describe, expect, it } from "vite-plus/test";

import { newer, newestRelease, newerRelease, wantsCandidates } from "./version";

describe("newerRelease", () => {
  it("puts a release after its own candidates", () => {
    expect(newerRelease("2.0.0", "2.0.0-rc.8")).toBe(true);
    expect(newerRelease("2.0.0-rc.9", "2.0.0-rc.8")).toBe(true);
    expect(newerRelease("2.0.0-rc.10", "2.0.0-rc.9")).toBe(true);
    expect(newerRelease("2.0.0-rc.8", "2.0.0")).toBe(false);
    expect(newerRelease("2.0.0", "2.0.0")).toBe(false);
    expect(newerRelease("2.1.0-rc.1", "2.0.0")).toBe(true);
  });

  it("leaves newer as it was, so candidate apps still meet a server's minimum", () => {
    expect(newer("2.0.0", "2.0.0-rc.8")).toBe(false);
  });
});

describe("newestRelease", () => {
  const releases = [
    { tag_name: "v2.1.0-rc.1", draft: false, prerelease: true },
    { tag_name: "v2.2.0", draft: true, prerelease: false },
    { tag_name: "v2.0.1", draft: false, prerelease: false },
    { tag_name: "v2.0.0", draft: false, prerelease: false },
  ];

  it("skips candidates unless asked, and always skips drafts", () => {
    expect(newestRelease(releases, false)).toBe("2.0.1");
    expect(newestRelease(releases, true)).toBe("2.1.0-rc.1");
    expect(newestRelease([], true)).toBeNull();
  });
});

describe("wantsCandidates", () => {
  it("follows the installed version on Automatic", () => {
    expect(wantsCandidates("auto", "2.0.0-rc.9")).toBe(true);
    expect(wantsCandidates("auto", "2.0.0")).toBe(false);
    expect(wantsCandidates("rc", "2.0.0")).toBe(true);
    expect(wantsCandidates("stable", "2.1.0-rc.1")).toBe(false);
  });
});
