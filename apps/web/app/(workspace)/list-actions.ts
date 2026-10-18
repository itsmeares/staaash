"use server";

import {
  getActivityPage,
  resolveActivitySelection,
} from "@/server/retrieval/activity-page";
import { headers } from "next/headers";
import { getShareBaseUrl } from "@/server/request";
import { getSharesPage } from "@/server/sharing/page";
import { filesService } from "@/server/files/service";
import { toTrashClientItems } from "./trash/trash-helpers";
import { requireSignedInPageSession } from "@/server/auth/guards";
import {
  getRetrievalPage,
  getRetrievalSelection,
} from "@/server/retrieval/page";
import { getListWindow, type ListQuery } from "@/server/list-window";
import { toFavoriteClientItem } from "./favorites/favorites-helpers";
import {
  toActivityClientItem,
  toRecentClientItem,
} from "./recent/recent-helpers";

export async function loadFavorites(query: ListQuery) {
  const session = await requireSignedInPageSession();
  const page = await getRetrievalPage(session.user.id, "favorites", query);
  return { ...page, items: page.items.map(toFavoriteClientItem) };
}

export async function loadRecent(show: "activity" | "added", query: ListQuery) {
  const session = await requireSignedInPageSession();
  if (show === "activity" && query.grouped)
    return getActivityPage(session.user.id, query);
  const page = await getRetrievalPage(
    session.user.id,
    show === "activity" ? "recent" : "added",
    query,
  );
  return {
    ...page,
    items: page.items.map(
      show === "activity" ? toActivityClientItem : toRecentClientItem,
    ),
  };
}

export async function loadTrash(query: ListQuery) {
  const session = await requireSignedInPageSession();
  const listing = await filesService.listTrashFolders({
    actorUserId: session.user.id,
    actorRole: session.user.role,
    query,
  });
  return { items: toTrashClientItems(listing), total: listing.total };
}

async function readShares(active: boolean, query: ListQuery, all = false) {
  const [session, h] = await Promise.all([
    requireSignedInPageSession(),
    headers(),
  ]);
  return getSharesPage(
    { actorUserId: session.user.id, actorRole: session.user.role },
    getShareBaseUrl(h),
    active,
    query,
    all,
  );
}

export async function loadShares(active: boolean, query: ListQuery) {
  return readShares(active, query);
}

export async function selectFavorites(query: ListQuery) {
  const session = await requireSignedInPageSession();
  const page = await getRetrievalSelection(session.user.id, "favorites", query);
  return { ...page, items: page.items.map(toFavoriteClientItem) };
}
export async function selectRecent(
  show: "activity" | "added",
  query: ListQuery,
) {
  const session = await requireSignedInPageSession();
  if (show === "activity" && query.grouped)
    return getActivityPage(session.user.id, query, true);
  const page = await getRetrievalSelection(
    session.user.id,
    show === "activity" ? "recent" : "added",
    query,
  );
  return {
    ...page,
    items: page.items.map(
      show === "activity" ? toActivityClientItem : toRecentClientItem,
    ),
  };
}
export async function selectTrash(query: ListQuery) {
  const session = await requireSignedInPageSession();
  const actor = { actorUserId: session.user.id, actorRole: session.user.role };
  const refs = await getListWindow({
    userId: session.user.id,
    scope: "trash",
    query: { ...query, offset: 0 },
    all: true,
  });
  const items: ReturnType<typeof toTrashClientItems> = [];
  for (let offset = 0; offset < refs.items.length; offset += 1000) {
    const listing = await filesService.listTrashFolders({
      ...actor,
      selected: {
        total: refs.total,
        items: refs.items.slice(offset, offset + 1000),
      },
    });
    items.push(...toTrashClientItems(listing));
  }
  return { items, total: items.length };
}

export async function resolveActivity(query: ListQuery, ids: string[]) {
  const session = await requireSignedInPageSession();
  return resolveActivitySelection(session.user.id, query, ids);
}

export async function selectShares(active: boolean, query: ListQuery) {
  return readShares(active, { ...query, offset: 0 }, true);
}
