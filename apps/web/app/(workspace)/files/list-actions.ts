"use server";

import { getViewerWindow } from "@/server/files/viewer-window";
import { headers } from "next/headers";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { filesService } from "@/server/files/service";
import { getListWindow, type ListQuery } from "@/server/list-window";
import { getShareBaseUrl } from "@/server/request";
import { folderBatchItems } from "./folder-batch";
import { loadFilesViewProps } from "./load-files-view";

export async function loadFolderBatch(folderId: string, query: ListQuery) {
  const [session, h] = await Promise.all([
    requireSignedInPageSession(),
    headers(),
  ]);
  const actor = { actorUserId: session.user.id, actorRole: session.user.role };
  const listing = await filesService.getFilesListing({
    ...actor,
    folderId,
    query,
  });
  const props = await loadFilesViewProps({
    ...actor,
    listing,
    baseUrl: getShareBaseUrl(h),
    showFolderPreviews: session.user.preferences?.showFolderPreviews ?? true,
  });
  return folderBatchItems(props);
}

export async function loadFolderSelection(folderId: string, query: ListQuery) {
  const [session, h] = await Promise.all([
    requireSignedInPageSession(),
    headers(),
  ]);
  const actor = { actorUserId: session.user.id, actorRole: session.user.role };
  const refs = await getListWindow({
    userId: session.user.id,
    scope: "folder",
    folderId,
    query: { sort: "name", direction: "asc", ...query, offset: 0 },
    all: true,
  });
  const items: Awaited<ReturnType<typeof loadFolderBatch>>["items"] = [];
  for (let offset = 0; offset < refs.items.length; offset += 1000) {
    const listing = await filesService.getFilesListing({
      ...actor,
      folderId,
      selected: {
        total: refs.total,
        items: refs.items.slice(offset, offset + 1000),
      },
    });
    const props = await loadFilesViewProps({
      ...actor,
      listing,
      baseUrl: getShareBaseUrl(h),
      showFolderPreviews: session.user.preferences?.showFolderPreviews ?? true,
    });
    items.push(...folderBatchItems(props).items);
  }
  return { items, total: items.length };
}

export async function loadViewerBatch(folderId: string, offset: number) {
  const session = await requireSignedInPageSession();
  return getViewerWindow(session.user.id, folderId, { offset });
}
