import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildOnboardedCookie,
  buildThemeCookie,
  getSessionTokenFromCookieStore,
} from "@/server/auth/session";
import { authService } from "@/server/auth/service";
import { isSameOrigin, jsonErrorResponse } from "@/server/auth/http";

const preferencesSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).default("system"),
  showUpdateNotifications: z.boolean().default(true),
  enableVersionChecks: z.boolean().default(true),
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

    await authService.savePreferences(session.user.id, parsed);

    const response = NextResponse.json({ ok: true });
    response.cookies.set(buildOnboardedCookie());
    response.cookies.set(buildThemeCookie(parsed.theme));
    return response;
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
