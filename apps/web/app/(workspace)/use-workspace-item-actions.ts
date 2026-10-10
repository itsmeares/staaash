"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { submitStorageMutationPost } from "@/app/storage-mutation-submit";
import { startValidatedDownload } from "@/lib/transfers/download";

import { useTransferContext } from "./transfer-context";

/** The fields Recent, Favorites and Search all carry for each item. */
export type WorkspaceActionItem = {
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
  const [error, setError] = useState<string | null>(null);
  const [trashedIds, setTrashedIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(timer);
  }, [error]);

  const refresh = () => startTransition(() => router.refresh());
  const fail = (caught: unknown, fallback: string) =>
    setError(caught instanceof Error ? caught.message : fallback);

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
        fail(caught, "File download failed");
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
    const results = await Promise.allSettled(
      targets.map((item) =>
        submitStorageMutationPost({
          action: `/api/files/${kindPath(item)}/${item.id}/trash`,
          fields: { redirectTo },
          logicalAction: `${redirectTo}:trash:${item.kind}:${item.id}`,
        }),
      ),
    );
    const failed = new Set(
      targets
        .filter((_, index) => results[index]!.status === "rejected")
        .map((t) => t.id),
    );
    if (failed.size > 0) {
      setTrashedIds(
        (current) => new Set([...current].filter((id) => !failed.has(id))),
      );
      setError("Some items could not be moved to trash.");
    }
    if (failed.size < targets.length) refresh();
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
      fail(caught, "Restore failed.");
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
    error,
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
