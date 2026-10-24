import { useNavigate } from "@tanstack/react-router";
import { useRefresh } from "@/lib/use-refresh";
import { Download, FolderInput, Trash2 } from "lucide-react";
import { useState } from "react";

import { submitStorageMutationPost } from "@/src/storage-mutation-submit";
import { buildItemActions } from "@/components/file-list/item-actions";
import { toast, toastManager } from "@staaash/ui/components/toast";
import { startValidatedDownload } from "@/lib/transfers/download";

import { submitMove } from "./files/files-move";
import { chooseMoveDestination } from "./move-dialog";
import type { SelectionBarAction } from "./selection-bar";
import { useTransferContext } from "./transfer-context";
import { moveTrash, showUndo } from "./undo";

/** The fields Recent, Favorites and Search all carry for each item. */
type WorkspaceActionItem = {
  id: string;
  kind: "file" | "folder";
  name: string;
  href: string;
  storageMutationStatus?: string;
  folderId?: string | null;
  parentId?: string | null;
};

const kindPath = (item: WorkspaceActionItem) =>
  item.kind === "folder" ? "folders" : "files";

/**
 * Open, download, trash, restore and favorite for lists of items that live
 * in different folders. Trash is optimistic: `trashedIds` holds items the
 * server has not confirmed yet.
 */
