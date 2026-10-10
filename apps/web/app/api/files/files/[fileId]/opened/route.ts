import { NextRequest, NextResponse } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/auth/http";
import { recordFileAccessBestEffort } from "@/server/retrieval/recent-tracking";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

// The viewer opens over the list without loading the viewer page, so it
// reports the open here for Recent on Home.
export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }
  const session = await getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { fileId } = await params;
  await recordFileAccessBestEffort({
    actorUserId: session.user.id,
    actorRole: session.user.role,
    fileId,
    source: "files-viewer-overlay",
  });
  return new NextResponse(null, { status: 204 });
}
