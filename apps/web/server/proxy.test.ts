import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

const requestForPath = (
  path: string,
  cookie: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
) =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: {
      cookie,
      host: "localhost:3000",
    },
    ...init,
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

  it("does not gate public share paths", () => {
    expect(
      proxy(requestForPath("/s/token", "staaash_session=token")).status,
    ).toBe(200);
  });

  it("rejects oversized direct uploads before the route reads the body", () => {
    const request = requestForPath("/api/files/files", "", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-length": String(Number.MAX_SAFE_INTEGER),
        "content-type": "multipart/form-data; boundary=test",
      },
      body: "not-read-by-the-proxy",
    });

    const response = proxy(request);

    expect(response.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
  });
});
