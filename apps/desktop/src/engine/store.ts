import { DatabaseSync } from "node:sqlite";

/** A server item as the change feed last described it. */
export type RemoteItem = {
  id: string;
  type: "folder" | "file";
  parentId: string | null;
  name: string;
  size: number | null;
  checksum: string | null;
  rev: number;
  /** Epoch ms of the uploader's modified time. */
  modifiedAt: number | null;
};

/** The last state both sides agreed on, for one path in one pair. */
export type BaseEntry = {
  pairId: string;
  rel: string;
  type: "folder" | "file";
  remoteId: string;
  rev: number;
  checksum: string | null;
  size: number;
  mtimeMs: number;
  ino: number;
};

export type PendingUpload = {
  pairId: string;
  rel: string;
  sessionId: string;
  checksum: string;
  size: number;
  mtimeMs: number;
};

export type ConflictRow = {
  id: number;
  pairId: string;
  rel: string;
  copyRel: string;
};

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS remote (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, parentId TEXT, name TEXT NOT NULL,
    size INTEGER, checksum TEXT, rev INTEGER NOT NULL, modifiedAt INTEGER
  );
  CREATE INDEX IF NOT EXISTS remote_parent ON remote (parentId);
  CREATE TABLE IF NOT EXISTS base (
    pairId TEXT NOT NULL, rel TEXT NOT NULL, type TEXT NOT NULL,
    remoteId TEXT NOT NULL, rev INTEGER NOT NULL, checksum TEXT,
    size INTEGER NOT NULL, mtimeMs REAL NOT NULL, ino INTEGER NOT NULL,
    PRIMARY KEY (pairId, rel)
  );
  CREATE TABLE IF NOT EXISTS upload (
    pairId TEXT NOT NULL, rel TEXT NOT NULL, sessionId TEXT NOT NULL,
    checksum TEXT NOT NULL, size INTEGER NOT NULL, mtimeMs REAL NOT NULL,
    PRIMARY KEY (pairId, rel)
  );
  CREATE TABLE IF NOT EXISTS conflict (
    id INTEGER PRIMARY KEY AUTOINCREMENT, pairId TEXT NOT NULL,
    rel TEXT NOT NULL, copyRel TEXT NOT NULL
  );
