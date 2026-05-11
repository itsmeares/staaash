import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  isSameOrigin,
  jsonNotSignedInResponse,
  notSignedInResponse,
} from "@/server/auth/http";

describe("auth http helpers", () => {
  it("returns a normalized JSON not-signed-in response", async () => {
    const response = jsonNotSignedInResponse();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Not signed in.",
      code: "NOT_SIGNED_IN",
    });
  });

  it("redirects form callers to sign-in with a safe next target", () => {
    const request = new NextRequest("http://localhost:3000/library", {
      headers: {
        accept: "text/html",
        host: "localhost:3000",
      },
    });

    const response = notSignedInResponse(request, "/files/f/folder-1");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/?next=%2Ffiles%2Ff%2Ffolder-1",
    );
  });

  it("allows matching origin and host headers", () => {
    const request = new NextRequest("http://localhost:3000/files", {
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
      },
    });

    expect(isSameOrigin(request)).toBe(true);
  });

  it("allows requests with no origin header", () => {
    const request = new NextRequest("http://localhost:3000/files", {
      headers: {
        host: "localhost:3000",
      },
    });

    expect(isSameOrigin(request)).toBe(true);
  });

  it("denies mismatched origin and host headers", () => {
    const request = new NextRequest("http://localhost:3000/files", {
      headers: {
        host: "localhost:3000",
        origin: "https://evil.example",
      },
    });

    expect(isSameOrigin(request)).toBe(false);
  });

  it("denies invalid origin headers", () => {
    const request = new NextRequest("http://localhost:3000/files", {
      headers: {
        host: "localhost:3000",
        origin: "not a valid origin",
      },
    });

    expect(isSameOrigin(request)).toBe(false);
  });
});
