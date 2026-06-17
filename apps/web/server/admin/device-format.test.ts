import { describe, expect, it } from "vitest";

import { formatSessionIp } from "@/app/admin/users/[userId]/device-format";

describe("formatSessionIp", () => {
  it("normalizes IPv4-mapped IPv6 loopback addresses", () => {
    expect(formatSessionIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
  });

  it("keeps regular IP addresses unchanged", () => {
    expect(formatSessionIp("2001:db8::1")).toBe("2001:db8::1");
    expect(formatSessionIp("192.168.1.10")).toBe("192.168.1.10");
  });

  it("returns null for missing IP addresses", () => {
    expect(formatSessionIp(null)).toBeNull();
  });
});
