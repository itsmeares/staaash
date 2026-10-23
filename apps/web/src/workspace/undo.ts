
import { submitStorageMutationPost } from "@/src/storage-mutation-submit";
import { toastManager } from "@staaash/ui/components/toast";

type Item = { id: string; kind: "file" | "folder" };

const kindPath = (item: Item) => (item.kind === "folder" ? "folders" : "files");

/** Moves items into or out of trash; resolves with the ones that made it. */
export async function moveTrash(
  items: Item[],
  action: "trash" | "restore",
) {
  const results = await Promise.allSettled(
    items.map((item) =>
      submitStorageMutationPost({
        action: `/api/files/${kindPath(item)}/${item.id}/${action}`,
        logicalAction: `${action}:${item.kind}:${item.id}`,
      }),
    ),
  );
  return items.filter((_, index) => results[index]!.status === "fulfilled");
}

/**
 * Trash and restore act at once; this toast is the way back. Undo runs the
 * opposite move on the same items.
 */
export function showUndo({
  items,
  done,
  onUndone,
}: {
  items: Item[];
  done: "trash" | "restore";
  onUndone: () => void;
}) {
  if (items.length === 0) return;
  const what = items.length === 1 ? "1 item" : `${items.length} items`;
  toastManager.add({
    title: done === "trash" ? `Moved ${what} to trash` : `Restored ${what}`,
    actionProps: {
      children: "Undo",
      onClick: () => {
        void moveTrash(items, done === "trash" ? "restore" : "trash").then(
          onUndone,
        );
      },
    },
  });
}
