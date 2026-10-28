import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { contextStorage } from "hono/context-storage";
import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { canAccessAdminSurface } from "@/server/access";
import { AuthError } from "@/server/auth/errors";
import { getRequestSession } from "@/server/auth/guards";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import { getBaseUrl } from "@/server/request";
import {
  attachStorageMutationHeader,
  readStorageIdempotencyKey,
} from "@/server/storage-idempotency";

export type Session = NonNullable<
  Awaited<ReturnType<typeof getRequestSession>>
>;

export type AppEnv = {
  Variables: {
    session: Session;
    idempotencyKey: string;
  };
};

const bearerToken = (request: Request) => {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
};

/** A desktop device sends its token in a header; browsers send the cookie. */
export const sessionToken = (c: Context) =>
  c.req.header("authorization") !== undefined
    ? bearerToken(c.req.raw)
    : (getCookie(c, SESSION_COOKIE_NAME) ?? null);

export const actorOf = (session: Session) => ({
  actorUserId: session.user.id,
  actorRole: session.user.role,
});

const isPageLoad = (request: Request) =>
  request.method === "GET" &&
  (request.headers.get("accept") ?? "").includes("text/html");

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const httpError = (status: number, code: string, message: string) =>
  new HttpError(status, code, message);

const isSameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  // Compare against Host, not the URL the server sees: behind a proxy the
  // server's own URL is its internal address.
  const host = request.headers.get("host");
  try {
    return new URL(origin).host === (host ?? new URL(request.url).host);
  } catch {
    return false;
  }
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Cookies ride along on cross-site form posts, so writes must come from this origin. */
const sameOrigin = createMiddleware(async (c, next) => {
  // A header token is not sent by the browser on its own, so it cannot be forged cross-site.
  if (
    !SAFE_METHODS.has(c.req.method) &&
    !bearerToken(c.req.raw) &&
    !isSameOrigin(c.req.raw)
  ) {
    throw httpError(
      403,
      "CROSS_ORIGIN",
      "Cross-origin requests are not allowed.",
    );
  }
  await next();
});

/**
 * A signed-in, onboarded user. A browser opening a file link while signed out
 * goes to sign-in and comes back; API callers get 401.
 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const session = await getRequestSession(sessionToken(c));
  // Only device tokens travel in a header; a browser session token does not.
  const misused = session && bearerToken(c.req.raw) && !session.deviceName;
  if (!session || misused) {
    if (isPageLoad(c.req.raw)) {
      const url = new URL(c.req.url);
      const back = `${url.pathname}${url.search}`;
      return c.redirect(
        new URL(
          `/?next=${encodeURIComponent(back)}`,
          getBaseUrl(c.req.raw.headers),
        ).toString(),
        303,
      );
    }
    throw new AuthError("NOT_SIGNED_IN");
  }
  c.set("session", session);
  await next();
});

/** Routes only a desktop device calls, with its device token. */
export const requireDevice = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.session.deviceName || !bearerToken(c.req.raw)) {
    throw httpError(
      403,
      "DEVICE_REQUIRED",
      "Only a signed-in device can do this.",
    );
  }
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (
    c.var.session.deviceName ||
    !canAccessAdminSurface(c.var.session.user.role)
  ) {
    throw httpError(403, "ADMIN_REQUIRED", "Admin access required.");
  }
  await next();
});

export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  const { user, deviceName } = c.var.session;
  if (deviceName || !canAccessAdminSurface(user.role) || !user.isOwner) {
    throw httpError(403, "OWNER_REQUIRED", "Owner access required.");
  }
  await next();
});

/**
 * Storage writes carry an Idempotency-Key so a retry replays instead of
 * repeating. The response names the journal mutation for support and retries.
 */
export const storageMutation = (journalKey = (key: string) => key) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const key = readStorageIdempotencyKey(c.req.raw);
    c.set("idempotencyKey", key);
    await next();
    c.res = await attachStorageMutationHeader(
      c.res,
      journalKey(key),
      c.var.session.user.id,
      c.error,
    );
  });

const RETRY_AFTER_CODES = new Set([
  "STORAGE_MUTATION_IN_PROGRESS",
  "STORAGE_ADMISSION_BUSY",
  "UPLOAD_ADMISSION_BUSY",
]);

// One branch per error family the API answers.
// fallow-ignore-next-line complexity
const normalizeError = (error: unknown) => {
  if (error instanceof HTTPException) {
    return {
      status: error.status,
      code: error.status === 400 ? "INVALID_REQUEST" : "HTTP_ERROR",
      message: error.message,
    };
  }
  if (
    error instanceof Error &&
    typeof (error as { status?: unknown }).status === "number" &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    const { status, code } = error as Error & { status: number; code: string };
    return { status, code, message: error.message };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      code: "INVALID_REQUEST",
      message: error.issues[0]?.message ?? "Invalid request body.",
    };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Unexpected server error.",
  };
};

const errorBody = (error: unknown) => {
  const { status, code, message } = normalizeError(error);
  const { mutationId, details } = (error ?? {}) as {
    mutationId?: unknown;
    details?: unknown;
  };
  return {
    status,
    body: { error: message, code, ...(details ? { details } : {}) },
    headers: {
      ...(RETRY_AFTER_CODES.has(code) ? { "Retry-After": "1" } : {}),
      ...(typeof mutationId === "string"
        ? { "X-Storage-Mutation-Id": mutationId }
        : {}),
    },
  };
};

export const jsonError = (error: unknown) => {
  const { status, body, headers } = errorBody(error);
  return Response.json(body, { status, headers });
};

const onError = (error: Error) => {
  const response = jsonError(error);
  if (response.status >= 500) console.error("[http]", error);
  return response;
};

/** A route group whose invalid input answers like every other error. */
export const router = () =>
  new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) throw result.error;
    },
  });

const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
    details: z.unknown().optional(),
  })
  .openapi("Error");

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorSchema } },
});

/** The error statuses every signed-in route can answer with. */
export const errorResponses = {
  400: errorResponse("The request is invalid."),
  401: errorResponse("Not signed in."),
  403: errorResponse("Not allowed."),
  404: errorResponse("Not found or inaccessible."),
  409: errorResponse("Conflicts with the current state."),
  503: errorResponse("Busy or recovering. Retry after the Retry-After delay."),
} as const;

type CookieSpec = { name: string; value: string } & Parameters<
  typeof setCookie
>[3];

export const applyCookie = (
  c: Context,
  { name, value, ...options }: CookieSpec,
) => setCookie(c, name, value, options);

/** The app shell every route group mounts into: one error format, one origin check. */
export const createApp = () => {
  const app = router();
  app.onError(onError);
  // Lets the journal tag changes with the device that asked for them.
  app.use(contextStorage());
  app.notFound(() =>
    Response.json({ error: "Not found.", code: "NOT_FOUND" }, { status: 404 }),
  );
  app.use("/api/*", sameOrigin);
  app.use("/s/*", sameOrigin);
  return app;
};
