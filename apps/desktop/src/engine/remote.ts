import { invalidNameReason, joinRel, pathKey } from "./names";
import type { RemoteItem, Store } from "./store";

/** One entry of `GET /api/sync/changes`. */
export type StorageChange = {
  kind: "created" | "updated" | "moved" | "trashed" | "restored" | "deleted";
  itemType: "folder" | "file";
  itemId: string;
  parentId: string | null;
  name: string;
  sizeBytes: number | null;
  contentChecksum: string | null;
  storageRevision: number;
  clientModifiedAt: string | null;
};

/** One entry of `GET /api/sync/snapshot`. */
export type SnapshotItem = {
  type: "folder" | "file";
  id: string;
  parentId: string | null;
  name: string;
  sizeBytes: number | null;
  contentChecksum: string | null;
  storageRevision: number;
  clientModifiedAt: string | null;
};

export type ScopedItem = { rel: string; item: RemoteItem };
export type SkippedItem = { rel: string; item: RemoteItem; reason: string };

const toMs = (value: string | null) =>
  value === null ? null : new Date(value).getTime();

export const fromSnapshot = (item: SnapshotItem): RemoteItem => ({
  id: item.id,
  type: item.type,
  parentId: item.parentId,
  name: item.name,
  size: item.sizeBytes,
  checksum: item.contentChecksum,
  rev: item.storageRevision,
  modifiedAt: toMs(item.clientModifiedAt),
});

/**
 * The server folders under every pair, kept current from the change feed.
 * Replaying a change twice, or replaying an older change over a newer
 * snapshot, leaves the same tree: entries are full upserts, and an entry
 * older than what is stored is skipped.
 */
export class RemoteTree {
  readonly items = new Map<string, RemoteItem>();
  private children = new Map<string | null, Set<string>>();

  constructor(
    private readonly store: Store,
    private roots: Set<string>,
  ) {
    for (const item of store.remoteItems()) this.index(item);
  }

  setRoots(roots: Set<string>) {
    this.roots = roots;
  }

  private index(item: RemoteItem) {
    const previous = this.items.get(item.id);
    if (previous) this.children.get(previous.parentId)?.delete(item.id);
    this.items.set(item.id, item);
    let siblings = this.children.get(item.parentId);
    if (!siblings) this.children.set(item.parentId, (siblings = new Set()));
    siblings.add(item.id);
  }

  private put(item: RemoteItem) {
    this.index(item);
    this.store.putRemote(item);
  }

  /** Every id in a subtree, the folder itself first. */
  private subtree(id: string) {
    const ids = [id];
    for (let index = 0; index < ids.length; index += 1) {
      for (const child of this.children.get(ids[index]) ?? []) ids.push(child);
    }
    return ids;
  }

  removeSubtree(id: string) {
    const ids = this.subtree(id).filter((each) => this.items.has(each));
    for (const each of ids) {
      const item = this.items.get(each);
      if (item) this.children.get(item.parentId)?.delete(each);
      this.items.delete(each);
      this.children.delete(each);
    }
    this.store.deleteRemote(ids);
  }

  /** Whether an item sits under one of the pair folders. */
  private inScope(parentId: string | null) {
    let current = parentId;
    for (let depth = 0; current !== null && depth < 4096; depth += 1) {
      if (this.roots.has(current)) return true;
      current = this.items.get(current)?.parentId ?? null;
    }
    return false;
  }

  /** Replaces what is known under a pair folder with a fresh snapshot. */
  replaceUnder(rootId: string, items: RemoteItem[]) {
    this.store.transaction(() => {
      // Removing a subtree never touches its siblings, so the set can be
      // walked while it shrinks.
      for (const child of this.children.get(rootId) ?? []) {
        this.removeSubtree(child);
      }
      for (const item of items) this.put(item);
    });
  }

  /** Adds a folder's contents that came into view with it. */
  addUnder(items: RemoteItem[]) {
    this.store.transaction(() => {
      for (const item of items) {
        const current = this.items.get(item.id);
        if (!current || current.rev <= item.rev) this.put(item);
      }
    });
  }

  /**
   * Applies one change. Returns a folder id when a folder came into view whose
   * contents the client has not seen, so the caller fetches its snapshot.
   */
  // One branch per change kind and scope.
  // fallow-ignore-next-line complexity
  apply(change: StorageChange): string | null {
    // A pair folder itself is not part of its own contents; the engine
    // watches it separately.
    if (this.roots.has(change.itemId)) return null;
    const current = this.items.get(change.itemId);
    if (current && change.storageRevision < current.rev) return null;
    if (change.kind === "trashed" || change.kind === "deleted") {
      if (current) this.removeSubtree(change.itemId);
      return null;
    }
    if (!this.inScope(change.parentId)) {
      // Moved out of every pair, or never in one.
      if (current) this.removeSubtree(change.itemId);
      return null;
    }
    this.put({
      id: change.itemId,
      type: change.itemType,
      parentId: change.parentId,
      name: change.name,
      size: change.sizeBytes,
      checksum: change.contentChecksum,
      rev: change.storageRevision,
      modifiedAt: toMs(change.clientModifiedAt),
    });
    return change.itemType === "folder" && !current && change.kind !== "created"
      ? change.itemId
      : null;
  }

  /** Records a server answer the engine got directly, before the feed echoes it. */
  set(item: RemoteItem) {
    if (!this.inScope(item.parentId)) {
      if (this.items.has(item.id)) this.removeSubtree(item.id);
      return;
    }
    this.put(item);
  }

  /**
   * The items under a pair folder with their paths. Items this computer
   * cannot hold are skipped with a reason, and so is everything inside them.
   */
  scope(rootId: string) {
    const items: ScopedItem[] = [];
    const skipped: SkippedItem[] = [];
    // Directory entries come in several kinds.
    // fallow-ignore-next-line complexity
    const walk = (parentId: string, parentRel: string) => {
      const byKey = new Map<string, RemoteItem[]>();
      for (const id of this.children.get(parentId) ?? []) {
        const item = this.items.get(id);
        if (!item) continue;
        const key = pathKey(item.name);
        byKey.set(key, [...(byKey.get(key) ?? []), item]);
      }
      for (const group of byKey.values()) {
        for (const item of group) {
          const rel = joinRel(parentRel, item.name);
          const reason =
            invalidNameReason(item.name) ??
            (group.length > 1
              ? "Another item here has the same name in different letter case, which this computer treats as the same name."
              : null);
          if (reason) {
            skipped.push({ rel, item, reason });
            continue;
          }
          items.push({ rel, item });
          if (item.type === "folder") walk(item.id, rel);
        }
      }
    };
    walk(rootId, "");
    return { items, skipped };
  }
}
