import { useCallback, useRef, useState } from "react";

import { confirmAction } from "@/components/confirm-dialog";
import {
  followStorageOperation,
  forgetStorageMutationKey,
  isStorageOperation,
  StorageRequestError,
  storageOperationProgress,
  submitStorageMutationPost,
} from "@/src/storage-mutation-submit";
import { followFolderOperation } from "@/src/workspace/folder-operation";
import type {
  ClearTrashOperationResponse,
  FolderOperationResponse,
} from "@/server/files/types";
import { toast, toastManager } from "@staaash/ui/components/toast";

type Item = { id: string; kind: "file" | "folder"; name?: string };
type TrashAction = "trash" | "restore";

const kindPath = (item: Item) => (item.kind === "folder" ? "folders" : "files");

// Select all can hold a whole folder; a few requests at a time keeps the
// server and the browser responsive instead of opening one per item at once.
const TRASH_CONCURRENCY = 6;

/**
 * Why an item did not move:
 * - `busy`: refused before it started; another storage change holds the account.
 * - `finishing`: the server took it and is still finishing it.
 * - `recovery`: storage recovery has to look at it first.
 * - `refused`: the server said no, with a reason.
 * - `unknown`: the server could not confirm either way, so it may or may
 *   not have moved.
 */
type FailureReason = "busy" | "finishing" | "recovery" | "refused" | "unknown";
type Failure = { item: Item; reason: FailureReason; message: string };

/** `kind` is the journal mutation this request starts, such as `file_trash`. */
const reasonOf = (error: unknown, kind: string): FailureReason => {
  if (!(error instanceof StorageRequestError)) return "unknown";
  if (error.code === "STORAGE_ADMISSION_BUSY") return "busy";
  if (error.code === "STORAGE_RECOVERY_REQUIRED") return "recovery";
  if (
    error.code === "STORAGE_MUTATION_RECOVERING" ||
    error.code === "STORAGE_MUTATION_IN_PROGRESS"
  ) {
    // Only the same change already under way is still finishing, and
    // another change holding the item turned this request away. Without a
    // named change the server could not tell, so the outcome is open.
    if (!error.mutationKind) return "unknown";
    return error.mutationKind === kind ? "finishing" : "busy";
  }
  return error.status < 500 ? "refused" : "unknown";
};

const keyOf = (item: Item, of: TrashAction) => `${of}:${item.kind}:${item.id}`;

// A large folder answers 202 and moves in the background.
async function moveOne(item: Item, action: TrashAction) {
  const answer = await submitStorageMutationPost({
    action: `/api/files/${kindPath(item)}/${item.id}/${action}`,
    logicalAction: keyOf(item, action),
    headers: item.kind === "folder" ? { Prefer: "respond-async" } : undefined,
  });
  if (!isStorageOperation(answer)) return;
  const name = item.name ?? "folder";
  await followFolderOperation(
    answer as FolderOperationResponse,
    action === "trash" ? `Moving ${name} to trash` : `Restoring ${name}`,
  );
}

/** Moves items into or out of trash, and says which did not and why. */
async function moveTrash(items: Item[], action: TrashAction) {
  const moved = new Set<Item>();
  const failed: Failure[] = [];
  let next = 0;
  const work = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        await moveOne(item, action);
        moved.add(item);
        // The item changed state, so an older attempt to move it the other
        // way must not replay as done.
        forgetStorageMutationKey(
          keyOf(item, action === "trash" ? "restore" : "trash"),
        );
      } catch (error) {
        const reason = reasonOf(error, `${item.kind}_${action}`);
        // Only a lost answer is retried as the same request. Every other
        // outcome is settled, so the next attempt is a new move.
        if (reason !== "unknown") forgetStorageMutationKey(keyOf(item, action));
        failed.push({
          item,
          reason,
          message: error instanceof Error ? error.message : "",
        });
      }
    }
  };
  await Promise.all(Array.from({ length: TRASH_CONCURRENCY }, work));
  return { moved: items.filter((item) => moved.has(item)), failed };
}

const NAMED = 3;
const list = new Intl.ListFormat("en", { type: "conjunction" });

