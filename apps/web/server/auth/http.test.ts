import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import {
  isSameOrigin,
  jsonErrorResponse,
  jsonNotSignedInResponse,
  notSignedInResponse,
  readJsonBody,
  readRequestBody,
} from "@/server/auth/http";

describe("auth http helpers", () => {
  const jsonRequest = (body: string) =>
    new Request("http://localhost:3000/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

  it.each(["{", ""])(
    "classifies malformed JSON %s at the boundary",
    async (body) => {
      await expect(readJsonBody(jsonRequest(body))).rejects.toMatchObject({
        status: 400,
        code: "INVALID_JSON",
      });
    },
  );

  it.each(["null", "[]", '"text"', "123", "false"])(
    "rejects non-object JSON %s",
    async (body) => {
      await expect(readJsonBody(jsonRequest(body))).rejects.toMatchObject({
        status: 400,
        code: "INVALID_REQUEST",
      });
    },
  );

  it("keeps native JSON values for route schemas and existing form-field coercion", async () => {
    const body = { name: "résumé.txt", enabled: true, count: 2, empty: null };
    expect(await readJsonBody(jsonRequest(JSON.stringify(body)))).toEqual(body);
    expect(await readRequestBody(jsonRequest(JSON.stringify(body)))).toEqual({
      name: "résumé.txt",
      enabled: "true",
      count: "2",
      empty: "",
    });
  });

  it("continues to read urlencoded browser forms", async () => {
    const request = new Request("http://localhost:3000/", {
      method: "POST",
      body: new URLSearchParams({ name: "Photos", redirectTo: "/files" }),
    });
    expect(await readRequestBody(request)).toEqual({
      name: "Photos",
      redirectTo: "/files",
    });
  });

  it("returns a client error for an undecodable form body", async () => {
    const request = new Request("http://localhost:3000/", {
      method: "POST",
      body: "invalid form",
    });
    await expect(readRequestBody(request)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_REQUEST",
    });
  });

  it("does not reclassify a transport or internal decoding failure", async () => {
    const request = jsonRequest("{}");
    const error = new Error("Transport failed.");
    vi.spyOn(request, "json").mockRejectedValueOnce(error);
    await expect(readJsonBody(request)).rejects.toBe(error);
    expect(
      jsonErrorResponse(new SyntaxError("Internal parsing failure")).status,
    ).toBe(500);
  });

  it("returns a normalized JSON not-signed-in response", async () => {
    const response = jsonNotSignedInResponse();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Not signed in.",
      code: "NOT_SIGNED_IN",
    });
  });

  it("marks transient storage contention as retryable", () => {
    const error = Object.assign(new Error("Storage is busy."), {
      code: "STORAGE_MUTATION_IN_PROGRESS",
      status: 503,
    });

    const response = jsonErrorResponse(error);

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
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

  it("allows matching domain origin and host headers", () => {
    const request = new NextRequest("http://internal:3000/files", {
      headers: {
        host: "staaash.example.com",
        origin: "https://staaash.example.com",
      },
    });

    expect(isSameOrigin(request)).toBe(true);
  });

  it("allows matching LAN IP origin and host headers", () => {
    const request = new NextRequest("http://localhost:3000/files", {
      headers: {
        host: "192.168.1.20:2113",
        origin: "http://192.168.1.20:2113",
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

  it("denies domain origin with direct IP host", () => {
    const request = new NextRequest("http://localhost:3000/files", {
      headers: {
        host: "203.0.113.10:2113",
        origin: "https://staaash.example.com",
      },
    });

    expect(isSameOrigin(request)).toBe(false);
  });

  it("denies matching hosts on different ports", () => {
    const request = new NextRequest("http://localhost:3000/files", {
      headers: {
        host: "staaash.example.com:2113",
        origin: "https://staaash.example.com",
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
