import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
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
      },
    });

    const response = notSignedInResponse(request, "/files/f/folder-1");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/sign-in?next=%2Ffiles%2Ff%2Ffolder-1",
    );
  });
});