`;

/**
 * The engine's memory between runs. Synchronous writes with a full fsync:
 * after a crash the base must still match what is on disk and on the server.
 */
export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  private depth = 0;

  /** All or nothing; a transaction inside another joins it. */
  transaction<T>(run: () => T): T {
    if (this.depth > 0) {
      this.depth += 1;
      try {
        return run();
      } finally {
        this.depth -= 1;
      }
    }
    this.depth = 1;
    this.db.exec("BEGIN");
    try {
      const result = run();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  getMeta(key: string) {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string | null) {
    if (value === null) {
      this.db.prepare("DELETE FROM meta WHERE key = ?").run(key);
    } else {
      this.db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
        .run(key, value);
    }
  }

  remoteItems() {
    return this.db.prepare("SELECT * FROM remote").all() as RemoteItem[];
  }

  putRemote(item: RemoteItem) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO remote
          (id, type, parentId, name, size, checksum, rev, modifiedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.type,
        item.parentId,
        item.name,
        item.size,
        item.checksum,
        item.rev,
        item.modifiedAt,
      );
  }

  deleteRemote(ids: string[]) {
    const statement = this.db.prepare("DELETE FROM remote WHERE id = ?");
    for (const id of ids) statement.run(id);
  }

  clearRemote() {
    this.db.exec("DELETE FROM remote");
  }

  baseEntries(pairId: string) {
    return this.db
      .prepare("SELECT * FROM base WHERE pairId = ?")
      .all(pairId) as BaseEntry[];
  }

  fileCount(pairId: string) {
    const row = this.db
      .prepare(
        "SELECT count(*) AS count FROM base WHERE pairId = ? AND type = 'file'",
      )
      .get(pairId) as { count: number };
    return row.count;
  }

  putBase(entry: BaseEntry) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO base
          (pairId, rel, type, remoteId, rev, checksum, size, mtimeMs, ino)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.pairId,
        entry.rel,
        entry.type,
        entry.remoteId,
        entry.rev,
        entry.checksum,
        entry.size,
        entry.mtimeMs,
        entry.ino,
      );
  }

  deleteBase(pairId: string, rel: string) {
    this.db
      .prepare("DELETE FROM base WHERE pairId = ? AND rel = ?")
      .run(pairId, rel);
  }

  /** Removes a folder's entry and everything under it. */
  deleteBaseTree(pairId: string, rel: string) {
    this.db
      .prepare(
        "DELETE FROM base WHERE pairId = ? AND (rel = ? OR substr(rel, 1, length(?)) = ?)",
      )
      .run(pairId, rel, `${rel}/`, `${rel}/`);
  }

  /** Renames a path and everything under it after a move on either side. */
  moveBaseTree(pairId: string, from: string, to: string) {
    const rows = this.db
      .prepare(
        "SELECT * FROM base WHERE pairId = ? AND (rel = ? OR substr(rel, 1, length(?)) = ?)",
      )
      .all(pairId, from, `${from}/`, `${from}/`) as BaseEntry[];
    this.transaction(() => {
      this.deleteBaseTree(pairId, from);
      for (const row of rows) {
        this.putBase({ ...row, rel: to + row.rel.slice(from.length) });
      }
    });
  }

  /** Drops everything remembered about pairs that are no longer synced. */
  forgetPairsExcept(pairIds: string[]) {
    const kept = new Set(pairIds);
    const known = new Set<string>();
    for (const table of ["base", "upload", "conflict"]) {
      for (const row of this.db
        .prepare(`SELECT DISTINCT pairId FROM ${table}`)
        .all() as { pairId: string }[]) {
        known.add(row.pairId);
      }
    }
    for (const row of this.db.prepare("SELECT key FROM meta").all() as {
      key: string;
    }[]) {
      const pairId = /^(?:ready|gone|allow-emptied):(.+)$/.exec(row.key)?.[1];
      if (pairId) known.add(pairId);
    }
    this.transaction(() => {
      for (const pairId of known) {
        if (kept.has(pairId)) continue;
        this.clearPair(pairId);
        for (const key of ["ready", "gone", "allow-emptied"]) {
          this.setMeta(`${key}:${pairId}`, null);
        }
      }
    });
  }

  clearPair(pairId: string) {
    this.transaction(() => {
      for (const table of ["base", "upload", "conflict"]) {
        this.db.prepare(`DELETE FROM ${table} WHERE pairId = ?`).run(pairId);
      }
    });
  }

  pendingUploads() {
    return this.db.prepare("SELECT * FROM upload").all() as PendingUpload[];
  }

  pendingUpload(pairId: string, rel: string) {
    return (
      (this.db
        .prepare("SELECT * FROM upload WHERE pairId = ? AND rel = ?")
        .get(pairId, rel) as PendingUpload | undefined) ?? null
    );
  }

  putUpload(upload: PendingUpload) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO upload
          (pairId, rel, sessionId, checksum, size, mtimeMs)
          VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        upload.pairId,
        upload.rel,
        upload.sessionId,
        upload.checksum,
        upload.size,
        upload.mtimeMs,
      );
  }

  deleteUpload(pairId: string, rel: string) {
    this.db
      .prepare("DELETE FROM upload WHERE pairId = ? AND rel = ?")
      .run(pairId, rel);
  }

  conflicts() {
    return this.db
      .prepare("SELECT * FROM conflict ORDER BY id")
      .all() as ConflictRow[];
  }

  addConflict(pairId: string, rel: string, copyRel: string) {
    this.db
      .prepare("INSERT INTO conflict (pairId, rel, copyRel) VALUES (?, ?, ?)")
      .run(pairId, rel, copyRel);
  }

  deleteConflict(id: number) {
    this.db.prepare("DELETE FROM conflict WHERE id = ?").run(id);
  }
}
