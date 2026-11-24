import { ownerOnboardingSettingsSchema } from "@/server/admin/settings-schema";
import { preferencesInputSchema } from "@/server/auth/schema";
import { createRoute, z } from "@hono/zod-openapi";

import type { Context } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { validator } from "hono/validator";

import { env } from "@/lib/env";
import { getAuthSecret } from "@/server/auth/crypto";
import { getRequestSession } from "@/server/auth/guards";
import {
  finishOidc,
  OIDC_FLOW_COOKIE_NAME,
  OIDC_FLOW_MAX_AGE_SECONDS,
  redeemOidcInvite,
  startOidc,
} from "@/server/auth/oidc";
import { resolveSecureCookie } from "@/server/cookie-security";

import { canAccessAdminSurface } from "@/server/access";
import { saveOwnerOnboardingSettings } from "@/server/admin/settings";
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
  responses: {
    200: json(OkSchema, "Signed out."),
    303: { description: "A form post goes back to the sign-in page." },
    ...errorResponses,
  },
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

const preferences = createRoute({
  method: "post",
  path: "/api/user/preferences",
  tags: ["Account"],
  summary: "Save preferences. Saving them also finishes onboarding.",
  request: { body: jsonBody(preferencesInputSchema) },
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

const oidcCookieOptions = (c: Context) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: resolveSecureCookie(c.req.raw),
  path: "/api/auth/oidc",
});

/** Back to a page with the reason in `?error=`, which the page shows. */
const failedOidc = (
  c: Context,
  path: string,
  error: unknown,
  next?: string | null,
) => {
  if (!(error instanceof AuthError)) console.error("[oidc]", error);
  const params = new URLSearchParams({
    error:
      error instanceof AuthError
        ? error.message
        : "Single sign-on is not reachable right now. Try again.",
  });
  if (next) params.set("next", next);
  return c.redirect(`${path}?${params}`, 303);
};

/** Off to the provider, remembering the trip in a short-lived cookie. */
const goToProvider = async (
  c: Context,
  options: Parameters<typeof startOidc>[2],
) => {
  if (!env.oidc) throw new AuthError("OIDC_DISABLED");
  const { url, cookie } = await startOidc(
    env.oidc,
    await getAuthSecret(),
    options,
  );
  applyCookie(c, {
    name: OIDC_FLOW_COOKIE_NAME,
    value: cookie,
    maxAge: OIDC_FLOW_MAX_AGE_SECONDS,
    ...oidcCookieOptions(c),
  });
  return c.redirect(url, 303);
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
    // The account menus sign out with a plain form, which expects a page.
    if (c.req.header("accept")?.includes("text/html")) {
      return c.redirect("/", 303);
    }
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
  // Browser redirects for single sign-on, not JSON, so they stay out of
  // openapi.json. An invite link from the owner starts here too.
  .get("/api/auth/oidc/start", async (c) => {
    const next = c.req.query("next") ? localPath(c.req.query("next")) : null;
    return goToProvider(c, {
      next,
      connectUserId: null,
      invite: c.req.query("invite") || null,
    }).catch((error: unknown) => failedOidc(c, "/", error, next));
  })
  // Settings' Connect button, a same-origin form post.
  .post("/api/auth/oidc/connect", requireUser, async (c) => {
    const { session } = c.var;
    if (session.deviceName) throw new AuthError("ACCESS_DENIED");
    return goToProvider(c, {
      next: null,
      connectUserId: session.user.id,
      invite: null,
    }).catch((error: unknown) => failedOidc(c, "/settings", error));
  })
  .get("/api/auth/oidc/callback", async (c) => {
    const cookie = getCookie(c, OIDC_FLOW_COOKIE_NAME);
    deleteCookie(c, OIDC_FLOW_COOKIE_NAME, oidcCookieOptions(c));
    if (!env.oidc) return c.redirect("/", 303);
    const { providerName } = env.oidc;
    let finished: Awaited<ReturnType<typeof finishOidc>>;
    try {
      finished = await finishOidc(
        env.oidc,
        await getAuthSecret(),
        cookie,
        new URL(c.req.url).search,
      );
    } catch (error) {
      return failedOidc(c, "/", error);
    }
    const { identity, flow } = finished;

    if (flow.connectUserId) {
      try {
        const session = await getRequestSession(sessionToken(c));
        if (session?.user.id !== flow.connectUserId) {
          throw new AuthError("NOT_SIGNED_IN");
        }
        await authService.connectOidc(session.user.id, identity);
      } catch (error) {
        return failedOidc(c, "/settings", error);
      }
      const done = new URLSearchParams({
        success: `Connected to ${providerName}`,
      });
      return c.redirect(`/settings?${done}`, 303);
    }

    try {
      const invitedUserId = flow.invite
        ? await redeemOidcInvite(flow.invite)
        : null;
      const result = await authService.signInWithOidc(
        identity,
        invitedUserId,
        getRequestSessionMetadata(c.req.raw.headers),
      );
      setSignedInCookies(c, result);
    } catch (error) {
      return failedOidc(c, "/", error, flow.next);
    }
    return c.redirect(localPath(flow.next ?? undefined), 303);
  })
  // Settings' Disconnect. Only while a password still lets them back in.
  .post("/api/user/oidc/disconnect", requireUser, async (c) => {
    await authService.disconnectOwnOidc(c.var.session.user.id);
    return c.json({ ok: true as const });
  })
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