/** "Taxes", "Taxes and Photos", or "Taxes, Photos, Notes, and 4 more". */
const nameItems = (items: Item[]) => {
  const names = items.flatMap((item) => (item.name ? [item.name] : []));
  if (names.length < items.length) {
    return items.length === 1 ? "1 item" : `${items.length} items`;
  }
  return list.format(
    names.length > NAMED + 1
      ? [...names.slice(0, NAMED), `${names.length - NAMED} more`]
      : names,
  );
};

const verbs = {
  trash: { doing: "move", to: " to trash", still: "still moving to trash" },
  restore: { doing: "restore", to: "", still: "still being restored" },
};

let emptying: Promise<unknown> | null = null;

const busyDescription = () =>
  emptying
    ? "Trash is being emptied. Try again in a moment."
    : "Storage is busy with another change. Try again in a moment.";

const KEPT_SAFE = "Every file is kept safe.";

/** What each reason says, and whether Retry can help. */
const failureCopy: Record<
  FailureReason,
  (failed: Failure[]) => { info?: true; description?: string; retry?: true }
> = {
  busy: () => ({ description: busyDescription(), retry: true }),
  finishing: () => ({
    info: true,
    description: `It finishes on its own. ${KEPT_SAFE}`,
  }),
  recovery: () => ({
    description: `${KEPT_SAFE} Storage recovery has to check it first.`,
  }),
  refused: (failed) => {
    const messages = new Set(failed.map((failure) => failure.message));
    return {
      description: messages.size === 1 ? [...messages][0] : undefined,
      retry: true,
    };
  },
  unknown: () => ({
    description: "Staaash couldn't confirm it. Refresh to see where it is now.",
    retry: true,
  }),
};

/** One toast per reason, naming the items it is about. */
function reportFailures(
  failed: Failure[],
  action: TrashAction,
  retry?: (items: Item[]) => void,
) {
  const verb = verbs[action];
  for (const reason of Object.keys(failureCopy) as FailureReason[]) {
    const group = failed.filter((failure) => failure.reason === reason);
    if (group.length === 0) continue;
    const items = group.map((failure) => failure.item);
    const names = nameItems(items);
    const copy = failureCopy[reason](group);
    if (copy.info) {
      const are = items.length === 1 ? "is" : "are";
      toast.info(`${names} ${are} ${verb.still}`, {
        description: copy.description,
      });
      continue;
    }
    toast.error(`Couldn't ${verb.doing} ${names}${verb.to}`, {
      description: copy.description,
      retry: copy.retry && retry ? () => retry(items) : undefined,
    });
  }
}

/**
 * Trash and restore act at once; this toast is the way back. Undo runs the
 * opposite move on the same items.
 */
function showUndo({
  items,
  done,
  onUndone,
}: {
  items: Item[];
  done: TrashAction;
  onUndone: () => void;
}) {
  if (items.length === 0) return;
  const what = items.length === 1 ? "1 item" : `${items.length} items`;
  const undo = done === "trash" ? "restore" : "trash";
  toastManager.add({
    title: done === "trash" ? `Moved ${what} to trash` : `Restored ${what}`,
    actionProps: {
      children: "Undo",
      onClick: () => {
        void moveTrash(items, undo).then(({ failed }) => {
          reportFailures(failed, undo);
          onUndone();
        });
      },
    },
  });
}

/**
 * Moves items into or out of trash from a list that does not hide them
 * first, says which did not move and why, and offers Undo.
 */
export async function moveWithUndo(
  items: Item[],
  action: TrashAction,
  refresh: () => void,
): Promise<Item[]> {
  const { moved, failed } = await moveTrash(items, action);
  reportFailures(
    failed,
    action,
    (left) => void moveWithUndo(left, action, refresh),
  );
  refresh();
  showUndo({ items: moved, done: action, onUndone: refresh });
  return moved;
}

/**
 * Moves items to trash at once: they leave the list before the server
 * answers, and come back only if they are still active. `hiddenIds` holds
 * the items the list should leave out.
 */