export function useWorkspaceItemActions(redirectTo: string) {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const { handleDownload } = useTransferContext();
  const [trashedIds, setTrashedIds] = useState<ReadonlySet<string>>(new Set());

  const fail = (caught: unknown, fallback: string, retry?: () => void) =>
    toast.error(caught instanceof Error ? caught.message : fallback, { retry });

  const download = async (items: WorkspaceActionItem[]) => {
    const usable = items.filter((item) => !item.storageMutationStatus);
    const only = usable[0];
    if (!only) return;
    if (usable.length === 1 && only.kind === "file") {
      try {
        await startValidatedDownload(
          `/api/files/files/${only.id}/download`,
          "File download failed",
        );
      } catch (caught) {
        fail(caught, "File download failed", () => void download(items));
      }
      return;
    }
    await handleDownload(usable.map((item) => item.id));
  };

  const open = (item: WorkspaceActionItem) => {
    if (item.storageMutationStatus) return;
    if (item.href.startsWith("/files")) void navigate({ href: item.href });
    else void download([item]);
  };

  const showInFolder = (item: WorkspaceActionItem) => {
    const parent = item.kind === "file" ? item.folderId : item.parentId;
    void navigate({ href: parent ? `/files/f/${parent}` : "/files" });
  };

  const trash = async (items: WorkspaceActionItem[]) => {
    const targets = items.filter((item) => !item.storageMutationStatus);
    if (targets.length === 0) return;
    setTrashedIds(
      (current) => new Set([...current, ...targets.map((t) => t.id)]),
    );
    const moved = await moveTrash(targets, "trash");
    if (moved.length < targets.length) {
      const failed = new Set(
        targets.filter((t) => !moved.includes(t)).map((t) => t.id),
      );
      setTrashedIds(
        (current) => new Set([...current].filter((id) => !failed.has(id))),
      );
      const left = targets.filter((t) => failed.has(t.id));
      toast.error("Some items could not be moved to trash.", {
        retry: () => void trash(left),
      });
    }
    if (moved.length === 0) return;
    void refresh();
    showUndo({
      items: moved,
      done: "trash",
      onUndone: () => {
        const back = new Set(moved.map((t) => t.id));
        setTrashedIds(
          (current) => new Set([...current].filter((id) => !back.has(id))),
        );
        void refresh();
      },
    });
  };

  const restore = async (item: WorkspaceActionItem) => {
    try {
      await submitStorageMutationPost({
        action: `/api/files/${kindPath(item)}/${item.id}/restore`,
        logicalAction: `${redirectTo}:restore:${item.kind}:${item.id}`,
      });
      setTrashedIds(
        (current) => new Set([...current].filter((id) => id !== item.id)),
      );
      void refresh();
    } catch (caught) {
      fail(caught, "Restore failed.", () => void restore(item));
    }
  };

  /** Picks a folder, moves there, and offers to move everything back. */
  const move = async (items: WorkspaceActionItem[]) => {
    const targets = items.filter((item) => !item.storageMutationStatus);
    const parentOf = (item: WorkspaceActionItem) =>
      (item.kind === "file" ? item.folderId : item.parentId) ?? null;
    const destination = await chooseMoveDestination(
      targets.map((item) => ({ ...item, parentId: parentOf(item) })),
    );
    if (!destination) return;
    try {
      const result = await submitMove(
        targets.map(({ id, kind }) => ({ id, kind })),
        destination.id,
      );
      const moved = targets.filter((item) =>
        result.results.some((r) => r.id === item.id && r.status === "moved"),
      );
      void refresh();
      if (result.failedCount > 0) {
        toast.error(`${result.failedCount} could not be moved.`);
      }
      if (moved.length === 0) return;
      const what = moved.length === 1 ? "1 item" : `${moved.length} items`;
      toastManager.add({
        title: `Moved ${what} to ${destination.name}`,
        actionProps: {
          children: "Undo",
          onClick: () => void moveBack(moved, parentOf),
        },
      });
    } catch (caught) {
      fail(caught, "Items could not be moved.", () => void move(items));
    }
  };

  // Undo: each item goes back to the folder it came from.
  const moveBack = async (
    items: WorkspaceActionItem[],
    parentOf: (item: WorkspaceActionItem) => string | null,
  ) => {
    const byParent = new Map<string | null, WorkspaceActionItem[]>();
    for (const item of items) {
      byParent.set(parentOf(item), [
        ...(byParent.get(parentOf(item)) ?? []),
        item,
      ]);
    }
    try {
      for (const [parent, group] of byParent) {
        if (!parent) continue;
        await submitMove(
          group.map(({ id, kind }) => ({ id, kind })),
          parent,
        );
      }
    } catch (caught) {
      fail(caught, "Items could not be moved back.");
    }
    void refresh();
  };

  /** Favorite on or off, or pin on or off; returns whether it worked. */
  const setFavorite = async (
    item: WorkspaceActionItem,
    change: { isFavorite: boolean } | { quickAccessPinned: boolean },
  ) => {
    try {
      const response = await fetch(
        `/api/files/${kindPath(item)}/${item.id}/favorite`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...change, redirectTo }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Favorite failed (${response.status})`);
      }
      void refresh();
      return true;
    } catch (caught) {
      fail(caught, "Favorite could not be updated.");
      return false;
    }
  };

  return {
    trashedIds,
    open,
    move,
    download,
    showInFolder,
    trash,
    restore,
    setFavorite,
    refresh,
  };
}

type WorkspaceItemActions = ReturnType<typeof useWorkspaceItemActions>;

/**
 * The menu for an item outside trash: open, download, favorite, trash.
 * `extra` replaces or adds entries, like Favorites' remove and pin.
 */
export const liveItemMenu = (
  actions: WorkspaceItemActions,
  item: WorkspaceActionItem & { isFavorite?: boolean },
  targets: WorkspaceActionItem[],
  onTrashed?: () => void,
  extra?: Partial<Parameters<typeof buildItemActions>[0]>,
) => {
  const isFavorite = item.isFavorite ?? false;
  return buildItemActions({
    name: item.name,
    kind: item.kind,
    count: targets.length,
    open: () => actions.open(item),
    download: () => void actions.download(targets),
    favorite: {
      isFavorite,
      run: () => void actions.setFavorite(item, { isFavorite: !isFavorite }),
    },
    move: () => void actions.move(targets),
    trash: () => {
      void actions.trash(targets);
      onTrashed?.();
    },
    ...extra,
  });
};

/** Download, Move and Trash for the selection bar. */
export const downloadAndTrash = (
  actions: WorkspaceItemActions,
  selected: WorkspaceActionItem[],
  onTrashed: () => void,
): SelectionBarAction[] => [
  {
    label: "Download",
    icon: Download,
    onClick: () => void actions.download(selected),
  },
  {
    label: "Move",
    icon: FolderInput,
    onClick: () => {
      void actions.move(selected);
      onTrashed();
    },
  },
  {
    label: "Trash",
    icon: Trash2,
    destructive: true,
    onClick: () => {
      void actions.trash(selected);
      onTrashed();
    },
  },
];
