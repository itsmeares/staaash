import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import type {
  EngineConfig,
  EngineState,
  EngineStatus,
  Issue,
  SyncPair,
} from "../shared/types";
import { SyncEngine } from "./engine";
import * as pairSync from "./pair-sync";

type Reply = (response: ServerResponse) => void;

const json =
  (status: number, body: unknown): Reply =>
  (response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
const VERSION_OK = json(200, { version: "2.0.0", minClientVersion: "2.0.0" });
const FEED_OK = json(200, { changes: [], cursor: "1", hasMore: false });
const NO_ANSWER: Reply = (response) => response.socket?.destroy();

let root: string;
let server: Server;
let serverUrl: string;
let replies: { version: Reply; changes: Reply; events?: Reply };
let engine: SyncEngine;
let logged: { stage: string; error: unknown }[];
let emitted: EngineStatus[];
let cancelled: string[];

const docsFolder = {
  id: "docs",
  type: "folder",
  parentId: "root-b",
  name: "docs",
  sizeBytes: null,
  contentChecksum: null,
  storageRevision: 1,
  clientModifiedAt: null,
};

const pairOf = (id: string): SyncPair => {
  const localPath = path.join(root, id);
  mkdirSync(localPath);
  return {
    id,
    localPath,
    remoteFolderId: `root-${id}`,
    remoteLabel: id,
    mode: "two-way",
  } as SyncPair;
};

const configOf = (pairs: SyncPair[]): EngineConfig =>
  ({
    serverUrl,
    token: "device-token",
    deviceName: "Test",
    pairs,
    ignore: [],
    minFreeBytes: 0,
    uploadLimitKBps: null,
    downloadLimitKBps: null,
    paused: false,
  }) as EngineConfig;

/** Runs passes until the first full one has settled. */
const syncOnce = async (pairs: SyncPair[]) => {
  await engine.configure(configOf(pairs));
  await engine.syncNow();
  return engine.status();
};

/** Makes one pair's saved history unreadable: a real local database failure. */
const breakHistory = (pairId: string) => {
  const db = new DatabaseSync(path.join(root, "data", "sync.db"));
  db.prepare(
    "INSERT INTO base VALUES (?, 'x', 'file', 'r', 1, 'c', ?, 1, '1')",
  ).run(pairId, 2n ** 60n);
  db.close();
};

it("reports both sides and keeps the last readings after a paused restart", async () => {
  const pair = { ...pairOf("a"), mode: "download" as const };
  writeFileSync(path.join(pair.localPath, "local.txt"), "hello");
  await syncOnce([pair]);
  expect(engine.status().folderSizes.a).toMatchObject({
    server: { bytes: 0 },
    computer: { bytes: 5 },
  });
  await engine.stop();
  engine = new SyncEngine(
    {
      emit: () => {},
      trash: async () => {},
      watch: async () => () => {},
      log: () => {},
    },
    path.join(root, "data"),
  );
  await engine.configure({ ...configOf([pair]), paused: true });
  expect(engine.status().folderSizes.a).toMatchObject({
    server: { bytes: 0 },
    computer: { bytes: 5 },
  });
});

it("does not reuse readings from another server", async () => {
  const pair = { ...pairOf("a"), mode: "download" as const };
  writeFileSync(path.join(pair.localPath, "local.txt"), "hello");
  await syncOnce([pair]);
  expect(engine.status().folderSizes.a?.computer?.bytes).toBe(5);
  await engine.configure({
    ...configOf([pair]),
    serverUrl: `${serverUrl}/other`,
    paused: true,
  });
  expect(engine.status().folderSizes.a).toBeUndefined();
  await engine.stop();
  engine = new SyncEngine(
    {
      emit: () => {},
      trash: async () => {},
      watch: async () => () => {},
      log: () => {},
    },
    path.join(root, "data"),
  );
  await engine.configure({
    ...configOf([pair]),
    serverUrl: `${serverUrl}/other`,
    paused: true,
  });
  expect(engine.status().folderSizes.a).toBeUndefined();
});

it("keeps the latest readings when paused during a pass", async () => {
  const pair = pairOf("a");
  let scanned!: () => void;
  let finish!: () => void;
  const ready = new Promise<void>((resolve) => {
    scanned = resolve;
  });
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(pairSync, "syncPair").mockImplementation(async (ctx) => {
    ctx.scanned({
      entries: [{ rel: "local", type: "file", size: 7, mtimeMs: 0, ino: "1" }],
      excluded: [],
    });
    scanned();
    await held;
    return { issues: [], hold: null, pullAgain: false, retrySoon: false };
  });
  await engine.configure(configOf([pair]));
  const pass = engine.syncNow();
  await ready;
  const pause = engine.configure({ ...configOf([pair]), paused: true });
  finish();
  await pass;
  await pause;
  expect(engine.status().folderSizes.a?.computer?.bytes).toBe(7);
});

it("does not show pre-transfer readings while a fresh server read is needed", async () => {
  const pair = pairOf("a");
  vi.spyOn(pairSync, "syncPair").mockImplementation(async (ctx) => {
    ctx.scanned({
      entries: [{ rel: "local", type: "file", size: 7, mtimeMs: 0, ino: "1" }],
      excluded: [],
    });
    return { issues: [], hold: null, pullAgain: true, retrySoon: false };
  });
  await syncOnce([pair]);
  expect(engine.status().folderSizes.a).toEqual({
    server: null,
    computer: null,
  });
});

beforeEach(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "staaash-engine-"));
  mkdirSync(path.join(root, "data"));
  replies = { version: VERSION_OK, changes: FEED_OK };
  logged = [];
  emitted = [];
  cancelled = [];
  server = createServer((request, response) => {
    const { pathname, searchParams } = new URL(request.url ?? "", "http://x");
    if (
      request.method === "DELETE" &&
      pathname.startsWith("/api/uploads/sessions/")
    ) {
      cancelled.push(path.basename(pathname));
      return response.writeHead(204).end();
    }
    if (pathname === "/api/version") return replies.version(response);
    if (pathname === "/api/sync/changes") return replies.changes(response);
    if (pathname === "/api/sync/events" && replies.events)
      return replies.events(response);
    if (pathname === "/api/sync/snapshot") {
      if (searchParams.get("folderId") === "root-gone")
        return json(404, {})(response);
      const items =
        searchParams.get("folderId") === "root-b" ? [docsFolder] : [];
      return json(200, { items, changeCursor: "1", next: null })(response);
    }
    return json(404, {})(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  engine = new SyncEngine(
    {
      emit: (event) => {
        if (event.type === "status")
          emitted.push(structuredClone(event.status));
      },
      trash: async () => {},
      watch: async () => () => {},
      log: (stage, error) => logged.push({ stage, error }),
    },
    path.join(root, "data"),
  );
});

it("does not report an empty server folder when both folders are missing", async () => {
  const pair = pairOf("gone");
  rmSync(pair.localPath, { recursive: true });
  await syncOnce([pair]);
  expect(engine.status().folderSizes.gone).toEqual({
    server: null,
    computer: null,
  });
});

afterEach(async () => {
  await engine.stop();
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
});

it("keeps active transfers in place and retains them while recent transfers fill up", async () => {
  vi.spyOn(pairSync, "syncPair").mockImplementation(async ({ activity }) => {
    const transfer = (rel: string) => ({
      pairId: "a",
      rel,
      direction: "up" as const,
      state: "active" as const,
      bytes: 100,
      doneBytes: 0,
      at: 1,
    });
    const first = transfer("first");
    const second = transfer("second");
    activity(first);
    activity(second);
    activity({ ...first, doneBytes: 50 });
    expect(engine.status().activity.map((item) => item.rel)).toEqual([
      "second",
      "first",
    ]);
    expect(engine.status().pendingBytes).toBe(150);

    activity({ ...second, state: "done", at: 2 });
    for (let i = 0; i < 35; i++) {
      const next = transfer(`file-${i}`);
      activity(next);
      activity({ ...next, state: "done", at: i + 3 });
    }
    let status = engine.status();
    expect(status.activity).toHaveLength(30);
    expect(status.pendingFiles).toBe(1);
    expect(status.pendingBytes).toBe(50);
    expect(status.activity.at(-1)).toMatchObject({
      rel: "first",
      state: "active",
    });
    expect(status.activity[0]).toMatchObject({ rel: "file-34", state: "done" });

    activity({ ...first, state: "failed", at: 40 });
    status = engine.status();
    expect(status.activity[0]).toMatchObject({ rel: "first", state: "failed" });
    expect(status.pendingFiles).toBe(0);
    activity(first);
    expect(
      engine.status().activity.filter((item) => item.rel === "first"),
    ).toEqual([first]);
    return { issues: [], hold: null, pullAgain: false, retrySoon: false };
  });
  await syncOnce([pairOf("a")]);
});

it("counts waiting work, bytes moved and folders not checked yet across a pass", async () => {
  const seen: { pair: string; status: ReturnType<typeof engine.status> }[] = [];
  vi.spyOn(pairSync, "syncPair").mockImplementation(
    async ({ pair, activity, waiting }) => {
      if (pair.id === "a") {
        const file = {
          pairId: "a",
          rel: "big.bin",
          direction: "up" as const,
          state: "active" as const,
          bytes: 100,
          doneBytes: 40,
          at: 1,
        };
        waiting({ files: 3, bytes: 300, uploadBytes: 200 });
        activity(file);
        seen.push({ pair: "a", status: engine.status() });
        activity({ ...file, state: "done", doneBytes: 100, at: 2 });
      }
      seen.push({ pair: pair.id, status: engine.status() });
      return { issues: [], hold: null, pullAgain: false, retrySoon: false };
    },
  );
  await syncOnce([pairOf("a"), pairOf("b")]);
  expect(seen.map(({ pair, status }) => [pair, status])).toEqual([
    [
      "a",
      expect.objectContaining({
        pendingFiles: 4,
        pendingBytes: 360,
        uploadRemainingBytes: 200,
        movedBytes: 40,
        uncheckedFolders: 1,
      }),
    ],
    ["a", expect.objectContaining({ pendingFiles: 3, movedBytes: 100 })],
    [
      "b",
      expect.objectContaining({
        pendingFiles: 0,
        pendingBytes: 0,
        movedBytes: 100,
        uncheckedFolders: 0,
      }),
    ],
  ]);
  expect(engine.status()).toMatchObject({ uncheckedFolders: 0, movedBytes: 0 });
});

const cases: [string, Partial<typeof replies>, EngineState][] = [
  ["the server errors but answers", { changes: json(500, {}) }, "problem"],
  [
    "the server answers the check with an error",
    { changes: json(500, {}), version: json(500, {}) },
    "problem",
  ],
  [
    "a proxy answers for a dead server",
    { changes: json(502, {}), version: json(502, {}) },
    "offline",
  ],
  [
    "the connection drops",
    { changes: json(500, {}), version: NO_ANSWER },
    "offline",
  ],
];

describe("resolved operation issues", () => {
  beforeEach(() => {
    vi.spyOn(engine, "request").mockImplementation(() => {});
  });
  const errorOf = (pairId: string): Issue => ({
    pairId,
    rel: "same.txt",
    source: "operation",
    kind: "quota",
    message: "Storage full",
  });
  const resultOf = (issues: Issue[]) => ({
    issues,
    hold: null,
    pullAgain: false,
    retrySoon: true,
  });

  it.each([false, true])(
    "clears a previous error during the pass, even if another folder goes offline: %s",
    async (offline) => {
      const pairs = [pairOf("a"), pairOf("b")];
      const scan: Issue = {
        ...errorOf("a"),
        source: "scan",
        kind: "error",
        message: "Scan warning",
      };
      const remaining = [scan, errorOf("b")];
      const sync = vi
        .spyOn(pairSync, "syncPair")
        .mockImplementation(async ({ pair }) =>
          resultOf(pair.id === "a" ? [errorOf("a"), scan] : [errorOf("b")]),
        );
      await syncOnce(pairs);
      sync.mockImplementationOnce(async ({ resolved }) => {
        resolved("same.txt");
        expect(engine.status().issues).toEqual(remaining);
        await vi.waitFor(() =>
          expect(emitted.at(-1)?.issues).toEqual(remaining),
        );
        return resultOf([scan]);
      });
      sync.mockImplementationOnce(async () => {
        expect(engine.status().issues).toEqual(remaining);
        if (offline) {
          replies.version = NO_ANSWER;
          throw new Error("Connection dropped");
        }
        return resultOf([errorOf("b")]);
      });
      await engine.syncNow();
      expect(engine.status().issues).toEqual(remaining);
      expect(engine.status().state).toBe(offline ? "offline" : "idle");
    },
  );

  it("ignores resolution and final results after the configuration changes", async () => {
    const pairs = [pairOf("a")];
    const issue = errorOf("a");
    const sync = vi
      .spyOn(pairSync, "syncPair")
      .mockResolvedValue(resultOf([issue]));
    await syncOnce(pairs);
    let configured: Promise<void> | undefined;
    sync.mockImplementationOnce(async ({ resolved }) => {
      configured = engine.configure({ ...configOf(pairs), paused: true });
      resolved("same.txt");
      expect(engine.status().issues).toEqual([issue]);
      return resultOf([]);
    });
    await engine.syncNow();
    await configured;
    expect(engine.status().issues).toEqual([issue]);
    expect(engine.status().state).toBe("paused");
  });

  it.each([false, true])(
    "keeps retrying unresolved files, live stream connected: %s",
    async (live) => {
      if (live)
        replies.events = (response) => {
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.write('data: {"type":"changes","latestSeq":"1"}\n\n');
        };
      const request = vi.spyOn(engine, "request").mockImplementation(() => {});
      vi.spyOn(pairSync, "syncPair").mockResolvedValue(
        resultOf([errorOf("a")]),
      );
      await engine.configure(configOf([pairOf("a")]));
      if (live)
        await vi.waitFor(() => expect(request).toHaveBeenCalledWith(250));
      await engine.syncNow();
      expect(request).toHaveBeenLastCalledWith(live ? 5000 : 60_000);
      expect(engine.status().issues).toEqual([errorOf("a")]);
    },
  );
});

describe("what the engine says when a pass fails", () => {
  it.each(cases)("when %s", async (_name, reply, state) => {
    replies = { ...replies, ...reply };
    const status = await syncOnce([pairOf("a")]);
    expect(status.state).toBe(state);
    expect(status.lastSyncAt).toBeNull();
    expect(logged.map((each) => each.stage)).toEqual([
      "reading server changes",
    ]);
  });

  it("does not blame the server for a local database failure", async () => {
    const pair = pairOf("a");
    breakHistory("a");
    const status = await syncOnce([pair]);
    expect(status.state).toBe("problem");
    const [first] = logged;
    expect(first?.stage).toBe("sync folder a");
    expect(first?.error).toMatchObject({ code: "ERR_OUT_OF_RANGE" });
  });

  it("clears the problem once a pass works", async () => {
    replies.changes = json(500, {});
    expect((await syncOnce([pairOf("a")])).state).toBe("problem");
    replies.changes = FEED_OK;
    await engine.syncNow();
    expect(engine.status().state).toBe("idle");
  });
});

describe("one failing folder", () => {
  it("does not stop the next one", async () => {
    const a = pairOf("a");
    const b = pairOf("b");
    breakHistory("a");
    const status = await syncOnce([a, b]);
    expect(existsSync(path.join(b.localPath, "docs"))).toBe(true);
    expect(status.state).toBe("problem");
    expect(status.issues).toEqual([
      expect.objectContaining({ pairId: "a", kind: "error", rel: "" }),
    ]);
  });

  it("ends the pass when the server is gone too", async () => {
    const a = pairOf("a");
    const b = pairOf("b");
    await syncOnce([a, b]);
    rmSync(path.join(b.localPath, "docs"), { recursive: true, force: true });
    breakHistory("a");
    replies.version = NO_ANSWER;
    await engine.syncNow();
    expect(engine.status().state).toBe("offline");
    expect(existsSync(path.join(b.localPath, "docs"))).toBe(false);
  });
});

describe("unfinished uploads", () => {
  /** An upload the app started and has not finished, as it saves one. */
  const pending = (pairId: string, rel: string, sessionId: string) => {
    const db = new DatabaseSync(path.join(root, "data", "sync.db"));
    db.prepare("INSERT INTO upload VALUES (?, ?, ?, 1, 1, 't')").run(
      pairId,
      rel,
      sessionId,
    );
    db.close();
  };
  const left = () => {
    const db = new DatabaseSync(path.join(root, "data", "sync.db"));
    const rows = db.prepare("SELECT sessionId FROM upload").all();
    db.close();
    return rows.map((row) => row.sessionId);
  };

  it("cancels one whose folder the pair now leaves out", async () => {
    const pair = { ...pairOf("a"), skipPaths: ["Videos/raw"] } as SyncPair;
    mkdirSync(path.join(pair.localPath, "Videos", "raw"), { recursive: true });
    writeFileSync(path.join(pair.localPath, "Videos", "raw", "big.mov"), "x");
    pending("a", "Videos/raw/big.mov", "skipped");
    await syncOnce([pair]);
    expect(cancelled).toEqual(["skipped"]);
    expect(left()).toEqual([]);
  });

  it("cancels one whose name an ignore rule now matches", async () => {
    const pair = pairOf("a");
    writeFileSync(path.join(pair.localPath, "big.mov"), "x");
    pending("a", "big.mov", "ignored");
    await engine.configure({ ...configOf([pair]), ignore: ["*.mov"] });
    await engine.syncNow();
    expect(cancelled).toEqual(["ignored"]);
  });

  it("keeps one it cannot check and still cancels the rest", async () => {
    const pair = pairOf("a");
    // A file where a folder should be: checking the path fails, not "gone".
    writeFileSync(path.join(pair.localPath, "notes"), "x");
    pending("a", "notes/inner.bin", "unreadable");
    pending("a", "deleted.bin", "gone");
    const status = await syncOnce([pair]);
    expect(cancelled).toEqual(["gone"]);
    expect(left()).toEqual(["unreadable"]);
    expect(status.state).not.toBe("problem");
    expect(logged.map((entry) => entry.stage)).toContain(
      "checking the upload of notes/inner.bin",
    );
  });
});
