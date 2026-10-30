import { existsSync } from "node:fs";
import path from "node:path";

import type {
  Activity,
  ConflictChoice,
  EngineConfig,
  EngineEvent,
  EngineStatus,
  Issue,
  SyncPair,
} from "../shared/types";
import type { Api } from "./api";
import { ApiError, SignedOutError, createApi } from "./api";
import { localPath } from "./local";
import { createIgnore } from "./names";
import { syncPair } from "./pair-sync";
import type { StorageChange } from "./remote";
import { RemoteTree, fromSnapshot } from "./remote";
import { Store } from "./store";
import { Throttle } from "./transfer";

export type Watch = (dir: string, onChange: () => void) => Promise<() => void>;

export type EngineDeps = {
  emit: (event: EngineEvent) => void;
  trash: (file: string) => Promise<void>;
  watch: Watch;
};

const POLL_MS = 60_000;
const FULL_PASS_MS = 10 * 60_000;
const DEBOUNCE_MS = 1500;
const RETRY_SOON_MS = 5000;

/**
 * Keeps every pair in sync. One pass reads the server's change feed, then
 * brings each pair in line.
 *
 * Everything that touches synced files or the store runs one at a time, in
 * the order it was asked for: passes, conflict choices, emptied-folder
 * choices, forgetting removed pairs, and shutdown. Settings apply at once;
 * a running pass sees the change before its next action and stops early.
 */
export class SyncEngine {
  private config: EngineConfig | null = null;
  private readonly store: Store;
  private readonly tree: RemoteTree;
  private api: Api | null = null;
  private running = false;
  private stopped = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly halt = new AbortController();
  private refusedPasses = 0;
  private passWaiting: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private live: AbortController | null = null;
  private liveConnected = false;
  private unwatch: (() => void)[] = [];
  private issues: Issue[] = [];
  private activity: Activity[] = [];
  private offline = false;
  private signedOut = false;
  private lastSyncAt: number | null = null;
  private notified = new Set<string>();
  private readonly uploads = new Throttle(null);
  private readonly downloads = new Throttle(null);

  /** `dataDir` holds the engine's database; it must exist. */
  constructor(
    private readonly deps: EngineDeps,
    dataDir: string,
  ) {
    this.store = new Store(path.join(dataDir, "sync.db"));
    this.tree = new RemoteTree(this.store, new Set());
  }

  // Only changed parts restart.
  // fallow-ignore-next-line complexity
  async configure(config: EngineConfig) {
    const previous = this.config;
    this.config = config;
    this.uploads.limitKBps = config.uploadLimitKBps;
    this.downloads.limitKBps = config.downloadLimitKBps;
    this.tree.setRoots(
      new Set(config.pairs.map((pair) => pair.remoteFolderId)),
    );
    if (
      previous?.serverUrl !== config.serverUrl ||
      previous?.token !== config.token
    ) {
      this.api = createApi(config.serverUrl, config.token, this.halt.signal);
      this.signedOut = false;
      this.connectLive();
    }
    if (
      JSON.stringify(previous?.pairs.map((pair) => pair.localPath)) !==
      JSON.stringify(config.pairs.map((pair) => pair.localPath))
    ) {
      await this.watchPairs();
    }
    // Also after a restart, so a pair removed while stopped is forgotten.
    const kept = config.pairs.map((pair) => pair.id);
    await this.exclusive(() => this.store.forgetPairsExcept(kept));
    this.request();
  }

  /** Runs `work` after everything asked for before it has finished. */
  private exclusive<T>(work: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(() => {
      if (this.stopped) throw new Error("The sync engine stopped.");
      return work();
    });
    this.queue = run.catch(() => {});
    return run;
  }

  resolvePair(pairId: string, choice: "download-again" | "apply") {
    return this.exclusive(() => {
      if (choice === "apply") {
        this.store.setMeta(`allow-emptied:${pairId}`, "1");
      }
      // Forgetting the base turns the emptied side into "never synced", so
      // the other side fills it again without deleting anything.
      else this.store.clearPair(pairId);
      this.request();
    });
  }

  resolveConflict(id: number, choice: ConflictChoice) {
    return this.exclusive(() => this.applyConflictChoice(id, choice));
  }

