import { NextRequest, NextResponse } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import { getQuickResults } from "@/server/retrieval/quick";
import { getWorkspaceLocationLabel } from "@/app/(workspace)/workspace-item-helpers";

/**
 * The top bar's instant results: a few folders, then files. With no query,
 * what was opened lately, for the phone's search screen.
 */
export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const page = await getQuickResults(session.user.id, query);

  return NextResponse.json(
    {
      total: page.total,
      results: page.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        name: item.name,
        href: item.href,
        mimeType: item.kind === "file" ? item.mimeType : null,
        location: getWorkspaceLocationLabel(item),
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
