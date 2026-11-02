import { submitStorageMutationPost } from "@/src/storage-mutation-submit";
import { toastManager } from "@staaash/ui/components/toast";

type Item = { id: string; kind: "file" | "folder" };

const kindPath = (item: Item) => (item.kind === "folder" ? "folders" : "files");

// Select all can hold a whole folder; a few requests at a time keeps the
// server and the browser responsive instead of opening one per item at once.
const TRASH_CONCURRENCY = 6;

/** Moves items into or out of trash; resolves with the ones that made it. */
export async function moveTrash(items: Item[], action: "trash" | "restore") {
  const done = new Set<Item>();
  let next = 0;
  const work = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        await submitStorageMutationPost({
          action: `/api/files/${kindPath(item)}/${item.id}/${action}`,
          logicalAction: `${action}:${item.kind}:${item.id}`,
        });
        done.add(item);
      } catch {
        // The caller reports what did not make it.
      }
    }
  };
  await Promise.all(Array.from({ length: TRASH_CONCURRENCY }, work));
  return items.filter((item) => done.has(item));
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
