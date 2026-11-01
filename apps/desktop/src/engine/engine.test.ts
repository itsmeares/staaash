import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { EngineConfig, EngineState, SyncPair } from "../shared/types";
import { SyncEngine } from "./engine";

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
let replies: { version: Reply; changes: Reply };
let engine: SyncEngine;
let logged: { stage: string; error: unknown }[];

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

beforeEach(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "staaash-engine-"));
  mkdirSync(path.join(root, "data"));
  replies = { version: VERSION_OK, changes: FEED_OK };
  logged = [];
  server = createServer((request, response) => {
    const { pathname, searchParams } = new URL(request.url ?? "", "http://x");
    if (pathname === "/api/version") return replies.version(response);
    if (pathname === "/api/sync/changes") return replies.changes(response);
    if (pathname === "/api/sync/snapshot") {
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
      emit: () => {},
      trash: async () => {},
      watch: async () => () => {},
      log: (stage, error) => logged.push({ stage, error }),
    },
    path.join(root, "data"),
  );
});

afterEach(async () => {
  await engine.stop();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
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
