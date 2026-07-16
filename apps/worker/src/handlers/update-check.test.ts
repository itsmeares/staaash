import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeInstanceUpdateCheck = vi.fn();
const mockFindUnique = vi.fn();

vi.mock("@staaash/db/instance", () => ({
  writeInstanceUpdateCheck,
}));

vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({
    systemSettings: {
      findUnique: mockFindUnique,
    },
  }),
}));

const createJob = () =>
  ({
    id: "job-1",
    kind: "update.check",
    status: "queued",
    payloadJson: {},
    dedupeKey: null,
    runAt: new Date("2026-04-06T12:00:00.000Z"),
    lockedAt: null,
    lockedBy: null,
    attemptCount: 0,
    maxAttempts: 5,
    lastError: null,
    createdAt: new Date("2026-04-06T12:00:00.000Z"),
    updatedAt: new Date("2026-04-06T12:00:00.000Z"),
  }) as const;

const restoreEnvironmentValue = (
  name: "NODE_ENV" | "APP_VERSION" | "STAAASH_VERSION" | "UPDATE_CHECK_TOKEN",
  value: string | undefined,
) => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

describe("update check handler", () => {
  let originalNodeEnv: string | undefined;
  let originalAppVersion: string | undefined;
  let originalStaaashVersion: string | undefined;
  let originalUpdateCheckToken: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalAppVersion = process.env.APP_VERSION;
    originalStaaashVersion = process.env.STAAASH_VERSION;
    originalUpdateCheckToken = process.env.UPDATE_CHECK_TOKEN;
    process.env.NODE_ENV = "production";
    process.env.APP_VERSION = "0.3.0-beta.1";
    delete process.env.STAAASH_VERSION;
    delete process.env.UPDATE_CHECK_TOKEN;
  });

  afterEach(() => {
    restoreEnvironmentValue("NODE_ENV", originalNodeEnv);
    restoreEnvironmentValue("APP_VERSION", originalAppVersion);
    restoreEnvironmentValue("STAAASH_VERSION", originalStaaashVersion);
    restoreEnvironmentValue("UPDATE_CHECK_TOKEN", originalUpdateCheckToken);
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mockFindUnique.mockReset();
  });

  it("marks update checks unavailable when no repository is configured", async () => {
    mockFindUnique.mockResolvedValue(null);
    const { handleUpdateCheck } = await import("./update-check.js");

    await handleUpdateCheck(createJob());

    expect(writeInstanceUpdateCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        updateCheckStatus: "unavailable",
        updateCheckMessage: "Update checks are not configured.",
        latestAvailableVersion: null,
      }),
    );
  });

  it("marks an update as available when the release version is newer", async () => {
    mockFindUnique.mockResolvedValue({
      updateCheckRepository: "itsmeares/staaash",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            tag_name: "v0.3.0",
            draft: false,
            prerelease: false,
          },
        ],
      }),
    );

    const { handleUpdateCheck } = await import("./update-check.js");

    await handleUpdateCheck(createJob());

    expect(writeInstanceUpdateCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        updateCheckStatus: "update-available",
        latestAvailableVersion: "0.3.0",
      }),
    );
  });

  it("selects highest compatible prerelease by SemVer", async () => {
    process.env.APP_VERSION = "1.0.0-rc.2";
    mockFindUnique.mockResolvedValue({
      updateCheckRepository: "itsmeares/staaash",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            tag_name: "v1.0.0-rc.4",
            draft: false,
            prerelease: true,
          },
          {
            tag_name: "v1.0.0-rc.10",
            draft: false,
            prerelease: true,
          },
          {
            tag_name: "not-a-version",
            draft: false,
            prerelease: false,
          },
        ],
      }),
    );

    const { handleUpdateCheck } = await import("./update-check.js");
    await handleUpdateCheck(createJob());

    expect(writeInstanceUpdateCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        updateCheckStatus: "update-available",
        latestAvailableVersion: "1.0.0-rc.10",
      }),
    );
  });

  it("ignores prereleases for stable installs", async () => {
    process.env.APP_VERSION = "1.0.0";
    mockFindUnique.mockResolvedValue({
      updateCheckRepository: "itsmeares/staaash",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            tag_name: "v1.1.0-rc.1",
            draft: false,
            prerelease: true,
          },
          {
            tag_name: "v1.0.1",
            draft: false,
            prerelease: false,
          },
        ],
      }),
    );

    const { handleUpdateCheck } = await import("./update-check.js");
    await handleUpdateCheck(createJob());

    expect(writeInstanceUpdateCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        updateCheckStatus: "update-available",
        latestAvailableVersion: "1.0.1",
      }),
    );
  });

  it("reports up to date when current prerelease is newest", async () => {
    process.env.APP_VERSION = "1.0.0-rc.4";
    mockFindUnique.mockResolvedValue({
      updateCheckRepository: "itsmeares/staaash",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            tag_name: "v1.0.0-rc.4",
            draft: false,
            prerelease: true,
          },
          {
            tag_name: "v1.0.0-rc.3",
            draft: false,
            prerelease: true,
          },
        ],
      }),
    );

    const { handleUpdateCheck } = await import("./update-check.js");
    await handleUpdateCheck(createJob());

    expect(writeInstanceUpdateCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        updateCheckStatus: "up-to-date",
        latestAvailableVersion: "1.0.0-rc.4",
      }),
    );
  });

  it("sends configured GitHub authentication", async () => {
    process.env.UPDATE_CHECK_TOKEN = "test-token";
    mockFindUnique.mockResolvedValue({
      updateCheckRepository: "itsmeares/staaash",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handleUpdateCheck } = await import("./update-check.js");
    await handleUpdateCheck(createJob());

    const request = fetchMock.mock.calls[0]!;
    expect(request[0]).toContain("/releases?per_page=100");
    expect((request[1].headers as Headers).get("Authorization")).toBe(
      "Bearer test-token",
    );
  });

  it("marks missing releases as unavailable rather than errors", async () => {
    mockFindUnique.mockResolvedValue({
      updateCheckRepository: "itsmeares/staaash",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }),
    );

    const { handleUpdateCheck } = await import("./update-check.js");

    await handleUpdateCheck(createJob());

    expect(writeInstanceUpdateCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        updateCheckStatus: "unavailable",
        latestAvailableVersion: null,
      }),
    );
  });

  it("marks transport or API failures as errors", async () => {
    mockFindUnique.mockResolvedValue({
      updateCheckRepository: "itsmeares/staaash",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    const { handleUpdateCheck } = await import("./update-check.js");

    await handleUpdateCheck(createJob());

    expect(writeInstanceUpdateCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        updateCheckStatus: "error",
        latestAvailableVersion: null,
      }),
    );
  });
});
