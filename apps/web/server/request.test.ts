import { afterEach, describe, expect, it, vi } from "vitest";

const originalPublicUrl = process.env.STAAASH_PUBLIC_URL;

const headers = {
  get(name: string) {
    if (name === "x-forwarded-proto") return "http";
    if (name === "host") return "46.1.113.7:2113";
    return null;
  },
};

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

    expect(getShareBaseUrl(headers)).toBe("http://46.1.113.7:2113");
  });

  it("uses the canonical public URL for share URLs when configured", async () => {
    process.env.STAAASH_PUBLIC_URL = "https://drive.example.com/";
    vi.resetModules();
    const { getShareBaseUrl } = await import("./request");

    expect(getShareBaseUrl(headers)).toBe("https://drive.example.com");
  });
});
