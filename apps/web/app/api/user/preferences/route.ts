// Mutation routes intentionally share origin, auth, and response guards.
// fallow-ignore-file code-duplication
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildOnboardedCookie,
  buildThemeCookie,
  getSessionTokenFromCookieStore,
} from "@/server/auth/session";
import { authService } from "@/server/auth/service";
import {
  isSameOrigin,
  jsonErrorResponse,
  readJsonBody,
} from "@/server/auth/http";
import { AUTO_TIME_ZONE, isValidTimeZone } from "@staaash/config/time-zone";

const preferencesSchema = z.object({
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
    const parsed = preferencesSchema.parse(await readJsonBody(request));
    const { theme } = await authService.savePreferences(
      session.user.id,
      parsed,
    );

    const response = NextResponse.json({ ok: true });
    response.cookies.set(buildOnboardedCookie(request));
    response.cookies.set(buildThemeCookie(theme, request));
    return response;
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
