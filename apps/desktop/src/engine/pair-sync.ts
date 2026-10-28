import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import type { Activity, Issue, SyncPair } from "../shared/types";
import type { Api } from "./api";
import { ApiError } from "./api";
import type { LocalEntry } from "./local";
import { hashFile, localPath, sameStat, scanLocal, statLocal } from "./local";
import { baseName, parentRel, pathKey } from "./names";
import type { Action, Hold, LocalFile } from "./plan";
import { conflictCopyName, plan } from "./plan";
import type { RemoteTree } from "./remote";
import type { BaseEntry, RemoteItem, Store } from "./store";
import type { Throttle } from "./transfer";
import {
  downloadToTemp,
  freeBytes,
  moveIntoPlace,
  uploadFile,
} from "./transfer";

export type PairContext = {
  api: Api;
  store: Store;
  tree: RemoteTree;
  pair: SyncPair;
  deviceName: string;
  ignore: (name: string) => boolean;
  minFreeBytes: number;
  uploads: Throttle;
  downloads: Throttle;
  /** Moves a path to the OS trash; the main process owns that API. */
  trash: (file: string) => Promise<void>;
  activity: (update: Activity) => void;
  notify: (title: string, body: string) => void;
};

export type PairResult = {
  issues: Issue[];
  hold: Hold | null;
  /** Something changed on the server; read the change feed again. */
  pullAgain: boolean;
  /** Some work had to wait, such as a file still being written. */
  retrySoon: boolean;
};

const MAX_ROUNDS = 20;
const TRANSFERS = 4;
/** A file written this recently may still be open in the app saving it. */
const SETTLE_MS = 2000;

const hashes = new Map<string, { entry: LocalEntry; checksum: string }>();

const remoteFromUpload = (
  file: {
    id: string;
    folderId: string | null;
    name: string;
    sizeBytes: number;
    storageRevision?: number;
    clientModifiedAt?: string | null;
  },
  checksum: string | null,
): RemoteItem => ({
  id: file.id,
  type: "file",
  parentId: file.folderId,
  name: file.name,
  size: file.sizeBytes,
  checksum,
  rev: file.storageRevision ?? 0,
  modifiedAt: file.clientModifiedAt
    ? new Date(file.clientModifiedAt).getTime()
    : null,
});

const remoteFromFolder = (folder: {
  id: string;
  parentId: string | null;
  name: string;
  storageRevision?: number;
}): RemoteItem => ({
  id: folder.id,
  type: "folder",
  parentId: folder.parentId,
  name: folder.name,
  size: null,
  checksum: null,
  rev: folder.storageRevision ?? 0,
  modifiedAt: null,
});

