import { NextRequest, NextResponse } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import { retrievalService } from "@/server/retrieval/service";
import { getWorkspaceLocationLabel } from "@/app/(workspace)/workspace-item-helpers";

const LIMIT = 8;

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
  const actor = {
    actorUserId: session.user.id,
    actorRole: session.user.role,
  };
  const items = query
    ? await retrievalService.search({ ...actor, query })
    : (await retrievalService.listRecent(actor)).filter(
        (item) => !item.deletedAt,
      );
  const usable = items.filter((item) => !item.storageMutation);
  const folders = usable.filter((item) => item.kind === "folder").slice(0, 3);
  const files = usable
    .filter((item) => item.kind === "file")
    .slice(0, LIMIT - folders.length);

  return NextResponse.json(
    {
      total: usable.length,
      // Recent activity keeps its own order, newest first.
      results: (query ? [...folders, ...files] : usable.slice(0, LIMIT)).map(
        (item) => ({
          id: item.id,
          kind: item.kind,
          name: item.name,
          href: item.href,
          mimeType: item.kind === "file" ? item.mimeType : null,
          location: getWorkspaceLocationLabel(item),
        }),
      ),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
