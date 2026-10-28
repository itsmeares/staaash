import type { Issue, SyncMode } from "../shared/types";
import type { LocalEntry } from "./local";
import { sameStat } from "./local";
import { baseName, isInside, parentRel, pathKey } from "./names";
import type { ScopedItem, SkippedItem } from "./remote";
import type { BaseEntry, RemoteItem } from "./store";

/** A local entry, with its checksum when the planner needs it. */
export type LocalFile = LocalEntry & { checksum?: string };

export type Action =
  /** A server move or rename, repeated on this computer. */
  | { kind: "move-local"; from: string; to: string; remote: RemoteItem }
  /** A move or rename on this computer, repeated on the server. */
  | {
      kind: "move-remote";
      from: string;
      to: string;
      base: BaseEntry;
      local: LocalFile;
    }
  | { kind: "mkdir"; rel: string; remote: RemoteItem }
  | { kind: "create-remote-folder"; rel: string; local: LocalFile }
  /** `expect` is the local file being replaced, null when there is none. */
  | {
      kind: "download";
      rel: string;
      remote: RemoteItem;
      expect: LocalFile | null;
    }
  | {
      kind: "upload";
      rel: string;
      local: LocalFile;
      replace: { remoteId: string; rev: number } | null;
    }
  /** Upload-only folders: this computer wins, the server's version goes to trash. */
  | { kind: "keep-mine"; rel: string; local: LocalFile; remote: RemoteItem }
  /** Renames the local version aside so both versions survive. */
  | {
      kind: "conflict-copy";
      rel: string;
      local: LocalFile;
      localOnly: boolean;
    }
  | { kind: "trash-local"; rel: string; local: LocalFile }
  | { kind: "trash-remote"; rel: string; remote: RemoteItem }
  /** Both sides agree; record it without moving bytes. */
  | { kind: "link"; rel: string; local: LocalFile; remote: RemoteItem }
  | { kind: "forget"; rel: string };

/** Everything on one side of a pair disappeared; this needs a person. */
export type Hold = { side: "local" | "server" };

export type PlanInput = {
  pairId: string;
  mode: SyncMode;
  local: LocalFile[];
  remote: ScopedItem[];
  skipped: SkippedItem[];
  base: BaseEntry[];
  /** Set once the person said an emptied side is what they meant. */
  allowEmptied?: boolean;
};

export type Plan = {
  actions: Action[];
  issues: Issue[];
  hold: Hold | null;
  /** Local files whose checksum the planner needs before it can decide. */
  needsHash: LocalFile[];
};

const EMPTIED_HOLD_FILES = 10;

const depth = (rel: string) => rel.split("/").length;

/** Folders whose subtree differs from the base on one side. */
const dirtyFolders = (
  keys: Iterable<string>,
  isClean: (key: string) => boolean,
) => {
  const dirty = new Set<string>();
  for (const key of keys) {
    if (isClean(key)) continue;
    for (let parent = parentRel(key); parent; parent = parentRel(parent)) {
      if (dirty.has(parent)) break;
      dirty.add(parent);
    }
  }
  return dirty;
};

/** Both sides and the base, indexed the ways the planner looks them up. */
type View = {
  mode: SyncMode;
  local: Map<string, LocalFile>;
  remote: Map<string, ScopedItem>;
  base: Map<string, BaseEntry>;
  remoteById: Map<string, ScopedItem>;
  /** Local entries the base does not know, by inode: candidates for moves. */
  localByIno: Map<number, LocalFile>;
};

/** One path, as each side and the base see it. */
type Cell = {
  key: string;
  rel: string;
  here: LocalFile | undefined;
  there: ScopedItem | undefined;
  previous: BaseEntry | undefined;
};

const view = (input: PlanInput): View => {
  const base = new Map(input.base.map((entry) => [pathKey(entry.rel), entry]));
  return {
    mode: input.mode,
    local: new Map(input.local.map((entry) => [pathKey(entry.rel), entry])),
    remote: new Map(input.remote.map((each) => [pathKey(each.rel), each])),
    base,
    remoteById: new Map(input.remote.map((each) => [each.item.id, each])),
    localByIno: new Map(
      input.local
        .filter((entry) => entry.ino !== 0 && !base.has(pathKey(entry.rel)))
        .map((entry) => [entry.ino, entry]),
    ),
  };
};

