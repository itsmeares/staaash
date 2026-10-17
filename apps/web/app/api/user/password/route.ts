// Mutation routes intentionally share origin, auth, and response guards.
// fallow-ignore-file code-duplication
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  isSameOrigin,
  jsonErrorResponse,
  readJsonBody,
} from "@/server/auth/http";
import { getRequestSession } from "@/server/auth/guards";
import { authService } from "@/server/auth/service";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  password: z.string(),
  confirmPassword: z.string(),
});

/** Changes your own password; other devices are signed out. */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }
  const session = await getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  try {
    const body = bodySchema.parse(await readJsonBody(request));
    await authService.changeOwnPassword(session.user.id, session.id, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
