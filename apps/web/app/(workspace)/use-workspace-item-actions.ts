"use client";

import { Download, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { submitStorageMutationPost } from "@/app/storage-mutation-submit";
import { buildItemActions } from "@/components/file-list/item-actions";
import { toast } from "@/components/ui/toast";
import { startValidatedDownload } from "@/lib/transfers/download";

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
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { handleDownload } = useTransferContext();
  const [trashedIds, setTrashedIds] = useState<ReadonlySet<string>>(new Set());

  const refresh = () => startTransition(() => router.refresh());
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
    if (item.href.startsWith("/files")) router.push(item.href);
    else void download([item]);
  };

  const showInFolder = (item: WorkspaceActionItem) => {
    const parent = item.kind === "file" ? item.folderId : item.parentId;
    router.push(parent ? `/files/f/${parent}` : "/files");
  };

  const trash = async (items: WorkspaceActionItem[]) => {
    const targets = items.filter((item) => !item.storageMutationStatus);
    if (targets.length === 0) return;
    setTrashedIds(
      (current) => new Set([...current, ...targets.map((t) => t.id)]),
    );
    const moved = await moveTrash(targets, "trash", redirectTo);
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
    refresh();
    showUndo({
      items: moved,
      done: "trash",
      redirectTo,
      onUndone: () => {
        const back = new Set(moved.map((t) => t.id));
        setTrashedIds(
          (current) => new Set([...current].filter((id) => !back.has(id))),
        );
        refresh();
      },
    });
  };

  const restore = async (item: WorkspaceActionItem) => {
    try {
      await submitStorageMutationPost({
        action: `/api/files/${kindPath(item)}/${item.id}/restore`,
        fields: { redirectTo },
        logicalAction: `${redirectTo}:restore:${item.kind}:${item.id}`,
      });
      setTrashedIds(
        (current) => new Set([...current].filter((id) => id !== item.id)),
      );
      refresh();
    } catch (caught) {
      fail(caught, "Restore failed.", () => void restore(item));
    }
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
      refresh();
      return true;
    } catch (caught) {
      fail(caught, "Favorite could not be updated.");
      return false;
    }
  };

  return {
    trashedIds,
    open,
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
    trash: () => {
      void actions.trash(targets);
      onTrashed?.();
    },
    ...extra,
  });
};

/** Download and Trash for the selection bar. */
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
    label: "Trash",
    icon: Trash2,
    destructive: true,
    onClick: () => {
      void actions.trash(selected);
      onTrashed();
    },
  },
];