/**
 * An unmounted drive often leaves an empty mount folder behind. Emptying a
 * small folder on purpose is normal; emptying a big one needs a yes.
 */
const holdFor = (input: PlanInput): Hold | null => {
  if (input.allowEmptied) return null;
  const files = input.base.filter((entry) => entry.type === "file").length;
  if (files < EMPTIED_HOLD_FILES) return null;
  if (input.local.length === 0 && input.mode !== "download") {
    return { side: "local" };
  }
  if (input.remote.length === 0 && input.mode !== "upload") {
    return { side: "server" };
  }
  return null;
};

type Move = { target: string; action: Action | null };

/** A server move this computer can repeat; null action while its folder is missing. */
// Each check rules out a look-alike that is not a move.
// fallow-ignore-next-line complexity
const serverMove = (v: View, entry: BaseEntry): Move | null => {
  const key = pathKey(entry.rel);
  const onServer = v.remoteById.get(entry.remoteId);
  const here = v.local.get(key);
  if (v.mode === "upload" || !onServer || pathKey(onServer.rel) === key) {
    return null;
  }
  const target = pathKey(onServer.rel);
  if (here?.type !== entry.type || v.local.has(target)) return null;
  if (entry.type === "file" && !sameStat(here, entry)) return null;
  const ready =
    !parentRel(target) || v.local.get(parentRel(target))?.type === "folder";
  return {
    target,
    action: ready
      ? {
          kind: "move-local",
          from: here.rel,
          to: onServer.rel,
          remote: onServer.item,
        }
      : null,
  };
};

/** A local move, found by inode, that the server can repeat. */
// Each check rules out a look-alike that is not a move.
// fallow-ignore-next-line complexity
const localMove = (v: View, entry: BaseEntry): Move | null => {
  const key = pathKey(entry.rel);
  const onServer = v.remoteById.get(entry.remoteId);
  if (v.mode === "download" || v.local.has(key) || entry.ino === 0) return null;
  if (!onServer || pathKey(onServer.rel) !== key) return null;
  const moved = v.localByIno.get(entry.ino);
  if (moved?.type !== entry.type) return null;
  if (entry.type === "file" && !sameStat(moved, entry)) return null;
  const target = pathKey(moved.rel);
  if (v.remote.has(target)) return null;
  const ready =
    !parentRel(target) ||
    v.remote.get(parentRel(target))?.item.type === "folder";
  return {
    target,
    action: ready
      ? {
          kind: "move-remote",
          from: entry.rel,
          to: moved.rel,
          base: entry,
          local: moved,
        }
      : null,
  };
};

/**
 * Moves come first and alone. Paths that are mid-move are left out of the
 * rest of the plan, so a move is never mistaken for a delete plus a new file.
 */
const planMoves = (v: View, base: BaseEntry[]) => {
  const pending = new Set<string>();
  const moves: Action[] = [];
  const sorted = [...base].sort((a, b) => depth(a.rel) - depth(b.rel));
  for (const entry of sorted) {
    const key = pathKey(entry.rel);
    if ([...pending].some((each) => isInside(key, each))) continue;
    const move = serverMove(v, entry) ?? localMove(v, entry);
    if (!move) continue;
    pending.add(key);
    pending.add(move.target);
    if (move.action) moves.push(move.action);
  }
  return { moves, pending };
};

/** Folders whose contents changed on a side since the base, so they stay. */
const dirtySides = (v: View) => ({
  local: dirtyFolders(v.local.keys(), (key) => {
    const here = v.local.get(key);
    const previous = v.base.get(key);
    if (!here) return true;
    if (previous?.type !== here.type) return false;
    return here.type === "folder" || sameStat(here, previous);
  }),
  remote: dirtyFolders(v.remote.keys(), (key) => {
    const there = v.remote.get(key);
    const previous = v.base.get(key);
    if (!there) return true;
    if (previous?.remoteId !== there.item.id) return false;
    return (
      there.item.type === "folder" || there.item.checksum === previous.checksum
    );
  }),
});

type Decision = { action: Action | null; gone?: boolean };

const folderOnBothSides = ({ rel, here, there, previous }: Cell): Decision =>
  here && there && previous?.remoteId !== there.item.id
    ? { action: { kind: "link", rel, local: here, remote: there.item } }
    : { action: null };

