import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { AuthError, isAuthError } from "@/server/auth/errors";
import { assertConfiguredAppUrl, env } from "@/lib/env";

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

  assertConfiguredAppUrl();
  return (
    origin === request.nextUrl.origin || origin === new URL(env.APP_URL).origin
  );
};

const normalizeError = (error: unknown) => {
  if (isAuthError(error)) {
    return {
      status: error.status,
      message: error.message,
      code: error.code,
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
