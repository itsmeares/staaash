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

const bodySchema = z.object({ sessionId: z.string().min(1).optional() });

/** Signs out one of your other devices, or all of them when no id is sent. */
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
    const { sessionId } = bodySchema.parse(await readJsonBody(request));
    await authService.revokeOwnSessions(session.user.id, session.id, sessionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
