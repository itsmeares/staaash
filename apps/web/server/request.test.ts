import { afterEach, describe, expect, it, vi } from "vitest";

const originalPublicUrl = process.env.STAAASH_PUBLIC_URL;

const makeHeaders = (values: Record<string, string> = {}) => ({
  get(name: string) {
    return values[name] ?? null;
  },
});

const directIpHeaders = makeHeaders({
  "x-forwarded-proto": "http",
  host: "46.1.113.7:2113",
});

describe("request base URLs", () => {
  afterEach(() => {
    if (originalPublicUrl === undefined) {
      delete process.env.STAAASH_PUBLIC_URL;
    } else {
      process.env.STAAASH_PUBLIC_URL = originalPublicUrl;
    }
    vi.resetModules();
  });

  it("falls back to request headers for share URLs", async () => {
    delete process.env.STAAASH_PUBLIC_URL;
    vi.resetModules();
    const { getShareBaseUrl } = await import("./request");

    expect(getShareBaseUrl(directIpHeaders)).toBe("http://46.1.113.7:2113");
  });

  it("uses the canonical public URL for share URLs when configured", async () => {
    process.env.STAAASH_PUBLIC_URL = "https://drive.example.com/";
    vi.resetModules();
    const { getShareBaseUrl } = await import("./request");

    expect(getShareBaseUrl(directIpHeaders)).toBe("https://drive.example.com");
  });

  it("accepts a canonical HTTP URL for IP-only installs", async () => {
    process.env.STAAASH_PUBLIC_URL = "http://46.1.113.7:2113/";
    vi.resetModules();
    const { getShareBaseUrl } = await import("./request");

    expect(getShareBaseUrl(directIpHeaders)).toBe("http://46.1.113.7:2113");
  });

  it("uses the preserved host and forwarded HTTPS protocol for Caddy", async () => {
    delete process.env.STAAASH_PUBLIC_URL;
    vi.resetModules();
    const { getBaseUrl } = await import("./request");

    expect(
      getBaseUrl(
        makeHeaders({
          host: "drive.example.com",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://drive.example.com");
  });

  it("ignores forwarded hosts and malformed forwarded protocols", async () => {
    delete process.env.STAAASH_PUBLIC_URL;
    vi.resetModules();
    const { getBaseUrl } = await import("./request");

    expect(
      getBaseUrl(
        makeHeaders({
          host: "drive.example.com",
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "https, http",
        }),
      ),
    ).toBe("http://drive.example.com");
  });

  it("falls back to localhost for malformed host headers", async () => {
    delete process.env.STAAASH_PUBLIC_URL;
    vi.resetModules();
    const { getBaseUrl } = await import("./request");

    expect(getBaseUrl(makeHeaders({ host: "drive.example.com/path" }))).toBe(
      "http://localhost",
    );
  });
});
