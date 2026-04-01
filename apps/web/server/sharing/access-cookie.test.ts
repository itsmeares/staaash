import { describe, expect, it } from "vitest";

import {
  buildClearedShareAccessCookie,
  buildShareAccessCookie,
  verifyShareAccessCookie,
} from "@/server/sharing/access-cookie";

describe("share access cookies", () => {
  it("verifies cookies against the current share password hash", () => {
    const cookie = buildShareAccessCookie({
      shareId: "share-1",
      tokenLookupKey: "lookup-1",
      passwordHash: "hash:v1",
      token: "lookup-1.signature",
    });

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
  });

  it("clears the cookie on the scoped share path", () => {
    const cookie = buildClearedShareAccessCookie("lookup-1.signature");

    expect(cookie.maxAge).toBe(0);
    expect(cookie.path).toBe("/s/lookup-1.signature");
  });
});