/** A folder only the server has: new there, or deleted here. */
const folderOnlyThere = (
  v: View,
  { key, rel, there, previous }: Cell,
  dirty: Set<string>,
): Decision => {
  if (!there) return { action: null };
  if (previous && v.mode !== "download" && !dirty.has(key)) {
    return {
      action: { kind: "trash-remote", rel, remote: there.item },
      gone: true,
    };
  }
  return v.mode === "upload"
    ? { action: null }
    : { action: { kind: "mkdir", rel: there.rel, remote: there.item } };
};

/** A folder only this computer has: new here, or deleted on the server. */
const folderOnlyHere = (
  v: View,
  { key, rel, here, previous }: Cell,
  dirty: Set<string>,
): Decision => {
  if (!here) return { action: null };
  if (previous && v.mode !== "upload" && !dirty.has(key)) {
    return { action: { kind: "trash-local", rel, local: here }, gone: true };
  }
  if (v.mode !== "download") {
    return { action: { kind: "create-remote-folder", rel, local: here } };
  }
  return { action: previous ? { kind: "forget", rel } : null };
};

const planFolder = (
  v: View,
  cell: Cell,
  dirty: ReturnType<typeof dirtySides>,
): Decision => {
  if (cell.here && cell.there) return folderOnBothSides(cell);
  if (cell.there) return folderOnlyThere(v, cell, dirty.remote);
  if (cell.here) return folderOnlyHere(v, cell, dirty.local);
  return { action: cell.previous ? { kind: "forget", rel: cell.rel } : null };
};

/** Both sides have the file; `mine` is the local checksum. */
// The three-way rule for a file both sides have.
// fallow-ignore-next-line complexity
const fileOnBothSides = (
  v: View,
  { rel, here, there, previous }: Cell & { here: LocalFile; there: ScopedItem },
  mine: string | null,
): Action | null => {
  const theirs = there.item.checksum;
  const sameItem = previous?.remoteId === there.item.id;
  if (mine === theirs) {
    const stale =
      !sameItem || previous.rev !== there.item.rev || !sameStat(here, previous);
    return stale
      ? { kind: "link", rel, local: here, remote: there.item }
      : null;
  }
  const localChanged = !previous || mine !== previous.checksum;
  const remoteChanged = !sameItem || theirs !== previous.checksum;
  if (localChanged && remoteChanged) {
    return v.mode === "upload"
      ? { kind: "keep-mine", rel, local: here, remote: there.item }
      : {
          kind: "conflict-copy",
          rel,
          local: here,
          localOnly: v.mode === "download",
        };
  }
  if (localChanged) {
    return v.mode === "download"
      ? { kind: "conflict-copy", rel, local: here, localOnly: true }
      : {
          kind: "upload",
          rel,
          local: here,
          replace: { remoteId: there.item.id, rev: there.item.rev },
        };
  }
  return v.mode === "upload"
    ? null
    : { kind: "download", rel, remote: there.item, expect: here };
};

/** Only this computer has the file: new here, or deleted on the server. */
// One branch per mode, plus the move guard.
// fallow-ignore-next-line complexity
const fileOnlyHere = (
  v: View,
  { rel, here, previous }: Cell & { here: LocalFile },
): Action | null => {
  // The server item moved somewhere this computer could not follow. Keep
  // the local file; it syncs as a new one.
  if (previous && v.remoteById.has(previous.remoteId)) {
    return { kind: "forget", rel };
  }
  const unchanged = previous !== undefined && sameStat(here, previous);
  if (v.mode === "upload" || (v.mode === "two-way" && !unchanged)) {
    return { kind: "upload", rel, local: here, replace: null };
  }
  if (unchanged) return { kind: "trash-local", rel, local: here };
  return previous ? { kind: "forget", rel } : null;
};

/** Only the server has the file: new there, or deleted here. */
// One branch per mode, plus the move guard.
// fallow-ignore-next-line complexity
const fileOnlyThere = (
  v: View,
  { rel, there, previous }: Cell & { there: ScopedItem },
): Action | null => {
  const unchanged =
    previous?.remoteId === there.item.id &&
    previous.checksum === there.item.checksum;
  if (v.mode === "download" || (v.mode === "two-way" && !unchanged)) {
    return {
      kind: "download",
      rel: there.rel,
      remote: there.item,
      expect: null,
    };
  }
  // Moved on this computer in a way the server could not follow.
  if (previous && previous.ino !== 0 && v.localByIno.has(previous.ino)) {
    return { kind: "forget", rel };
  }
  if (unchanged) return { kind: "trash-remote", rel, remote: there.item };
  return previous ? { kind: "forget", rel } : null;
};

