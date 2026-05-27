import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildOnboardedCookie,
  buildThemeCookie,
  getSessionTokenFromCookieStore,
} from "@/server/auth/session";
import { authService } from "@/server/auth/service";
import { isSameOrigin, jsonErrorResponse } from "@/server/auth/http";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "@staaash/config/time-zone";

const preferencesSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  timeZone: z
    .string()
    .trim()
    .refine(isValidTimeZone, "Invalid time zone.")
    .optional(),
  showUpdateNotifications: z.boolean().optional(),
  enableVersionChecks: z.boolean().optional(),
  displayName: z.string().trim().max(80).nullable().optional(),
  avatarUrl: z.string().max(300000).nullable().optional(),
});

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const session = await authService.getSession(
    getSessionTokenFromCookieStore(request.cookies),
  );

  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = preferencesSchema.parse(body);
    const existingPrefs = session.user.preferences;
    const theme = parsed.theme ?? existingPrefs?.theme ?? "system";
    const timeZone =
      parsed.timeZone ?? existingPrefs?.timeZone ?? DEFAULT_TIME_ZONE;

    await authService.savePreferences(session.user.id, {
      theme,
      timeZone,
      showUpdateNotifications:
        parsed.showUpdateNotifications ??
        existingPrefs?.showUpdateNotifications ??
        true,
      enableVersionChecks:
        parsed.enableVersionChecks ??
        existingPrefs?.enableVersionChecks ??
        true,
      displayName: parsed.displayName,
      avatarUrl: parsed.avatarUrl,
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set(buildOnboardedCookie());
    response.cookies.set(buildThemeCookie(theme));
    return response;
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
