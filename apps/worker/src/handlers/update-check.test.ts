import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeInstanceUpdateCheck = vi.fn();
const mockFindUnique = vi.fn();

vi.mock("@staaash/db/instance", () => ({
  writeInstanceUpdateCheck,
}));

vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({
    systemSettings: { findUnique: mockFindUnique },
  }),
}));

const job = {
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
} as const;

const githubReleases = [
  { tag_name: "v1.3.0-rc.1", prerelease: true, body: "Try the next one." },
  {
    tag_name: "v1.2.1",
    name: "Staaash 1.2.1",
    body: "A small fix release.",
    published_at: "2026-10-01T10:00:00Z",
    html_url: "https://github.com/itsmeares/staaash/releases/tag/v1.2.1",
  },
  { tag_name: "v1.4.0", draft: true, body: "Not published." },
  { tag_name: "v1.2.0", body: "The redesign." },
  { tag_name: "nightly", body: "Not a version." },
];

const stubGitHub = (response: Partial<Response> & { json?: () => unknown }) => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => githubReleases,
    ...response,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const savedReleases = () =>
  (
    writeInstanceUpdateCheck.mock.calls[0]![0] as {
      releases: Array<{ version: string }>;
    }
  ).releases.map((release) => release.version);

describe("update check handler", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    process.env.APP_VERSION = "1.2.0";
    delete process.env.STAAASH_VERSION;
    delete process.env.UPDATE_CHECK_TOKEN;
    mockFindUnique.mockResolvedValue({
      updateCheckEnabled: true,
      updateCheckRepository: "itsmeares/staaash",
      updateChannel: null,
    });
  });

  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("stores published stable releases, newest first, with their notes", async () => {
    stubGitHub({});
    const { handleUpdateCheck } = await import("./update-check.js");

    await handleUpdateCheck(job);

    expect(savedReleases()).toEqual(["1.2.1", "1.2.0"]);
    expect(writeInstanceUpdateCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        releases: expect.arrayContaining([
          {
            version: "1.2.1",
            name: "Staaash 1.2.1",
            notes: "A small fix release.",
            publishedAt: "2026-10-01T10:00:00Z",
            url: "https://github.com/itsmeares/staaash/releases/tag/v1.2.1",
          },
        ]),
      }),
    );
  });

  it("follows release candidates when a pre-release is running", async () => {
    process.env.APP_VERSION = "1.2.0-rc.3";
    stubGitHub({});
    const { handleUpdateCheck } = await import("./update-check.js");

    await handleUpdateCheck(job);

    expect(savedReleases()).toEqual(["1.3.0-rc.1", "1.2.1", "1.2.0"]);
  });

  it("keeps to stable when the owner picked it, even on a pre-release", async () => {
    process.env.APP_VERSION = "1.2.0-rc.3";
    mockFindUnique.mockResolvedValue({
      updateCheckEnabled: true,
      updateCheckRepository: "itsmeares/staaash",
      updateChannel: "stable",
    });
    stubGitHub({});
    const { handleUpdateCheck } = await import("./update-check.js");

    await handleUpdateCheck(job);

    expect(savedReleases()).toEqual(["1.2.1", "1.2.0"]);
  });

  it("does nothing when checks are switched off", async () => {
    mockFindUnique.mockResolvedValue({
      updateCheckEnabled: false,
      updateCheckRepository: "itsmeares/staaash",
    });
    const fetchMock = stubGitHub({});
    const { handleUpdateCheck } = await import("./update-check.js");

    await handleUpdateCheck(job);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(writeInstanceUpdateCheck).not.toHaveBeenCalled();
  });

  it("records an error without releases when GitHub fails", async () => {
    stubGitHub({ ok: false, status: 503 });
    const { handleUpdateCheck } = await import("./update-check.js");

    await handleUpdateCheck(job);

    expect(writeInstanceUpdateCheck).toHaveBeenCalledWith({
      checkedAt: expect.any(Date),
      error: "GitHub answered 503.",
    });
  });

  it("records an error when no repository is set", async () => {
    mockFindUnique.mockResolvedValue({
      updateCheckEnabled: true,
      updateCheckRepository: " ",
    });
    const { handleUpdateCheck } = await import("./update-check.js");

    await handleUpdateCheck(job);

    expect(writeInstanceUpdateCheck).toHaveBeenCalledWith({
      checkedAt: expect.any(Date),
      error: "No release repository is set.",
    });
  });

  it("sends the optional token to GitHub", async () => {
    process.env.UPDATE_CHECK_TOKEN = "secret-token";
    const fetchMock = stubGitHub({});
    const { handleUpdateCheck } = await import("./update-check.js");

    await handleUpdateCheck(job);

    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
  });

  it("skips outside production", async () => {
    process.env.NODE_ENV = "development";
    const fetchMock = stubGitHub({});
    const { handleUpdateCheck } = await import("./update-check.js");

    await handleUpdateCheck(job);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
