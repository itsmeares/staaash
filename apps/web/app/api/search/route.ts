import { NextRequest, NextResponse } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import { retrievalService } from "@/server/retrieval/service";
import { getWorkspaceLocationLabel } from "@/app/(workspace)/workspace-item-helpers";

const LIMIT = 8;

/** The top bar's instant results: a few folders, then files. */
export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const items = query
    ? await retrievalService.search({
        actorUserId: session.user.id,
        actorRole: session.user.role,
        query,
      })
    : [];
  const usable = items.filter((item) => !item.storageMutation);
  const folders = usable.filter((item) => item.kind === "folder").slice(0, 3);
  const files = usable
    .filter((item) => item.kind === "file")
    .slice(0, LIMIT - folders.length);

  return NextResponse.json(
    {
      total: usable.length,
      results: [...folders, ...files].map((item) => ({
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
