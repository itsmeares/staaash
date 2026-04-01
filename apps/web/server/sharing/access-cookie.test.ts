import { describe, expect, it } from "vitest";

import {
  buildShareAccessFingerprint,
  buildClearedShareAccessCookie,
  buildShareAccessCookie,
  verifyShareAccessCookie,
} from "@/server/sharing/access-cookie";

describe("share access cookies", () => {
  it("verifies cookies against the current share fingerprint without storing the hash", () => {
    const cookie = buildShareAccessCookie({
      shareId: "share-1",
      tokenLookupKey: "lookup-1",
      accessFingerprint: buildShareAccessFingerprint({
        shareId: "share-1",
        tokenLookupKey: "lookup-1",
        passwordHash: "hash:v1",
      }),
      token: "lookup-1.signature",
    });
    const [payload] = cookie.value.split(".");
    const decodedPayload = Buffer.from(payload, "base64url").toString("utf8");

    expect(
      verifyShareAccessCookie({
        cookieValue: cookie.value,
        shareId: "share-1",
        tokenLookupKey: "lookup-1",
        passwordHash: "hash:v1",
      }),
    ).toBe(true);
    expect(
      verifyShareAccessCookie({
        cookieValue: cookie.value,
        shareId: "share-1",
        tokenLookupKey: "lookup-1",
        passwordHash: "hash:v2",
      }),
    ).toBe(false);
    expect(decodedPayload).not.toContain("hash:v1");
    expect(decodedPayload).toContain("accessFingerprint");
  });

  it("clears the cookie on the scoped share path", () => {
    const cookie = buildClearedShareAccessCookie("lookup-1.signature");

    expect(cookie.maxAge).toBe(0);
    expect(cookie.path).toBe("/s/lookup-1.signature");
  });
});