/** Runs `work` over `items`, a few at a time. */
const pool = async <T>(items: T[], work: (item: T) => Promise<void>) => {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(TRANSFERS, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
};

const order: Record<Action["kind"], number> = {
  "move-local": 0,
  "move-remote": 0,
  mkdir: 1,
  "create-remote-folder": 1,
  link: 2,
  forget: 2,
  "conflict-copy": 3,
  download: 4,
  upload: 4,
  "keep-mine": 4,
  "trash-local": 5,
  "trash-remote": 5,
};

/** Brings one pair in line, planning again after each batch of actions. */
// The plan-and-run loop for one pair, with its two stop checks.
// fallow-ignore-next-line complexity
export const syncPair = async (ctx: PairContext): Promise<PairResult> => {
  const { pair, store, tree, api } = ctx;
  const issues: Issue[] = [];
  const issue = (rel: string, kind: Issue["kind"], message: string) =>
    issues.push({ pairId: pair.id, rel, kind, message });
  let pullAgain = false;

  const rootStats = await stat(pair.localPath).catch(() => null);
  if (!rootStats?.isDirectory()) {
    issue(
      "",
      "folder-missing",
      `${pair.localPath} is missing. Reconnect the drive, or remove this folder in Settings.`,
    );
    return { issues, hold: null, pullAgain, retrySoon: false };
  }
  if (store.getMeta(`gone:${pair.id}`)) {
    issue(
      "",
      "server-folder-gone",
      `${pair.remoteLabel} was removed from the server. Restore it there, or remove this folder in Settings.`,
    );
    return { issues, hold: null, pullAgain, retrySoon: false };
  }

  const keyOf = (rel: string) => `${pair.id}\0${rel}`;
  // Server folder ids by path key, rebuilt every round.
  let folderIds = new Map<string, string>();
  const remoteIdAt = (rel: string) =>
    rel ? (folderIds.get(pathKey(rel)) ?? null) : pair.remoteFolderId;
  const putBase = (
    rel: string,
    local: LocalEntry,
    remote: RemoteItem,
    checksum: string | null,
  ) =>
    store.putBase({
      pairId: pair.id,
      rel,
      type: remote.type,
      remoteId: remote.id,
      rev: remote.rev,
      checksum,
      size: local.size,
      mtimeMs: local.mtimeMs,
      ino: local.ino,
    });

  /** Treats a refusal from the server as "look again", not as a failure. */
  // One branch per server refusal the engine retries.
  // fallow-ignore-next-line complexity
  const tolerate = (error: unknown, rel: string) => {
    if (!(error instanceof ApiError)) throw error;
    if (error.code === "REVISION_MISMATCH") {
      const details = (error.body?.details ?? null) as {
        id: string;
        storageRevision: number;
        contentChecksum: string | null;
      } | null;
      const known = details ? tree.items.get(details.id) : undefined;
      // Only the revision moved (a parent was renamed): take the new one.
      if (known && details && details.contentChecksum === known.checksum) {
        tree.set({ ...known, rev: details.storageRevision });
      }
      pullAgain = true;
      return;
    }
    if (error.code === "USER_STORAGE_QUOTA_EXCEEDED") {
      issue(rel, "quota", "Your storage on the server is full.");
      return;
    }
    if (error.status === 404 || error.status === 409) {
      pullAgain = true;
      return;
    }
    issue(rel, "error", error.message);
  };

  type Of<K extends Action["kind"]> = Extract<Action, { kind: K }>;
  type Handler<K extends Action["kind"]> = (
    action: Of<K>,
    rel: string,
    full: string,
  ) => Promise<void>;
  // One handler per action, each with its own checks before it touches a file.
  const handlers: { [K in Action["kind"]]: Handler<K> } = {
    "move-local": async (action, rel, full) => {
      const target = localPath(pair.localPath, action.to);
      if (await statLocal(pair.localPath, action.to)) return;
      await rename(full, target);
      store.moveBaseTree(pair.id, action.from, action.to);
      const moved = await statLocal(pair.localPath, action.to);
      const previous = store
        .baseEntries(pair.id)
        .find((entry) => entry.rel === action.to);
      if (moved && previous) {
        putBase(action.to, moved, action.remote, previous.checksum);
      }
    },
    // A move and a rename are separate server calls.
    // fallow-ignore-next-line complexity
    "move-remote": async (action) => {
      const current = tree.items.get(action.base.remoteId);
      if (!current) return;
      const parentId = remoteIdAt(parentRel(action.to));
      if (!parentId) return;
      const name = baseName(action.to);
      let item = current;
      const isFile = current.type === "file";
      if (current.parentId !== parentId) {
        const result = isFile
          ? (await api.moveFile(item.id, item.rev, parentId)).file
          : (await api.moveFolder(item.id, item.rev, parentId)).folder;
        item = isFile
          ? remoteFromUpload(result as never, item.checksum)
          : remoteFromFolder(result as never);
        tree.set(item);
      }
      if (current.name !== name) {
        const result = isFile
          ? (await api.renameFile(item.id, item.rev, name)).file
          : (await api.renameFolder(item.id, item.rev, name)).folder;
        item = isFile
          ? remoteFromUpload(result as never, item.checksum)
          : remoteFromFolder(result as never);
        tree.set(item);
      }
      store.moveBaseTree(pair.id, action.from, action.to);
      putBase(action.to, action.local, item, action.base.checksum);
    },
    mkdir: async (action, rel, full) => {
      await mkdir(full, { recursive: true });
      const made = await statLocal(pair.localPath, rel);
      folderIds.set(pathKey(rel), action.remote.id);
      if (made) putBase(rel, made, action.remote, null);
    },
    "create-remote-folder": async (action, rel) => {
      const parentId = remoteIdAt(parentRel(rel));
      if (!parentId) return;
      const { folder } = await api.createFolder(parentId, baseName(rel));
      const item = remoteFromFolder(folder);
      tree.set(item);
      folderIds.set(pathKey(rel), item.id);
      putBase(rel, action.local, item, null);
    },
    link: async (action, rel) => {
      putBase(rel, action.local, action.remote, action.remote.checksum);
    },
    forget: async (_action, rel) => {
      store.deleteBase(pair.id, rel);
    },
    "conflict-copy": async (action, rel, full) => {
      const now = await statLocal(pair.localPath, rel);
      if (!now || !sameStat(now, action.local)) return;
      const taken = new Set(
        (await scanLocal(pair.localPath, () => false)).entries.map((entry) =>
          pathKey(entry.rel),
        ),
      );
      const copyRel = conflictCopyName(
        rel,
        ctx.deviceName,
        new Date(),
        (candidate) => taken.has(pathKey(candidate)),
      );
      await rename(full, localPath(pair.localPath, copyRel));
      if (action.localOnly) {
        ctx.notify(
          "Your edit was kept",
          `${baseName(rel)} changed on the server. Your version is now ${baseName(copyRel)}, on this computer only.`,
        );
      } else if (action.local.type === "file") {
        store.addConflict(pair.id, rel, copyRel);
        ctx.notify(
          "Sync conflict",
          `${baseName(rel)} changed here and on the server. Both versions were kept.`,
        );
      }
    },
    // Each check guards the file being replaced.
    // fallow-ignore-next-line complexity
    download: async (action, rel, full) => {
      const { remote } = action;
      const free = await freeBytes(path.dirname(full)).catch(() => null);
      if (free !== null && free - (remote.size ?? 0) < ctx.minFreeBytes) {
        issue(
          rel,
          "disk-full",
          "This computer is almost out of space, so downloads are paused.",
        );
        return;
      }
      await mkdir(path.dirname(full), { recursive: true });
      const activity: Activity = {
        pairId: pair.id,
        rel,
        direction: "down",
        state: "active",
        bytes: remote.size ?? 0,
        doneBytes: 0,
        at: Date.now(),
      };
      ctx.activity(activity);
      const { temp, checksum } = await downloadToTemp({
        api,
        fileId: remote.id,
        target: full,
        checksum: remote.checksum,
        size: remote.size,
        modifiedAt: remote.modifiedAt,
        throttle: ctx.downloads,
        onBytes: (bytes) => {
          activity.doneBytes += bytes;
          ctx.activity(activity);
        },
      });
      // The local file must still be what the plan saw, or nothing.
      const now = await statLocal(pair.localPath, rel);
      if (action.expect ? !now || !sameStat(now, action.expect) : now) {
        await rm(temp, { force: true });
        return;
      }
      await moveIntoPlace(temp, full);
      const written = await statLocal(pair.localPath, rel);
      if (written) putBase(rel, written, remote, checksum);
      ctx.activity({ ...activity, state: "done", at: Date.now() });
    },
    // Empty files take the multipart path.
    // fallow-ignore-next-line complexity
    upload: async (action, rel, full) => {
      const { local } = action;
      if (Date.now() - local.mtimeMs < SETTLE_MS) return;
      const parentId = remoteIdAt(parentRel(rel));
      if (!parentId) return;
      const checksum = await checksumOf(local);
      const now = await statLocal(pair.localPath, rel);
      if (!now || !sameStat(now, local)) return;
      const activity: Activity = {
        pairId: pair.id,
        rel,
        direction: "up",
        state: "active",
        bytes: local.size,
        doneBytes: 0,
        at: Date.now(),
      };
      ctx.activity(activity);
      let file;
      if (local.size === 0) {
        if (action.replace) {
          // shortcut: an emptied file is uploaded as a new file, so its
          // share link and favorite do not follow; upload sessions need
          // one byte. Upgrade when the server takes empty replacements.
          await api.trashFile(action.replace.remoteId, action.replace.rev);
          tree.removeSubtree(action.replace.remoteId);
        }
        const result = await api.uploadEmpty(
          parentId,
          baseName(rel),
          local.mtimeMs,
        );
        file = result.uploadedFiles[0];
        if (!file) {
          pullAgain = true;
          return;
        }
      } else {
        file = await uploadFile({
          api,
          store,
          pairId: pair.id,
          rel,
          file: full,
          folderId: parentId,
          name: baseName(rel),
          checksum,
          size: local.size,
          mtimeMs: local.mtimeMs,
          replace: action.replace ? { rev: action.replace.rev } : null,
          throttle: ctx.uploads,
          onBytes: (bytes) => {
            activity.doneBytes += bytes;
            ctx.activity(activity);
          },
        });
      }
      const item = remoteFromUpload(file, checksum);
      tree.set(item);
      putBase(rel, local, item, checksum);
      ctx.activity({ ...activity, state: "done", at: Date.now() });
    },
    "keep-mine": async (action, rel, full) => {
      const { local, remote } = action;
      if (Date.now() - local.mtimeMs < SETTLE_MS) return;
      const checksum = await checksumOf(local);
      const parentId = remote.parentId ?? remoteIdAt(parentRel(rel));
      if (!parentId) return;
      const copyName = baseName(
        conflictCopyName(rel, ctx.deviceName, new Date(), () => false),
      );
      const copy = await uploadFile({
        api,
        store,
        pairId: pair.id,
        rel,
        file: full,
        folderId: parentId,
        name: copyName,
        checksum,
        size: local.size,
        mtimeMs: local.mtimeMs,
        replace: null,
        throttle: ctx.uploads,
        onBytes: () => {},
      });
      const result = await api.keepMine(remote.id, remote.rev, copy.id);
      tree.removeSubtree(copy.id);
      const item = remoteFromUpload(result.file as never, checksum);
      tree.set(item);
      putBase(rel, local, item, checksum);
    },
    "trash-local": async (action, rel, full) => {
      const now = await statLocal(pair.localPath, rel);
      if (!now) {
        store.deleteBaseTree(pair.id, rel);
        return;
      }
      if (now.type === "file" && !sameStat(now, action.local)) return;
      await ctx.trash(full);
      store.deleteBaseTree(pair.id, rel);
    },
    "trash-remote": async (action, rel) => {
      const { remote } = action;
      if (remote.type === "file") await api.trashFile(remote.id, remote.rev);
      else await api.trashFolder(remote.id, remote.rev);
      tree.removeSubtree(remote.id);
      store.deleteBaseTree(pair.id, rel);
    },
  };

  const run = async (action: Action) => {
    const rel = "rel" in action ? action.rel : action.from;
    try {
      const handler = handlers[action.kind] as Handler<Action["kind"]>;
      await handler(action as never, rel, localPath(pair.localPath, rel));
    } catch (error) {
      tolerate(error, rel);
    }
  };

  const checksumOf = async (entry: LocalFile) => {
    const cached = hashes.get(keyOf(entry.rel));
    if (cached && sameStat(cached.entry, entry)) return cached.checksum;
    const checksum = await hashFile(localPath(pair.localPath, entry.rel));
    hashes.set(keyOf(entry.rel), { entry, checksum });
    return checksum;
  };

  const allowEmptied = store.getMeta(`allow-emptied:${pair.id}`) === "1";
  let previousPlan = "";
  let retrySoon = false;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const scan = await scanLocal(pair.localPath, ctx.ignore);
    const local: LocalFile[] = scan.entries.map((entry) => {
      const cached = hashes.get(keyOf(entry.rel));
      return cached && sameStat(cached.entry, entry)
        ? { ...entry, checksum: cached.checksum }
        : entry;
    });
    const { items, skipped } = tree.scope(pair.remoteFolderId);
    folderIds = new Map(
      items
        .filter((each) => each.item.type === "folder")
        .map((each) => [pathKey(each.rel), each.item.id]),
    );
    const result = plan({
      pairId: pair.id,
      mode: pair.mode,
      local,
      remote: items,
      skipped,
      base: store.baseEntries(pair.id) as BaseEntry[],
      allowEmptied,
    });
    if (round === 0) {
      issues.push(...result.issues);
      for (const skip of scan.skipped) issue(skip.rel, "symlink", skip.reason);
    }
    if (result.hold) {
      return { issues, hold: result.hold, pullAgain, retrySoon };
    }
    for (const entry of result.needsHash) await checksumOf(entry);
    if (result.actions.length === 0) {
      if (result.needsHash.length === 0) break;
      continue;
    }
    // The same plan twice means the rest is waiting on something.
    const signature = JSON.stringify(
      result.actions.map((action) => [
        action.kind,
        "rel" in action ? action.rel : action.from,
      ]),
    );
    if (signature === previousPlan) {
      retrySoon = true;
      break;
    }
    previousPlan = signature;
    const sorted = [...result.actions].sort(
      (a, b) => order[a.kind] - order[b.kind],
    );
    // Folders first, top-down; transfers in parallel; deletions last.
    for (const stage of [0, 1, 2, 3, 4, 5]) {
      const batch = sorted.filter((action) => order[action.kind] === stage);
      if (stage === 4) await pool(batch, run);
      else for (const action of batch) await run(action);
    }
    if (pullAgain) break;
  }
  if (allowEmptied) store.setMeta(`allow-emptied:${pair.id}`, null);
  return { issues, hold: null, pullAgain, retrySoon };
};
