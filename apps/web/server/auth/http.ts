import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { AuthError } from "@/server/auth/errors";
import { getBaseUrl } from "@/server/request";

type ParsedRequestBody = Record<string, string>;

const getSingleValue = (value: FormDataEntryValue) =>
  typeof value === "string" ? value : value.name;

class RequestBodyError extends Error {
  readonly status = 400;

  constructor(
    readonly code: "INVALID_JSON" | "INVALID_REQUEST",
    message: string,
  ) {
    super(message);
  }
}

export const readJsonBody = async (
  request: Request,
): Promise<Record<string, unknown>> => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new RequestBodyError("INVALID_JSON", "Invalid JSON body.");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RequestBodyError(
      "INVALID_REQUEST",
      "Request body must be an object.",
    );
  }
  return payload as Record<string, unknown>;
};

export const readRequestBody = async (
  request: Request,
): Promise<ParsedRequestBody> => {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = await readJsonBody(request);

    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [
        key,
        value == null ? "" : String(value),
      ]),
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new RequestBodyError("INVALID_REQUEST", "Invalid form body.");
  }

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
      headers:
        normalized.code === "STORAGE_MUTATION_IN_PROGRESS"
          ? { "Retry-After": "1" }
          : undefined,
    },
  );
};

export const jsonNotSignedInResponse = () =>
  jsonErrorResponse(new AuthError("NOT_SIGNED_IN"));

const signInRedirectResponse = (request: NextRequest, redirectTo: string) =>
  NextResponse.redirect(
    new URL(
      `/?next=${encodeURIComponent(redirectTo)}`,
      getBaseUrl(request.headers),
    ),
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
  const url = new URL(path, getBaseUrl(request.headers));
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
