import { headers } from "next/headers";

import { requireSignedInPageSession } from "@/server/auth/guards";
import { filesService } from "@/server/files/service";
import { getShareBaseUrl } from "@/server/request";

import { FilesView } from "./files-view";
import { loadFilesViewProps } from "./load-files-view";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  const [session, h] = await Promise.all([
    requireSignedInPageSession("/?next=/files"),
    headers(),
  ]);
  const baseUrl = getShareBaseUrl(h);
  const listing = await filesService.getFilesListing({
    actorUserId: session.user.id,
    actorRole: session.user.role,
  });
  const props = await loadFilesViewProps({
    actorUserId: session.user.id,
    actorRole: session.user.role,
    listing,
    baseUrl,
    showFolderPreviews: session.user.preferences?.showFolderPreviews ?? true,
  });

  return <FilesView {...props} currentPath="/files" />;
}
