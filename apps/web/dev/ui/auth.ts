import { ownerOnboardingSettingsSchema } from "../../server/admin/settings-schema";
import type { Hono } from "hono";
import type { PreviewEnv } from "./state";
import { z } from "zod";
import { jsonBody } from "./request";
import { setCookie } from "hono/cookie";
import {
  PreviewError,
  requireUser,
  signedInUser,
  currentFirstRun,
  timestamp,
} from "./state";
import { checkPassword } from "./mutations";
import {
  bootstrapInputSchema,
  requiredPasswordChangeInputSchema,
  signInInputSchema,
  preferencesInputSchema,
} from "../../server/auth/schema";

export function mountAuth(app: Hono<PreviewEnv>) {
  app.get("/api/views/entry", (c) => {
    const state = c.var.state;
    const user = state.users.find((u) => u.id === state.userId);
    return c.json(
      user
        ? {
            state: "signed-in",
            instanceName: state.instanceName,
            firstRun: currentFirstRun(state),
            startPage: user.prefs.startPage,
            displayName: user.displayName,
            previews: {
              enabled: state.settings.mediaPreviewEnabled,
              onUpload: state.settings.mediaPreviewGenerateOnUpload,
              onFirstView: state.settings.mediaPreviewGenerateOnFirstView,
              onShare: state.settings.mediaPreviewGenerateOnShare,
            },
          }
        : {
            state: state.scenario === "setup" ? "setup" : "sign-in",
            instanceName: state.instanceName,
          },
    );
  });
  app.post("/api/auth/sign-in", async (c) => {
    const body = signInInputSchema.parse(await jsonBody(c.req.raw));
    const user = c.var.state.users.find((u) => u.email === body.email);
    if (!user)
      throw new PreviewError(
        401,
        "Use a sample account from the preview controls page.",
      );
    checkPassword(body.password, c.var.state.passwords.get(user.id));
    c.var.state.userId = user.id;
    return c.json({
      user: {
        preferences: { ...user.prefs, onboardingCompletedAt: timestamp },
      },
    });
  });
  app.post("/api/auth/sign-out", (c) => {
    c.var.state.userId = null;
    return c.req.header("accept")?.includes("text/html")
      ? c.redirect("/", 303)
      : c.json({ ok: true });
  });
  app.post("/api/auth/setup", async (c) => {
    const body = bootstrapInputSchema.parse(await jsonBody(c.req.raw));
    const user = c.var.state.users[0]!;
    user.email = body.email;
    user.displayName = body.displayName ?? "Alex Morgan";
    c.var.state.passwords.set(user.id, body.password);
    c.var.state.instanceName = body.instanceName;
    c.var.state.userId = user.id;
    c.var.state.scenario = "owner";
    c.var.state.firstRuns.set(user.id, "owner");
    return c.json({ user, session: { id: "current", user } }, 201);
  });
  app.post("/api/auth/password-change-required", async (c) => {
    const user = signedInUser(c.var.state);
    const body = requiredPasswordChangeInputSchema.parse(
      await jsonBody(c.req.raw),
    );
    if (body.password !== body.confirmPassword)
      throw new PreviewError(400, "Passwords do not match.");
    c.var.state.passwords.set(user.id, body.password);
    const nextStep =
      currentFirstRun(c.var.state) === "member-password" ? "member" : null;
    c.var.state.firstRuns.delete(user.id);
    if (nextStep) c.var.state.firstRuns.set(user.id, nextStep);
    return c.json({ onboardingCompleted: !nextStep });
  });
  app.post("/api/user/preferences", async (c) => {
    const body = preferencesInputSchema.parse(await jsonBody(c.req.raw));
    const user = signedInUser(c.var.state);
    const { displayName, avatarUrl, ...prefs } = body;
    Object.assign(user.prefs, prefs);
    if (displayName !== undefined) user.displayName = displayName;
    if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;
    const step = currentFirstRun(c.var.state);
    if (step === "password" || step === "member-password")
      c.var.state.firstRuns.set(user.id, "password");
    else c.var.state.firstRuns.delete(user.id);
    if (body.theme)
      setCookie(c, "staaash_theme", body.theme, { path: "/", sameSite: "Lax" });
    return c.json({ ok: true });
  });
  app.post("/api/auth/onboarding/settings", async (c) => {
    const state = c.var.state;
    if (
      signedInUser(state).role !== "owner" ||
      currentFirstRun(state) === "password" ||
      currentFirstRun(state) === "member-password"
    )
      throw new PreviewError(403, "Owner access required.");
    const settings = ownerOnboardingSettingsSchema.parse(
      await jsonBody(c.req.raw),
    );
    Object.assign(state.settings, settings);
    return c.json({ ok: true });
  });
  app.get("/auth/device-callback", (c) => c.redirect("/", 303));
  app.use("/api/*", async (c, next) => {
    requireUser(c.var.state);
    await next();
  });
  app.post("/api/user/password", async (c) => {
    const body = requiredPasswordChangeInputSchema
      .extend({ currentPassword: z.string() })
      .parse(await jsonBody(c.req.raw));
    checkPassword(
      body.currentPassword,
      c.var.state.passwords.get(c.var.state.userId!),
    );
    if (body.password !== body.confirmPassword)
      throw new PreviewError(400, "Passwords do not match.");
    c.var.state.passwords.set(c.var.state.userId!, body.password);
    return c.json({ ok: true });
  });
  app.post("/api/user/sessions/revoke", async (c) => {
    const body = await jsonBody(c.req.raw);
    c.var.state.sessions = c.var.state.sessions.filter(
      (id) =>
        id === "current" ||
        (typeof body.sessionId === "string" && id !== body.sessionId),
    );
    return c.json({ ok: true });
  });
  app.get("/api/auth/session", (c) =>
    c.json({
      id: "current",
      user: requireUser(c.var.state),
      expiresAt: "2036-10-29T12:00:00.000Z",
    }),
  );
  app.post("/api/auth/device/approve", (c) =>
    c.json({ redirectUrl: "/settings" }),
  );
}