  // Keep-server and keep-mine need different lookups.
  // fallow-ignore-next-line complexity
  private async applyConflictChoice(id: number, choice: ConflictChoice) {
    const { api, config } = this;
    const conflict = this.store.conflicts().find((each) => each.id === id);
    const pair = config?.pairs.find((each) => each.id === conflict?.pairId);
    if (!api || !conflict || !pair) return;
    if (choice === "keep-server") {
      const copy = localPath(pair.localPath, conflict.copyRel);
      if (existsSync(copy)) await this.deps.trash(copy);
    } else {
      const base = this.store.baseEntries(pair.id);
      const copy = base.find((entry) => entry.rel === conflict.copyRel);
      const original = this.tree
        .scope(pair.remoteFolderId)
        .items.find((each) => each.rel === conflict.rel);
      if (!copy || !original) {
        this.deps.emit({
          type: "notify",
          title: "Not ready yet",
          body: "Your version is still uploading. Try again in a moment.",
        });
        return;
      }
      await api.keepMine(original.item.id, original.item.rev, copy.remoteId);
    }
    this.store.deleteConflict(id);
    this.request();
  }

  /** Runs a pass soon; repeated requests fold into one. */
  request(delay = 0) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, delay);
  }

  /**
   * Ends every loop and closes the store once the work in flight is done. A
   * running pass stops before its next action. Before a sign-out, also
   * cancels unfinished uploads: the server counts them against the
   * person's upload limit until they expire.
   */
  private stopping: Promise<void> | null = null;

  stop({ cancelUploads = false } = {}) {
    this.stopping ??= this.shutDown(cancelUploads);
    return this.stopping;
  }

  private async shutDown(cancelUploads: boolean) {
    const closed = this.queue.then(async () => {
      const { config } = this;
      if (cancelUploads && config) {
        // The engine's own API is aborted by now; this one is not.
        const api = createApi(config.serverUrl, config.token);
        for (const upload of this.store.pendingUploads()) {
          await api.cancelUpload(upload.sessionId).catch(() => {});
        }
      }
      this.store.close();
    });
    this.queue = closed;
    this.stopped = true;
    this.halt.abort();
    if (this.timer) clearTimeout(this.timer);
    if (this.emitPending) clearTimeout(this.emitPending);
    this.live?.abort();
    for (const stop of this.unwatch) stop();
    await closed;
  }

  private async watchPairs() {
    for (const stop of this.unwatch) stop();
    this.unwatch = [];
    for (const pair of this.config?.pairs ?? []) {
      try {
        this.unwatch.push(
          await this.deps.watch(pair.localPath, () =>
            this.request(DEBOUNCE_MS),
          ),
        );
      } catch {
        // A missing folder is reported by the pass; the periodic pass retries.
      }
    }
  }

  private connectLive() {
    this.live?.abort();
    const controller = new AbortController();
    this.live = controller;
    const loop = async () => {
      for (let attempt = 0; !controller.signal.aborted; attempt += 1) {
        try {
          await this.api?.events(() => {
            this.liveConnected = true;
            attempt = 0;
            this.request(250);
          }, controller.signal);
        } catch (error) {
          if (error instanceof SignedOutError) return this.signOut();
        }
        this.liveConnected = false;
        if (controller.signal.aborted) return;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(2 ** attempt, 60) * 1000),
        );
      }
    };
    void loop();
  }

  private signOut() {
    if (this.signedOut) return;
    this.signedOut = true;
    this.live?.abort();
    this.deps.emit({ type: "signed-out" });
    this.emitStatus();
  }

  /** Reads the change feed up to now; a pair seen for the first time starts from a snapshot. */
  // Snapshot, page, 410 restart and revealed folders are one read of the feed.
  // fallow-ignore-next-line complexity
  private async pull() {
    const { api, config } = this;
    if (!api || !config) return;
    const snapshot = async (folderId: string) => {
      const items = [];
      let cursor: string | null = null;
      let changeCursor: string | null = null;
      do {
        const page = await api.snapshot(folderId, cursor);
        changeCursor ??= page.changeCursor;
        items.push(...page.items.map(fromSnapshot));
        cursor = page.next;
      } while (cursor);
      return { items, changeCursor: changeCursor ?? "0" };
    };
    const lowerCursor = (value: string) => {
      const current = this.store.getMeta("cursor");
      if (current === null || BigInt(value) < BigInt(current)) {
        this.store.setMeta("cursor", value);
      }
    };
    const snapshotPair = async (pairId: string, folderId: string) => {
      try {
        const result = await snapshot(folderId);
        this.tree.replaceUnder(folderId, result.items);
        lowerCursor(result.changeCursor);
        this.store.setMeta(`ready:${pairId}`, "1");
        this.store.setMeta(`gone:${pairId}`, null);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        this.store.setMeta(`gone:${pairId}`, "1");
      }
    };

    for (const pair of config.pairs) {
      if (!this.store.getMeta(`ready:${pair.id}`)) {
        await snapshotPair(pair.id, pair.remoteFolderId);
      }
    }
    const roots = new Map(
      config.pairs.map((pair) => [pair.remoteFolderId, pair.id]),
    );
    for (;;) {
      const after = this.store.getMeta("cursor") ?? "0";
      let page;
      try {
        page = await api.changes(after);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 410) throw error;
        // Too old, or the server was restored to an earlier point: start over.
        this.store.setMeta("cursor", null);
        this.tree.clear();
        for (const pair of config.pairs) {
          await snapshotPair(pair.id, pair.remoteFolderId);
        }
        continue;
      }
      const reveal: string[] = [];
      // Reconnects with backoff until stopped or signed out.
      // fallow-ignore-next-line complexity
      this.store.transaction(() => {
        for (const change of page.changes as StorageChange[]) {
          const pairId = roots.get(change.itemId);
          if (
            pairId &&
            (change.kind === "trashed" || change.kind === "deleted")
          ) {
            this.store.setMeta(`gone:${pairId}`, "1");
          } else if (pairId && change.kind === "restored") {
            this.store.setMeta(`ready:${pairId}`, null);
          }
          const folder = this.tree.apply(change);
          if (folder) reveal.push(folder);
        }
      });
      for (const folderId of reveal) {
        try {
          this.tree.addUnder((await snapshot(folderId)).items);
        } catch (error) {
          // Gone again since; a later change says so.
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      }
      for (const pair of config.pairs) {
        if (!this.store.getMeta(`ready:${pair.id}`)) {
          await snapshotPair(pair.id, pair.remoteFolderId);
        }
      }
      this.store.setMeta("cursor", page.cursor);
      if (!page.hasMore) break;
    }
  }

  /**
   * Runs a full pass after the work already queued, and resolves when it has
   * finished. Calls while a pass waits to start share that pass.
   */
  syncNow() {
    this.passWaiting ??= this.exclusive(() => {
      this.passWaiting = null;
      return this.pass();
    }).catch(() => {});
    return this.passWaiting;
  }

  /**
   * Whether `pair` still syncs as it did when the pass started: same folder
   * and mode, and the same ignore rules, which decide what may be touched.
   */
  private current(pair: SyncPair, ignore: string[]) {
    const config = this.config;
    if (this.stopped || this.signedOut || !config || config.paused)
      return false;
    const now = config.pairs.find((each) => each.id === pair.id);
    return (
      JSON.stringify([now, config.ignore]) === JSON.stringify([pair, ignore])
    );
  }

  // One pass: pull, then each pair, then the next wake-up.
  // fallow-ignore-next-line complexity
  private async pass() {
    const { config } = this;
    if (!config || this.signedOut || this.stopped) return;
    if (config.paused) {
      this.emitStatus();
      return;
    }
    this.running = true;
    this.emitStatus();
    let retrySoon = false;
    let pullAgain = false;
    try {
      await this.pull();
      this.offline = false;
      const issues: Issue[] = [];
      for (const pair of config.pairs) {
        if (this.config !== config) break;
        const result = await syncPair({
          api: this.api as Api,
          store: this.store,
          tree: this.tree,
          pair,
          deviceName: config.deviceName,
          ignore: createIgnore(config.ignore),
          minFreeBytes: config.minFreeBytes,
          uploads: this.uploads,
          downloads: this.downloads,
          trash: this.deps.trash,
          activity: (update) => this.track(update),
          notify: (title, body) =>
            this.deps.emit({ type: "notify", title, body }),
          current: () => this.current(pair, config.ignore),
          signal: this.halt.signal,
        });
        issues.push(...result.issues);
        if (result.hold) {
          issues.push({
            pairId: pair.id,
            rel: "",
            kind: "folder-emptied",
            message:
              result.hold.side === "local"
                ? `Every file in ${pair.localPath} is gone. Delete them on the server too?`
                : `Every file in ${pair.remoteLabel} is gone from the server. Delete them on this computer too?`,
          });
        }
        if (result.pullAgain) pullAgain = true;
        retrySoon ||= result.retrySoon;
      }
      this.issues = issues;
      this.lastSyncAt = Date.now();
    } catch (error) {
      if (error instanceof SignedOutError) this.signOut();
      else this.offline = true;
    } finally {
      this.running = false;
    }
    this.notifyIssues();
    this.emitStatus();
    // A refusal that persists after the feed was read again must not spin.
    this.refusedPasses = pullAgain ? this.refusedPasses + 1 : 0;
    if (pullAgain) {
      this.request(
        this.refusedPasses <= 2
          ? 0
          : Math.min(POLL_MS, 1000 * 2 ** (this.refusedPasses - 2)),
      );
    } else {
      this.request(
        this.offline || !this.liveConnected
          ? POLL_MS
          : retrySoon
            ? RETRY_SOON_MS
            : FULL_PASS_MS,
      );
    }
  }

  private track(update: Activity) {
    const index = this.activity.findIndex(
      (each) => each.pairId === update.pairId && each.rel === update.rel,
    );
    if (index !== -1) this.activity.splice(index, 1);
    this.activity.unshift({ ...update });
    this.activity.length = Math.min(this.activity.length, 30);
    this.emitStatus();
  }

  private notifyIssues() {
    for (const issue of this.issues) {
      if (issue.kind === "error") continue;
      const key = `${issue.pairId}\0${issue.rel}\0${issue.kind}`;
      if (this.notified.has(key)) continue;
      this.notified.add(key);
      this.deps.emit({
        type: "notify",
        title:
          issue.kind === "invalid-name" ? "Can't sync here" : "Sync needs you",
        body: issue.rel ? `${issue.rel}: ${issue.message}` : issue.message,
      });
    }
  }

  private lastEmit = 0;
  private emitPending: NodeJS.Timeout | null = null;

  /** At most a few status messages a second, however fast bytes move. */
  private emitStatus() {
    // The store closes on stop; nothing reads it after.
    if (this.stopped) return;
    const send = () => {
      this.lastEmit = Date.now();
      this.emitPending = null;
      this.deps.emit({ type: "status", status: this.status() });
    };
    if (this.emitPending) return;
    const wait = 250 - (Date.now() - this.lastEmit);
    if (wait <= 0) send();
    else this.emitPending = setTimeout(send, wait);
  }

  // Optional status fields; each read is one branch.
  // fallow-ignore-next-line complexity
  status(): EngineStatus {
    const { config } = this;
    const pairs = config?.pairs ?? [];
    const conflicts = this.store.conflicts().filter((conflict) => {
      const pair = pairs.find((each) => each.id === conflict.pairId);
      return pair && existsSync(localPath(pair.localPath, conflict.copyRel));
    });
    const active = this.activity.filter((each) => each.state === "active");
    return {
      state: this.signedOut
        ? "signed-out"
        : config?.paused
          ? "paused"
          : this.offline
            ? "offline"
            : this.running
              ? "syncing"
              : this.lastSyncAt === null
                ? "starting"
                : "idle",
      pendingFiles: active.length,
      pendingBytes: active.reduce(
        (sum, each) => sum + Math.max(0, each.bytes - each.doneBytes),
        0,
      ),
      fileCount: pairs.reduce(
        (sum, pair) => sum + this.store.fileCount(pair.id),
        0,
      ),
      activity: this.activity,
      conflicts,
      issues: this.issues,
      lastSyncAt: this.lastSyncAt,
    };
  }
}
