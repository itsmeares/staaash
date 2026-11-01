import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { version as packageVersion } from "../package.json";

const { getRequestSession } = vi.hoisted(() => ({
  getRequestSession: vi.fn(),
}));
vi.mock("@/server/auth/guards", () => ({ getRequestSession }));

import { app } from "./http/app";

const RELEASES = "https://github.com/itsmeares/staaash/releases";
const fetchRelease = vi.fn<typeof fetch>();
const published = (tag: string) => ({
  tag_name: tag,
  draft: false,
  published_at: "2026-10-31T10:47:12Z",
  html_url: "https://untrusted.example/download",
});
const request = (accept = "application/json") =>
  app.request("http://localhost/api/desktop-app", {
    headers: { accept, cookie: "staaash_session=sample-session" },
  });

describe("desktop release link", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchRelease);
    vi.stubEnv("APP_VERSION", "2.0.0-rc.1");
    getRequestSession.mockResolvedValue({
      user: { id: "owner", role: "owner" },
    });
  });
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  for (const role of ["owner", "member"])
    it.each(["2.0.0", "2.0.0-rc.1", "v2.0.0-rc.2+custom", "edge"])(
      `opens the matching release for ${role} on %s`,
      async (version) => {
        vi.stubEnv("APP_VERSION", version);
        getRequestSession.mockResolvedValue({ user: { id: role, role } });
        const tag = `v${version === "edge" ? packageVersion : version.replace(/^v/, "")}`;
        fetchRelease.mockResolvedValue(Response.json(published(tag)));

        const response = await request();

        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe(
          `${RELEASES}/tag/${encodeURIComponent(tag)}`,
        );
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(fetchRelease).toHaveBeenCalledWith(
          `https://api.github.com/repos/itsmeares/staaash/releases/tags/${encodeURIComponent(tag)}`,
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        expect(getRequestSession).toHaveBeenCalledWith("sample-session");
      },
    );

  it.each([404, 403, 429, 500])(
    "opens all releases when the lookup answers %s",
    async (status) => {
      fetchRelease.mockResolvedValue(new Response(null, { status }));
      const response = await request();
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(RELEASES);
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it.each([
    null,
    { ...published("v2.0.0-rc.1"), draft: true },
    { ...published("v2.0.0-rc.1"), published_at: null },
    published("v2.0.0-rc.10"),
  ])(
    "opens all releases for an unpublished or invalid reply %j",
    async (body) => {
      fetchRelease.mockResolvedValue(Response.json(body));
      expect((await request()).headers.get("location")).toBe(RELEASES);
    },
  );

  it("opens all releases when GitHub sends invalid JSON", async () => {
    fetchRelease.mockResolvedValue(new Response("invalid JSON"));
    expect((await request()).headers.get("location")).toBe(RELEASES);
  });

  it("opens all releases when the connection fails", async () => {
    fetchRelease.mockRejectedValue(new TypeError("Connection failed"));
    expect((await request()).headers.get("location")).toBe(RELEASES);
  });

  it("stops waiting for GitHub after three seconds", async () => {
    fetchRelease.mockImplementation(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          const signal = options!.signal!;
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    expect((await request()).headers.get("location")).toBe(RELEASES);
    expect(fetchRelease.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it("checks again after a missing release is published", async () => {
    fetchRelease
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json(published("v2.0.0-rc.1")));
    expect((await request()).headers.get("location")).toBe(RELEASES);
    expect((await request()).headers.get("location")).toBe(
      `${RELEASES}/tag/v2.0.0-rc.1`,
    );
  });

  it("rejects a signed-out API caller before contacting GitHub", async () => {
    getRequestSession.mockResolvedValue(null);
    expect((await request()).status).toBe(401);
    expect(fetchRelease).not.toHaveBeenCalled();
  });

  it("sends a signed-out browser to sign-in and preserves the return path", async () => {
    getRequestSession.mockResolvedValue(null);
    const response = await request("text/html");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost/?next=%2Fapi%2Fdesktop-app",
    );
    expect(fetchRelease).not.toHaveBeenCalled();
  });
});