export function useMoveToTrash(refresh: () => void) {
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  // Moves the server is still finishing, or could not confirm. The next
  // listing decides whether they stay out of sight.
  const unsettled = useRef(new Set<string>());
  const show = (ids: string[]) =>
    setHiddenIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });

  const trash = async (items: Item[]) => {
    if (items.length === 0) return;
    setHiddenIds((current) => new Set([...current, ...items.map((i) => i.id)]));
    const { moved, failed } = await moveTrash(items, "trash");
    const open = (failure: Failure) =>
      failure.reason === "finishing" || failure.reason === "unknown";
    for (const failure of failed.filter(open)) {
      unsettled.current.add(failure.item.id);
    }
    show(
      failed
        .filter((failure) => !open(failure))
        .map((failure) => failure.item.id),
    );
    reportFailures(failed, "trash", (left) => void trash(left));
    if (moved.length > 0 || failed.some(open)) refresh();
    showUndo({
      items: moved,
      done: "trash",
      onUndone: () => {
        show(moved.map((item) => item.id));
        refresh();
      },
    });
  };

  const restore = async (items: Item[]) =>
    show(
      (await moveWithUndo(items, "restore", refresh)).map((item) => item.id),
    );

  /**
   * A list that shows the server's state of each item calls this with every
   * new listing: moved items have left it, and items still finishing are
   * left out by that state, so neither needs hiding any more.
   */
  const reconcile = useCallback((listed: ReadonlySet<string>) => {
    const settled = new Set(unsettled.current);
    unsettled.current.clear();
    setHiddenIds((current) => {
      const next = new Set(
        [...current].filter((id) => listed.has(id) && !settled.has(id)),
      );
      return next.size === current.size ? current : next;
    });
  }, []);

  return { hiddenIds, trash, restore, reconcile };
}

/**
 * Whether an item's own move to trash is still finishing on the server. The
 * active list leaves it out until it lands in trash or comes back. One that
 * needs recovery stays in sight so its state is clear.
 */
export const isLeavingForTrash = (
  mutation?: { kind: string; status: string } | null,
) =>
  !!mutation &&
  (mutation.kind === "file_trash" || mutation.kind === "folder_trash") &&
  mutation.status !== "recovery_required";

const EMPTY_TRASH_CONFIRM = {
  title: "Empty trash?",
  description: "Everything in it is deleted for good.",
  confirmLabel: "Empty trash",
  destructive: true,
};

/**
 * Starts Empty trash in the background and follows it until it settles.
 * The worker keeps going if this page closes; the trash shows what is left.
 */
async function runEmptyTrash(
  onProgress: (operation: ClearTrashOperationResponse) => void,
) {
  const started = await submitStorageMutationPost({
    action: "/api/files/trash/clear",
    logicalAction: "empty-trash",
    headers: { Prefer: "respond-async" },
  });
  if (!isStorageOperation(started)) {
    throw new Error("Staaash lost track of it. Refresh to see what is left.");
  }
  const operation = await followStorageOperation(
    started as ClearTrashOperationResponse,
    `/api/files/trash/clear/${encodeURIComponent(started.operationId)}`,
    onProgress,
  );
  if (operation.status === "recovery_required") {
    throw new StorageRequestError(
      operation.error ?? "Empty trash could not finish.",
      503,
      "STORAGE_RECOVERY_REQUIRED",
      operation.operationId,
      "clear_trash",
    );
  }
  return operation;
}

/**
 * Empties trash after a confirm, with a toast that counts the items until
 * it is done. A second click while it runs does nothing; that toast already
 * shows it.
 */
export async function emptyTrash(refresh: () => unknown) {
  if (emptying) return;
  if (!(await confirmAction(EMPTY_TRASH_CONFIRM))) return;
  const toastId = toastManager.add({
    title: "Emptying trash",
    type: "loading",
    timeout: 0,
  });
  emptying = runEmptyTrash((operation) =>
    toastManager.update(toastId, {
      description: storageOperationProgress(operation),
    }),
  );
  try {
    await emptying;
    toastManager.update(toastId, {
      title: "Trash emptied",
      description: undefined,
      type: "success",
      timeout: 5_000,
    });
  } catch (error) {
    const reason = reasonOf(error, "clear_trash");
    toastManager.update(toastId, {
      title: "Trash could not be emptied",
      description:
        reason === "recovery"
          ? `${KEPT_SAFE} Storage recovery has to check it first.`
          : reason === "busy"
            ? "Storage is busy with another change. Try again in a moment."
            : error instanceof Error
              ? error.message
              : undefined,
      type: "error",
      timeout: 0,
    });
  } finally {
    // Emptying again is always a new request: replaying an earlier one that
    // finished would report success and leave newer items in trash.
    forgetStorageMutationKey("empty-trash");
    emptying = null;
    await refresh();
  }
}
