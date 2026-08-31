import { describe, expect, it } from "vitest";

import type { UpdateCheckStatus } from "@staaash/db/instance";

import { deriveEffectiveUpdateStatus } from "@/server/update-derive";

const derive = ({
  currentVersion,
  persisted,
}: {
  currentVersion: string;
  persisted: {
    updateCheckStatus: UpdateCheckStatus | null;
    updateCheckMessage: string | null;
    latestAvailableVersion: string | null;
    checkedVersion: string | null;
  };
}) => deriveEffectiveUpdateStatus({ currentVersion, persisted });

describe("deriveEffectiveUpdateStatus", () => {
  it("flips update-available to up-to-date when current equals latest", () => {
    expect(
      derive({
        currentVersion: "1.0.0",
        persisted: {
          updateCheckStatus: "update-available",
          updateCheckMessage: "Update available: 1.0.0.",
          checkedVersion: null,
          latestAvailableVersion: "1.0.0",
        },
      }),
    ).toEqual({
      updateCheckStatus: "up-to-date",
      updateCheckMessage:
        "Instance is on or ahead of the latest published release (v1.0.0).",
    });
  });

  it("flips update-available to up-to-date when current is ahead of latest", () => {
    expect(
      derive({
        currentVersion: "1.1.0",
        persisted: {
          updateCheckStatus: "update-available",
          updateCheckMessage: "Update available: 1.0.0.",
          checkedVersion: null,
          latestAvailableVersion: "1.0.0",
        },
      }),
    ).toEqual({
      updateCheckStatus: "up-to-date",
      updateCheckMessage:
        "Instance is on or ahead of the latest published release (v1.0.0).",
    });
  });

  it("keeps update-available when current is genuinely behind latest", () => {
    expect(
      derive({
        currentVersion: "1.0.0",
        persisted: {
          updateCheckStatus: "update-available",
          updateCheckMessage: "Update available: 1.1.0.",
          checkedVersion: null,
          latestAvailableVersion: "1.1.0",
        },
      }),
    ).toEqual({
      updateCheckStatus: "update-available",
      updateCheckMessage: "Update available: 1.1.0.",
    });
  });

  it("passes through when latestAvailableVersion is null", () => {
    expect(
      derive({
        currentVersion: "1.0.0",
        persisted: {
          updateCheckStatus: "update-available",
          updateCheckMessage: "Update available.",
          checkedVersion: null,
          latestAvailableVersion: null,
        },
      }),
    ).toEqual({
      updateCheckStatus: "update-available",
      updateCheckMessage: "Update available.",
    });
  });

  it("passes through when currentVersion is not a SemVer (development)", () => {
    expect(
      derive({
        currentVersion: "development",
        persisted: {
          updateCheckStatus: "update-available",
          updateCheckMessage: "Update available: 1.0.0.",
          checkedVersion: null,
          latestAvailableVersion: "1.0.0",
        },
      }),
    ).toEqual({
      updateCheckStatus: "update-available",
      updateCheckMessage: "Update available: 1.0.0.",
    });
  });

  it("does not change persisted up-to-date for any current/latest", () => {
    for (const latest of ["1.0.0", null, "9.9.9"]) {
      expect(
        derive({
          currentVersion: "1.0.0",
          persisted: {
            updateCheckStatus: "up-to-date",
            updateCheckMessage:
              "Instance is on the latest published release (v1.0.0).",
            checkedVersion: null,
            latestAvailableVersion: latest,
          },
        }),
      ).toEqual({
        updateCheckStatus: "up-to-date",
        updateCheckMessage:
          "Instance is on the latest published release (v1.0.0).",
      });
    }
  });

  it("passes through a null persisted status unchanged", () => {
    expect(
      derive({
        currentVersion: "1.0.0",
        persisted: {
          updateCheckStatus: null,
          updateCheckMessage: null,
          checkedVersion: null,
          latestAvailableVersion: "1.0.0",
        },
      }),
    ).toEqual({
      updateCheckStatus: null,
      updateCheckMessage: null,
    });
  });

  it("normalizes a leading v on current before comparing", () => {
    expect(
      derive({
        currentVersion: "v1.0.0",
        persisted: {
          updateCheckStatus: "update-available",
          updateCheckMessage: "Update available: 1.0.0.",
          checkedVersion: null,
          latestAvailableVersion: "1.0.0",
        },
      }),
    ).toEqual({
      updateCheckStatus: "up-to-date",
      updateCheckMessage:
        "Instance is on or ahead of the latest published release (v1.0.0).",
    });
  });

  it("is deterministic and repeatable for the same input", () => {
    const input = {
      currentVersion: "1.0.0",
      persisted: {
        updateCheckStatus: "update-available" as UpdateCheckStatus,
        updateCheckMessage: "Update available: 1.0.0.",
        checkedVersion: null,
        latestAvailableVersion: "1.0.0",
      },
    };
    expect(derive(input)).toEqual(derive(input));
  });

  it("neutralizes a stale update-available row checked against a different version", () => {
    expect(
      derive({
        currentVersion: "2.0.0",
        persisted: {
          updateCheckStatus: "update-available",
          updateCheckMessage: "Update available: 1.0.0.",
          latestAvailableVersion: "1.0.0",
          checkedVersion: "1.0.0",
        },
      }),
    ).toEqual({
      updateCheckStatus: null,
      updateCheckMessage:
        "Update check was run against v1.0.0; re-run to refresh.",
    });
  });

  it("neutralizes a stale non-update-available row checked against a different version", () => {
    for (const status of ["up-to-date", "error"] as const) {
      expect(
        derive({
          currentVersion: "2.0.0",
          persisted: {
            updateCheckStatus: status,
            updateCheckMessage: `some ${status} message`,
            latestAvailableVersion: "1.0.0",
            checkedVersion: "1.0.0",
          },
        }),
      ).toEqual({
        updateCheckStatus: null,
        updateCheckMessage:
          "Update check was run against v1.0.0; re-run to refresh.",
      });
    }
  });

  it("neutralizes a null-status row that was checked against a different version", () => {
    expect(
      derive({
        currentVersion: "2.0.0",
        persisted: {
          updateCheckStatus: null,
          updateCheckMessage: null,
          latestAvailableVersion: "1.0.0",
          checkedVersion: "1.0.0",
        },
      }),
    ).toEqual({
      updateCheckStatus: null,
      updateCheckMessage:
        "Update check was run against v1.0.0; re-run to refresh.",
    });
  });

  it("passes update-available through to the existing downgrade when checkedVersion is null", () => {
    expect(
      derive({
        currentVersion: "1.0.0",
        persisted: {
          updateCheckStatus: "update-available",
          updateCheckMessage: "Update available: 1.0.0.",
          latestAvailableVersion: "1.0.0",
          checkedVersion: null,
        },
      }),
    ).toEqual({
      updateCheckStatus: "up-to-date",
      updateCheckMessage:
        "Instance is on or ahead of the latest published release (v1.0.0).",
    });
  });

  it("passes a never-checked null-status row through untouched when checkedVersion is null", () => {
    expect(
      derive({
        currentVersion: "1.0.0",
        persisted: {
          updateCheckStatus: null,
          updateCheckMessage: null,
          latestAvailableVersion: null,
          checkedVersion: null,
        },
      }),
    ).toEqual({
      updateCheckStatus: null,
      updateCheckMessage: null,
    });
  });

  it("skips the mismatch check when the development version is not a SemVer", () => {
    expect(
      derive({
        currentVersion: "development",
        persisted: {
          updateCheckStatus: "update-available",
          updateCheckMessage: "Update available: 1.0.0.",
          latestAvailableVersion: "1.0.0",
          checkedVersion: "1.0.0",
        },
      }),
    ).toEqual({
      updateCheckStatus: "update-available",
      updateCheckMessage: "Update available: 1.0.0.",
    });
  });

  it("skips the mismatch check when the checkedVersion is not a SemVer", () => {
    expect(
      derive({
        currentVersion: "2.0.0",
        persisted: {
          updateCheckStatus: "up-to-date",
          updateCheckMessage: "Instance is on the latest.",
          latestAvailableVersion: "1.0.0",
          checkedVersion: "not-a-version",
        },
      }),
    ).toEqual({
      updateCheckStatus: "up-to-date",
      updateCheckMessage: "Instance is on the latest.",
    });
  });

  it("passes through when the checkedVersion equals the current version", () => {
    expect(
      derive({
        currentVersion: "1.0.0",
        persisted: {
          updateCheckStatus: "update-available",
          updateCheckMessage: "Update available: 1.0.0.",
          latestAvailableVersion: "1.0.0",
          checkedVersion: "1.0.0",
        },
      }),
    ).toEqual({
      updateCheckStatus: "up-to-date",
      updateCheckMessage:
        "Instance is on or ahead of the latest published release (v1.0.0).",
    });
  });

  it("keeps other persisted statuses byte-for-byte", () => {
    for (const status of [
      "unavailable",
      "error",
    ] as const satisfies UpdateCheckStatus[]) {
      expect(
        derive({
          currentVersion: "1.0.0",
          persisted: {
            updateCheckStatus: status,
            updateCheckMessage: `some ${status} message`,
            checkedVersion: null,
            latestAvailableVersion: "1.0.0",
          },
        }),
      ).toEqual({
        updateCheckStatus: status,
        updateCheckMessage: `some ${status} message`,
      });
    }
  });
});
