import { hc, type ClientResponse } from "hono/client";
import type { SuccessStatusCode } from "hono/utils/http-status";

import type { AppType } from "@/server/http/app";

export const api = hc<AppType>("/");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly body?: Record<string, unknown> | null,
  ) {
    super(message);
  }
}

/** The JSON a call answers with when it succeeds. */
type Success<R> =
  R extends ClientResponse<infer T, infer S, "json">
    ? S extends SuccessStatusCode
      ? T
      : never
    : never;

/** The body of a successful call; anything else throws an `ApiError`. */
export const read = async <R extends ClientResponse<unknown>>(
  call: Promise<R>,
): Promise<Success<R>> => {
  const response = await call;
  const body = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (response.ok) return body as Success<R>;
  throw new ApiError(
    response.status,
    typeof body?.error === "string"
      ? body.error
      : `Request failed (${response.status}).`,
    typeof body?.code === "string" ? body.code : undefined,
    body,
  );
};
