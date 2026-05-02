import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { AuthError } from "@/server/auth/errors";

type ParsedRequestBody = Record<string, string>;

const getSingleValue = (value: FormDataEntryValue) =>
  typeof value === "string" ? value : value.name;

export const readRequestBody = async (
  request: Request,
): Promise<ParsedRequestBody> => {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await request.json()) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [
        key,
        value == null ? "" : String(value),
      ]),
    );
  }

  const formData = await request.formData();

  return Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [
      key,
      getSingleValue(value),
    ]),
  );
};

export const wantsJson = (request: Request) =>
  (request.headers.get("accept") ?? "").includes("application/json");

export const getSafeRedirectTarget = (
  value: string | undefined,
  fallback: string,
) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  return value;
};

export const isSameOrigin = (request: NextRequest) => {
  const origin = request.headers.get("origin");

  if (!origin) {
    return true;
  }

  // Compare against Host header rather than nextUrl.origin — in Next.js standalone
  // (Docker), nextUrl.origin reflects the internal server hostname (e.g. localhost)
  // not the external host the browser used.
  const host = request.headers.get("host");

  if (host) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  return origin === request.nextUrl.origin;
};

const normalizeError = (error: unknown) => {
  if (
    error instanceof Error &&
    typeof (error as { status?: unknown }).status === "number" &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    const httpError = error as Error & {
      status: number;
      code: string;
    };

    return {
      status: httpError.status,
      message: httpError.message,
      code: httpError.code,
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      message: error.issues[0]?.message ?? "Invalid request body.",
      code: "INVALID_REQUEST",
    };
  }

  return {
    status: 500,
    message: "Unexpected server error.",
    code: "INTERNAL_ERROR",
  };
};

export const jsonErrorResponse = (error: unknown) => {
  const normalized = normalizeError(error);

  return NextResponse.json(
    {
      error: normalized.message,
      code: normalized.code,
    },
    {
      status: normalized.status,
    },
  );
};

export const jsonNotSignedInResponse = () =>
  jsonErrorResponse(new AuthError("NOT_SIGNED_IN"));

export const signInRedirectResponse = (
  request: NextRequest,
  redirectTo: string,
) =>
  NextResponse.redirect(
    new URL(`/?next=${encodeURIComponent(redirectTo)}`, request.url),
    303,
  );

export const notSignedInResponse = (
  request: NextRequest,
  redirectTo: string,
) =>
  wantsJson(request)
    ? jsonNotSignedInResponse()
    : signInRedirectResponse(request, redirectTo);

export const redirectWithMessage = (
  request: NextRequest,
  path: string,
  key: "error" | "success",
  message: string,
) => {
  const url = new URL(path, request.url);
  url.searchParams.set(key, message);
  return NextResponse.redirect(url, 303);
};

export const formErrorResponse = (
  request: NextRequest,
  path: string,
  error: unknown,
) => {
  const normalized = normalizeError(error);
  return redirectWithMessage(request, path, "error", normalized.message);
};