/**
 * Decides what to do with every path in one pair. Pure: the engine reads both
 * sides, calls this, runs the actions, and plans again until nothing is left.
 */
// Hold, moves, then every path, in that order.
// fallow-ignore-next-line complexity
export const plan = (input: PlanInput): Plan => {
  const issues: Issue[] = input.skipped.map((skip) => ({
    pairId: input.pairId,
    rel: skip.rel,
    kind: "invalid-name",
    message: skip.reason,
    remoteId: skip.item.id,
  }));
  const empty = { actions: [], issues, hold: null, needsHash: [] };
  const hold = holdFor(input);
  if (hold) return { ...empty, hold };

  const v = view(input);
  const { moves, pending } = planMoves(v, input.base);
  if (moves.length > 0) return { ...empty, actions: moves };

  const needsHash: LocalFile[] = [];
  const dirty = dirtySides(v);
  const actions: Action[] = [];
  const gone = new Set<string>();
  const keys = [
    ...new Set([...v.local.keys(), ...v.remote.keys(), ...v.base.keys()]),
  ];
  for (const key of keys.sort((a, b) => depth(a) - depth(b))) {
    const skip = [...pending, ...gone].some(
      (each) => key === each || isInside(key, each),
    );
    if (skip) continue;
    const here = v.local.get(key);
    const there = v.remote.get(key);
    const previous = v.base.get(key);
    const cell = {
      key,
      rel: here?.rel ?? there?.rel ?? previous?.rel ?? key,
      here,
      there,
      previous,
    };
    const decision = decide(v, cell, dirty, needsHash);
    if (decision.action) actions.push(decision.action);
    if (decision.gone) gone.add(key);
  }
  return { actions, issues, hold: null, needsHash };
};

// One branch per combination of local, server and base.
// fallow-ignore-next-line complexity
const decide = (
  v: View,
  cell: Cell,
  dirty: ReturnType<typeof dirtySides>,
  needsHash: LocalFile[],
): Decision => {
  const { here, there, previous } = cell;
  if (here && there && here.type !== there.item.type) {
    return {
      action:
        v.mode === "upload"
          ? null
          : {
              kind: "conflict-copy",
              rel: cell.rel,
              local: here,
              localOnly: v.mode === "download",
            },
    };
  }
  if ((here?.type ?? there?.item.type ?? previous?.type) === "folder") {
    return planFolder(v, cell, dirty);
  }
  if (here && there) {
    const mine = checksumOf(here, previous);
    if (mine === undefined) {
      needsHash.push(here);
      return { action: null };
    }
    return { action: fileOnBothSides(v, { ...cell, here, there }, mine) };
  }
  if (here) return { action: fileOnlyHere(v, { ...cell, here }) };
  if (there) return { action: fileOnlyThere(v, { ...cell, there }) };
  return { action: previous ? { kind: "forget", rel: cell.rel } : null };
};

/** The local checksum when it is known without reading the file. */
const checksumOf = (entry: LocalFile, previous: BaseEntry | undefined) => {
  if (previous && sameStat(entry, previous)) return previous.checksum;
  return entry.checksum;
};

/** `report (conflict, Laptop, 2026-10-22 10-15).docx`, unique in its folder. */
// Date parts and the first free name.
// fallow-ignore-next-line complexity
export const conflictCopyName = (
  rel: string,
  deviceName: string,
  now: Date,
  taken: (rel: string) => boolean,
) => {
  const name = baseName(rel);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const device =
    deviceName.replace(/[<>:"/\\|?*()]/g, "").trim() || "this device";
  const folder = parentRel(rel);
  for (let attempt = 1; ; attempt += 1) {
    const suffix = attempt === 1 ? "" : ` ${attempt}`;
    const candidate = `${stem} (conflict, ${device}, ${stamp}${suffix})${extension}`;
    const candidateRel = folder ? `${folder}/${candidate}` : candidate;
    if (!taken(candidateRel)) return candidateRel;
  }
};
