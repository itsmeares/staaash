import { describe, expect, it } from "vitest";

import { deriveUpdateState } from "@/server/admin/updates";
import { getUpdateStatusLabel } from "@/lib/update-status";

const release = (version: string, notes = `Notes for ${version}`) => ({
  version,
  name: null,
  notes,
  publishedAt: null,
  url: null,
});

const settings = {
  updateCheckEnabled: true,
  updateChannel: null,
  updateCheckRepository: "itsmeares/staaash",
};

const checked = (
  releases: ReturnType<typeof release>[],
  error: string | null = null,
) => ({
  lastUpdateCheckAt: new Date("2026-10-10T12:00:00Z"),
  updateCheckError: error,
  updateReleases: releases,
});

describe("deriveUpdateState", () => {
  it("lists every release newer than the running version", () => {
    const state = deriveUpdateState({
      currentVersion: "1.2.0",
      instance: checked([release("1.3.1"), release("1.3.0"), release("1.2.0")]),
      settings,
    });
    expect(state.status).toBe("update-available");
    expect(state.missed.map((entry) => entry.version)).toEqual([
      "1.3.1",
      "1.3.0",
    ]);
    expect(state.kind).toBe("minor");
    expect(getUpdateStatusLabel(state)).toBe("v1.3.1 is out");
  });

  it("is up to date straight after an upgrade, with the stored check unchanged", () => {
    // The same stored releases, read by the new version after the upgrade.
    const state = deriveUpdateState({
      currentVersion: "1.3.1",
      instance: checked([release("1.3.1"), release("1.3.0")]),
      settings,
    });
    expect(state.status).toBe("up-to-date");
    expect(state.missed).toEqual([]);
  });

  it("names the release size so patches can be quiet", () => {
    const patch = deriveUpdateState({
      currentVersion: "1.2.0",
      instance: checked([release("1.2.1")]),
      settings,
    });
    const major = deriveUpdateState({
      currentVersion: "1.2.0",
      instance: checked([release("2.0.0")]),
      settings,
    });
    expect(patch.kind).toBe("patch");
    expect(major.kind).toBe("major");
  });

  it("follows release candidates on a pre-release and hides them on stable", () => {
    const releases = [release("1.3.0-rc.1"), release("1.2.0")];
    const onRc = deriveUpdateState({
      currentVersion: "1.2.0-rc.4",
      instance: checked(releases),
      settings,
    });
    const onStable = deriveUpdateState({
      currentVersion: "1.2.0",
      instance: checked(releases),
      settings: { ...settings, updateChannel: "stable" },
    });
    expect(onRc.channel).toBe("rc");
    expect(onRc.channelChosen).toBe(false);
    expect(onRc.kind).toBe("prerelease");
    expect(onStable.status).toBe("up-to-date");
    expect(onStable.channelChosen).toBe(true);
  });

  it("reports off, never checked and a failed first check", () => {
    const off = deriveUpdateState({
      currentVersion: "1.2.0",
      instance: checked([release("1.3.0")]),
      settings: { ...settings, updateCheckEnabled: false },
    });
    const never = deriveUpdateState({
      currentVersion: "1.2.0",
      instance: {
        lastUpdateCheckAt: null,
        updateCheckError: null,
        updateReleases: [],
      },
      settings,
    });
    const failed = deriveUpdateState({
      currentVersion: "1.2.0",
      instance: checked([], "GitHub answered 503."),
      settings,
    });
    expect(off.status).toBe("off");
    expect(never.status).toBe("unchecked");
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("GitHub answered 503.");
  });

  it("keeps showing an update when a later check fails", () => {
    const state = deriveUpdateState({
      currentVersion: "1.2.0",
      instance: checked([release("1.3.0")], "GitHub answered 503."),
      settings,
    });
    expect(state.status).toBe("update-available");
  });
});
