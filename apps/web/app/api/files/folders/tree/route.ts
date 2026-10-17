import { NextRequest, NextResponse } from "next/server";

import { authService } from "@/server/auth/service";
import { getRequestSession } from "@/server/auth/guards";
import { jsonErrorResponse, jsonNotSignedInResponse } from "@/server/auth/http";
import { filesService } from "@/server/files/service";

/** The signed-in person's folders, for the move picker. */
export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return jsonNotSignedInResponse();
  try {
    const [folders, setup] = await Promise.all([
      filesService.listFolderTree({
        actorUserId: session.user.id,
        actorRole: session.user.role,
      }),
      authService.getSetupState(),
    ]);
    return NextResponse.json(
      { instanceName: setup.instanceName?.trim() || "Staaash", folders },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
