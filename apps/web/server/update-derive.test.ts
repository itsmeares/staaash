import { describe, expect, it } from "vitest";

import type { UpdateCheckStatus } from "@staaash/db/instance";

import { deriveEffectiveUpdateStatus } from "@/server/update-derive";

const persisted = (
  updateCheckStatus: UpdateCheckStatus | null,
  checkedVersion: string | null,
) => ({
  updateCheckStatus,
  updateCheckMessage: `Persisted ${updateCheckStatus ?? "unchecked"}.`,
  latestAvailableVersion: "2.0.0",
  checkedVersion,
});

describe("deriveEffectiveUpdateStatus", () => {
  it.each([
    ["update-available", "1.0.0", "2.0.0"],
    ["up-to-date", "2.0.0", "1.0.0"],
    ["unavailable", "1.0.0", "2.0.0"],
    ["error", "1.0.0", "2.0.0"],
  ] as const)(
    "invalidates %s state checked by %s when running %s",
    (status, checkedVersion, currentVersion) => {
      expect(
        deriveEffectiveUpdateStatus({
          currentVersion,
          persisted: persisted(status, checkedVersion),
        }),
      ).toEqual({
        updateCheckStatus: null,
        updateCheckMessage: `Update check was run against v${checkedVersion}; re-run to refresh.`,
        latestAvailableVersion: null,
      });
    },
  );

  it("preserves state checked by the running version", () => {
    expect(
      deriveEffectiveUpdateStatus({
        currentVersion: "2.0.0",
        persisted: persisted("update-available", "v2.0.0"),
      }),
    ).toEqual({
      updateCheckStatus: "update-available",
      updateCheckMessage: "Persisted update-available.",
      latestAvailableVersion: "2.0.0",
    });
  });

  it("preserves version-independent state without a checked version", () => {
    expect(
      deriveEffectiveUpdateStatus({
        currentVersion: "2.0.0",
        persisted: {
          ...persisted("unavailable", null),
          updateCheckMessage: "Update checks are not configured.",
          latestAvailableVersion: null,
        },
      }),
    ).toEqual({
      updateCheckStatus: "unavailable",
      updateCheckMessage: "Update checks are not configured.",
      latestAvailableVersion: null,
    });
  });

  it("invalidates an unparseable checked version", () => {
    expect(
      deriveEffectiveUpdateStatus({
        currentVersion: "2.0.0",
        persisted: persisted("up-to-date", "unknown"),
      }),
    ).toEqual({
      updateCheckStatus: null,
      updateCheckMessage:
        "Update check was run against unknown; re-run to refresh.",
      latestAvailableVersion: null,
    });
  });

  it("does not duplicate a checked version's v prefix", () => {
    expect(
      deriveEffectiveUpdateStatus({
        currentVersion: "2.0.0",
        persisted: persisted("up-to-date", "v1.0.0"),
      }).updateCheckMessage,
    ).toBe("Update check was run against v1.0.0; re-run to refresh.");
  });
});
