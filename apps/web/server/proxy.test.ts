import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

const requestForPath = (path: string, cookie: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: {
      cookie,
      host: "localhost:3000",
    },
  });

describe("proxy onboarding cookie guard", () => {
  it.each([
    "/admin",
    "/favorites",
    "/files",
    "/home",
    "/recent",
    "/search",
    "/settings",
    "/shared",
    "/trash",
  ])(
    "redirects %s when session exists but onboarded cookie is missing",
    (path) => {
      const response = proxy(requestForPath(path, "staaash_session=token"));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3000/");
    },
  );

  it("lets the DB-backed page and API guards handle stale onboarded cookies", () => {
    const response = proxy(
      requestForPath("/files", "staaash_session=token; staaash_onboarded=1"),
    );

    expect(response.status).toBe(200);
  });

  it("does not gate public invite or share paths", () => {
    expect(
      proxy(requestForPath("/invite/token", "staaash_session=token")).status,
    ).toBe(200);
    expect(
      proxy(requestForPath("/s/token", "staaash_session=token")).status,
    ).toBe(200);
  });
});
