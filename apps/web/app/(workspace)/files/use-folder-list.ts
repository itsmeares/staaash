"use client";

import { useMemo, useState } from "react";
import { useContinuousList } from "@/components/file-list/use-continuous-list";
import { useListFind } from "@/components/file-list/use-list-find";
import { useListSort } from "@/components/file-list/use-list-sort";
import type { WorkspaceItemFilterType } from "../workspace-item-helpers";
import { folderBatchItems } from "./folder-batch";
import { loadFolderBatch, loadFolderSelection } from "./list-actions";

type FolderBatchItem = ReturnType<typeof folderBatchItems>["items"][number];
type FolderListProps = Parameters<typeof folderBatchItems>[0];

function listingFromBatch(
  initial: FolderListProps["listing"],
  items: FolderBatchItem[],
  total: number,
) {
  return {
    ...initial,
    total,
    childFolders: items.flatMap((item) =>
      item.kind === "folder" ? [item.data] : [],
    ),
    files: items.flatMap((item) => (item.kind === "file" ? [item.data] : [])),
    folderPreviews: Object.fromEntries(
      items.map((item) => [item.id, item.previews]),
    ),
  };
}

function batchFlags(
  initial: FolderListProps["shareLookup"],
  items: FolderBatchItem[],
) {
  const shared = items.filter((item) => item.share !== null);
  return {
    shareLookup: {
      currentFolderShare: initial.currentFolderShare,
      sharesByFolderId: Object.fromEntries(
        shared
          .filter((item) => item.kind === "folder")
          .map((item) => [item.id, item.share!]),
      ),
      sharesByFileId: Object.fromEntries(
        shared
          .filter((item) => item.kind === "file")
          .map((item) => [item.id, item.share!]),
      ),
    },
    favoriteFileIds: items
      .filter((item) => item.kind === "file" && item.favorite)
      .map((item) => item.id),
    favoriteFolderIds: items
      .filter((item) => item.kind === "folder" && item.favorite)
      .map((item) => item.id),
  };
}

export function useFolderList(props: FolderListProps) {
  const sort = useListSort<"name" | "size" | "modified">("name", "asc");
  const [filterType, setFilterType] = useState<WorkspaceItemFilterType>("all");
  const finder = useListFind("Find in this folder");
  const query = {
    sort: sort.key,
    direction: sort.direction,
    filter: filterType,
    find: finder.find,
  };
  const initial = useMemo(
    () => folderBatchItems(props),
    [
      props.listing,
      props.shareLookup,
      props.showFolderPreviews,
      props.favoriteFileIds,
      props.favoriteFolderIds,
      props.folderSizeBytes,
    ],
  );
  const continuous = useContinuousList({
    name: props.listing.currentFolder.id,
    items: initial.items,
    total: initial.total,
    query,
    load: (next) => loadFolderBatch(props.listing.currentFolder.id, next),
    select: (next) => loadFolderSelection(props.listing.currentFolder.id, next),
  });
  const listing = useMemo(
    () => listingFromBatch(props.listing, continuous.items, continuous.total),
    [props.listing, continuous.items, continuous.total],
  );
  return {
    continuous,
    listing,
    sort,
    filterType,
    setFilterType,
    finder,
    ...batchFlags(props.shareLookup, continuous.items),
  };
}
