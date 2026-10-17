import type {
  RecentAction,
  RecentRetrievalItem,
  RetrievalItem,
} from "@/server/retrieval/types";

import {
  compareListItems,
  filterWorkspaceItems,
  sortWorkspaceItems,
  type WorkspaceItemFilterType,
  type WorkspaceSortDirection,
  toWorkspaceListFields,
} from "../workspace-item-helpers";

export type RecentClientItem = {
  deletedAt: string | null;
  folderId?: string | null;
  href: string;
  id: string;
  isFavorite: boolean;
  kind: RetrievalItem["kind"];
  locationLabel: string;
  color?: string | null;
  mimeType?: string;
  name: string;
  parentId?: string | null;
  sizeBytes?: number;
  storageMutationStatus?: string;
  /** When it was added, or last used in activity lists. */
  at: string;
  lastAction?: RecentAction | null;
};

export type RecentFilterType = WorkspaceItemFilterType;

export type RecentSortKey = "name" | "path" | "size" | "at";
export type RecentSortDirection = WorkspaceSortDirection;

export function toRecentClientItem(item: RetrievalItem): RecentClientItem {
  return {
    ...toWorkspaceListFields(item),
    deletedAt: item.deletedAt?.toISOString() ?? null,
    isFavorite: item.isFavorite,
    at: item.updatedAt.toISOString(),
  };
}

export const toActivityClientItem = (
  item: RecentRetrievalItem,
): RecentClientItem => ({
  ...toRecentClientItem(item),
  at: item.lastInteractedAt.toISOString(),
  lastAction: item.lastAction,
});

export const ACTION_LABELS: Record<RecentAction, string> = {
  opened: "Opened",
  uploaded: "Uploaded",
  created: "Created",
  renamed: "Renamed",
  moved: "Moved here",
  downloaded: "Downloaded",
  trashed: "Trashed",
  restored: "Restored",
};

/** A row of the activity list: one item, or a burst of them as one row. */
export type ActivityRow = RecentClientItem & { batch?: RecentClientItem[] };

const BATCHED = new Set<RecentAction>(["uploaded", "moved"]);
const BATCH_MIN = 4;
const BATCH_GAP_MS = 10 * 60_000;

const parentOf = (item: RecentClientItem) =>
  (item.kind === "file" ? item.folderId : item.parentId) ?? null;

const continues = (last: RecentClientItem, item: RecentClientItem) =>
  !last.deletedAt &&
  !item.deletedAt &&
  item.lastAction != null &&
  BATCHED.has(item.lastAction) &&
  item.lastAction === last.lastAction &&
  parentOf(item) === parentOf(last) &&
  Date.parse(last.at) - Date.parse(item.at) <= BATCH_GAP_MS;

/**
 * Uploads or moves into one folder close together (newest first, a few
 * minutes apart) become one row, so 200 photos don't bury everything else.
 */
export function batchActivity(items: RecentClientItem[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  let run: RecentClientItem[] = [];
  const flush = () => {
    const [first] = run;
    if (first && run.length >= BATCH_MIN) {
      rows.push({ ...first, id: `batch:${first.id}`, batch: run });
    } else {
      rows.push(...run);
    }
    run = [];
  };
  for (const item of items) {
    const last = run.at(-1);
    if (!last || !continues(last, item)) flush();
    run.push(item);
  }
  flush();
  return rows;
}

const nounFor = (items: RecentClientItem[]) => {
  if (items.every((item) => item.mimeType?.startsWith("image/")))
    return "photos";
  if (items.every((item) => item.mimeType?.startsWith("video/")))
    return "videos";
  return items.every((item) => item.kind === "file") ? "files" : "items";
};

/** "Uploaded 12 photos to Wallpapers". */
export function batchLabel(row: ActivityRow) {
  const items = row.batch ?? [row];
  const verb = row.lastAction === "moved" ? "Moved" : "Uploaded";
  const folder = row.locationLabel.split(" / ").at(-1);
  return `${verb} ${items.length} ${nounFor(items)} to ${folder === "/" ? "Files" : folder}`;
}

export function filterRecentItems(
  items: RecentClientItem[],
  filterType: RecentFilterType,
): RecentClientItem[] {
  return filterWorkspaceItems(items, filterType);
}

export function sortRecentItems(
  items: RecentClientItem[],
  sortKey: RecentSortKey,
  sortDirection: RecentSortDirection,
): RecentClientItem[] {
  return sortWorkspaceItems(
    items,
    sortDirection,
    compareListItems(sortKey, (item: RecentClientItem) => item.at),
  );
}
