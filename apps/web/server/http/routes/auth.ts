import { createRoute, z } from "@hono/zod-openapi";
import { AUTO_TIME_ZONE, isValidTimeZone } from "@staaash/config/time-zone";

import type { Context } from "hono";
import { validator } from "hono/validator";

import { canAccessAdminSurface } from "@/server/access";
import {
  ownerOnboardingSettingsSchema,
  saveOwnerOnboardingSettings,
} from "@/server/admin/settings";
import {
  approveDevice,
  exchangeDeviceCode,
  issueWebSessionCode,
  redeemWebSessionCode,
} from "@/server/auth/device";
import { AuthError } from "@/server/auth/errors";
import { authService } from "@/server/auth/service";
import type { AuthSession } from "@/server/auth/types";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  buildThemeCookie,
} from "@/server/auth/session";
import {
  applyCookie,
  errorResponses,
  requireDevice,
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
import { getBaseUrl, getRequestSessionMetadata } from "@/server/request";

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

const DeviceTokenBody = z.object({
  code: z.string().min(1),
  codeVerifier: z.string().min(43).max(128),
  redirectUri: z.string(),
});

const deviceToken = createRoute({
  method: "post",
  path: "/api/auth/device/token",
  tags: ["Devices"],
  summary:
    "Trade the code from the loopback redirect, plus the PKCE verifier, for a device token. Send it as `Authorization: Bearer <token>`.",
  request: { body: jsonBody(DeviceTokenBody) },
  responses: {
    200: json(
      z.object({
        token: z.string(),
        session: SessionSchema,
      }),
      "Signed in. The token stays valid while the device keeps using it.",
    ),
    ...errorResponses,
  },
});

const deviceWebSession = createRoute({
  method: "post",
  path: "/api/auth/device/web-session",
  tags: ["Devices"],
  summary:
    "A one-time code that signs the device's app window in. Open `url` within a minute; signing the device out also signs the window out.",
  middleware: [requireUser, requireDevice],
  responses: {
    200: json(
      z.object({ code: z.string(), url: z.string(), expiresAt: z.date() }),
      "Open the URL in the app window.",
    ),
    ...errorResponses,
  },
});

const DeviceApproveBody = z.object({
  redirectUri: z.string(),
  codeChallenge: z.string().regex(/^[\w-]{43}$/, "Invalid code challenge."),
  deviceName: z.string().trim().min(1).max(80),
});

/** Only a redirect back into this app counts; anything else goes home. */
const localPath = (value: string | undefined) =>
  value?.startsWith("/") && !/^\/[/\\]/.test(value) ? value : "/";

/** The session cookie, and the theme cookie once onboarding is done. */
const setSignedInCookies = (
  c: Context,
  { sessionToken, session }: { sessionToken: string; session: AuthSession },
) => {
  applyCookie(
    c,
    buildSessionCookie(sessionToken, session.expiresAt, c.req.raw),
  );
  const prefs = session.user.preferences;
  if (prefs?.onboardingCompletedAt) {
    applyCookie(c, buildThemeCookie(prefs.theme, c.req.raw));
  }
};

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
    setSignedInCookies(c, result);
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
    setSignedInCookies(c, result);
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
  .openapi(deviceToken, async (c) => {
    const result = await exchangeDeviceCode(
      c.req.valid("json"),
      getRequestSessionMetadata(c.req.raw.headers),
    );
    return c.json(
      { token: result.sessionToken, session: toSessionView(result.session) },
      200,
    );
  })
  .openapi(deviceWebSession, async (c) => {
    const { session } = c.var;
    const { code, expiresAt } = await issueWebSessionCode({
      id: session.id,
      userId: session.user.id,
    });
    const url = new URL("/auth/device-callback", getBaseUrl(c.req.raw.headers));
    url.searchParams.set("code", code);
    return c.json({ code, url: url.toString(), expiresAt }, 200);
  })
  .openapi(revokeSessions, async (c) => {
    const { session } = c.var;
    await authService.revokeOwnSessions(
      session.user.id,
      session,
      c.req.valid("json").sessionId,
    );
    return c.json({ ok: true as const }, 200);
  })
  // The owner's first-run choices, saved before onboarding is finished. Not
  // part of the public contract.
  .post(
    "/api/auth/onboarding/settings",
    validator("json", (value) => ownerOnboardingSettingsSchema.parse(value)),
    async (c) => {
      const session = await anySession(sessionToken(c));
      if (
        session.user.passwordChangeRequiredAt ||
        !session.user.isOwner ||
        !canAccessAdminSurface(session.user.role)
      ) {
        throw new AuthError("ACCESS_DENIED");
      }
      await saveOwnerOnboardingSettings(c.req.valid("json"));
      return c.json({ ok: true as const });
    },
  )
  // The approval page's button. A browser session approves, never a device.
  .post(
    "/api/auth/device/approve",
    requireUser,
    validator("json", (value) => DeviceApproveBody.parse(value)),
    async (c) => {
      const { session } = c.var;
      if (session.deviceName) throw new AuthError("ACCESS_DENIED");
      return c.json(
        await approveDevice({
          userId: session.user.id,
          ...c.req.valid("json"),
        }),
      );
    },
  )
  // The app window lands here with its one-time code and leaves signed in.
  .get("/auth/device-callback", async (c) => {
    const code = c.req.query("code");
    if (!code) return c.redirect("/", 303);
    const result = await redeemWebSessionCode(
      code,
      getRequestSessionMetadata(c.req.raw.headers),
    ).catch(() => null);
    if (!result) return c.redirect("/", 303);
    setSignedInCookies(c, result);
    return c.redirect(localPath(c.req.query("next")), 303);
  });
