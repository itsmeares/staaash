import { createRoute, z } from "@hono/zod-openapi";
import { AUTO_TIME_ZONE, isValidTimeZone } from "@staaash/config/time-zone";

import { AuthError } from "@/server/auth/errors";
import { authService } from "@/server/auth/service";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  buildThemeCookie,
} from "@/server/auth/session";
import {
  applyCookie,
  errorResponses,
  requireUser,
  router,
  sessionToken,
} from "@/server/http/core";
import {
  json,
  jsonBody,
  OkSchema,
  PreferencesSchema,
  SessionSchema,
  toSessionView,
  toUserView,
  UserSchema,
} from "@/server/http/schemas";
import { getRequestSessionMetadata } from "@/server/request";

const SetupBody = z.object({
  instanceName: z.string(),
  email: z.string(),
  displayName: z.string().optional(),
  password: z.string(),
});

const setup = createRoute({
  method: "post",
  path: "/api/auth/setup",
  tags: ["Auth"],
  summary: "Create the owner account on a new instance and sign in.",
  request: { body: jsonBody(SetupBody) },
  responses: {
    201: json(
      z.object({ user: UserSchema, session: SessionSchema }),
      "Signed in as the new owner.",
    ),
    ...errorResponses,
  },
});

const SignInBody = z.object({ email: z.string(), password: z.string() });

const signIn = createRoute({
  method: "post",
  path: "/api/auth/sign-in",
  tags: ["Auth"],
  summary: "Sign in with email and password.",
  request: { body: jsonBody(SignInBody) },
  responses: {
    200: json(
      z.object({
        user: z.object({ preferences: PreferencesSchema.nullable() }),
      }),
      "Signed in. The session cookie is set.",
    ),
    ...errorResponses,
  },
});

const signOut = createRoute({
  method: "post",
  path: "/api/auth/sign-out",
  tags: ["Auth"],
  summary: "End this session.",
  responses: { 200: json(OkSchema, "Signed out."), ...errorResponses },
});

const currentSession = createRoute({
  method: "get",
  path: "/api/auth/session",
  tags: ["Auth"],
  summary:
    "The current session, including accounts that still have to finish onboarding or change a temporary password.",
  responses: { 200: json(SessionSchema, "Signed in."), ...errorResponses },
});

const RequiredPasswordBody = z.object({
  password: z.string(),
  confirmPassword: z.string(),
});

const requiredPassword = createRoute({
  method: "post",
  path: "/api/auth/password-change-required",
  tags: ["Auth"],
  summary: "Replace a temporary password.",
  request: { body: jsonBody(RequiredPasswordBody) },
  responses: {
    200: json(
      z.object({ onboardingCompleted: z.boolean() }),
      "Password changed.",
    ),
    ...errorResponses,
  },
});

const PreferencesBody = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  timeZone: z
    .string()
    .trim()
    .refine(
      (value) => value === AUTO_TIME_ZONE || isValidTimeZone(value),
      "Invalid time zone.",
    )
    .optional(),
  showUpdateNotifications: z.boolean().optional(),
  showFolderPreviews: z.boolean().optional(),
  showPinsInSidebar: z.boolean().optional(),
  startPage: z.enum(["home", "files"]).optional(),
  defaultView: z.enum(["list", "grid"]).optional(),
  clockFormat: z.enum(["12h", "24h"]).optional(),
  displayName: z.string().trim().max(80).nullable().optional(),
  avatarUrl: z.string().max(300000).nullable().optional(),
});

const preferences = createRoute({
  method: "post",
  path: "/api/user/preferences",
  tags: ["Account"],
  summary: "Save preferences. Saving them also finishes onboarding.",
  request: { body: jsonBody(PreferencesBody) },
  responses: { 200: json(OkSchema, "Saved."), ...errorResponses },
});

const PasswordBody = z.object({
  currentPassword: z.string().min(1).max(128),
  password: z.string(),
  confirmPassword: z.string(),
});

const password = createRoute({
  method: "post",
  path: "/api/user/password",
  tags: ["Account"],
  summary: "Change your password. Your other sessions are signed out.",
  middleware: [requireUser],
  request: { body: jsonBody(PasswordBody) },
  responses: { 200: json(OkSchema, "Changed."), ...errorResponses },
});

const revokeSessions = createRoute({
  method: "post",
  path: "/api/user/sessions/revoke",
  tags: ["Account"],
  summary:
    "Sign out one of your other sessions, or all of them when no id is sent.",
  middleware: [requireUser],
  request: {
    body: jsonBody(z.object({ sessionId: z.string().min(1).optional() })),
  },
  responses: { 200: json(OkSchema, "Signed out."), ...errorResponses },
});

/** Any session, onboarded or not. Onboarding and password changes need it. */
const anySession = async (token: string | null) => {
  const session = await authService.getSession(token);
  if (!session) throw new AuthError("NOT_SIGNED_IN");
  return session;
};

export const authRoutes = router()
  .openapi(setup, async (c) => {
    const result = await authService.bootstrap(
      c.req.valid("json"),
      getRequestSessionMetadata(c.req.raw.headers),
    );
    applyCookie(
      c,
      buildSessionCookie(
        result.sessionToken,
        result.session.expiresAt,
        c.req.raw,
      ),
    );
    return c.json(
      {
        user: toUserView(result.user),
        session: toSessionView(result.session),
      },
      201,
    );
  })
  .openapi(signIn, async (c) => {
    const result = await authService.signIn(
      c.req.valid("json"),
      getRequestSessionMetadata(c.req.raw.headers),
    );
    applyCookie(
      c,
      buildSessionCookie(
        result.sessionToken,
        result.session.expiresAt,
        c.req.raw,
      ),
    );
    const prefs = result.session.user.preferences;
    if (prefs?.onboardingCompletedAt) {
      applyCookie(c, buildThemeCookie(prefs.theme, c.req.raw));
    }
    return c.json({ user: { preferences: result.user.preferences } }, 200);
  })
  .openapi(signOut, async (c) => {
    await authService.revokeSession(sessionToken(c));
    applyCookie(c, buildClearedSessionCookie(c.req.raw));
    return c.json({ ok: true as const }, 200);
  })
  .openapi(currentSession, async (c) =>
    c.json(toSessionView(await anySession(sessionToken(c))), 200),
  )
  .openapi(requiredPassword, async (c) => {
    const session = await anySession(sessionToken(c));
    const user = await authService.changeRequiredPassword(
      session.user.id,
      session.id,
      c.req.valid("json"),
    );
    if (user.preferences?.onboardingCompletedAt) {
      applyCookie(c, buildThemeCookie(user.preferences.theme, c.req.raw));
    }
    return c.json(
      { onboardingCompleted: Boolean(user.preferences?.onboardingCompletedAt) },
      200,
    );
  })
  .openapi(preferences, async (c) => {
    const session = await anySession(sessionToken(c));
    const { theme } = await authService.savePreferences(
      session.user.id,
      c.req.valid("json"),
    );
    applyCookie(c, buildThemeCookie(theme, c.req.raw));
    return c.json({ ok: true as const }, 200);
  })
  .openapi(password, async (c) => {
    const { session } = c.var;
    await authService.changeOwnPassword(
      session.user.id,
      session.id,
      c.req.valid("json"),
    );
    return c.json({ ok: true as const }, 200);
  })
  .openapi(revokeSessions, async (c) => {
    const { session } = c.var;
    await authService.revokeOwnSessions(
      session.user.id,
      session.id,
      c.req.valid("json").sessionId,
    );
    return c.json({ ok: true as const }, 200);
  });
