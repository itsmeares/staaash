import { describe, expect, it } from "vite-plus/test";

import { toDevice } from "@/lib/user-agent";

const session = (
  userAgent: string | null,
  ipAddress: string | null = null,
) => ({
  id: "s1",
  userAgent,
  ipAddress,
  lastSeenAt: null,
  deviceName: null as string | null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
});

const other = { id: "other", deviceSessionId: null };

describe("toDevice", () => {
  it("names the browser and system", () => {
    const name = (ua: string) => toDevice(session(ua), other).device;
    expect(
      name(
        "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
      ),
    ).toBe("Firefox on Linux");
    expect(
      name(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iPhone");
    expect(
      name(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      ),
    ).toBe("Edge on Windows");
    expect(toDevice(session(null), other).device).toBe("Unknown browser");
  });

  it("writes addresses the way people do", () => {
    const ip = (value: string | null) =>
      toDevice(session(null, value), other).ipAddress;
    expect(ip("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(ip("2001:db8::1")).toBe("2001:db8::1");
    expect(ip(null)).toBeNull();
  });

  it("marks this browser, and the device whose app window this is", () => {
    expect(
      toDevice(session(null), { id: "s1", deviceSessionId: null }).current,
    ).toBe(true);
    expect(
      toDevice(session(null), { id: "w1", deviceSessionId: "s1" }).current,
    ).toBe(true);
  });

  it("names a desktop device by the name it signed in with", () => {
    expect(
      toDevice({ ...session(null), deviceName: "Work laptop" }, other).device,
    ).toBe("Work laptop");
  });
});
