import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vite-plus/test";

import type { EngineConfig, EngineEvent, SyncMode } from "../shared/types";
import { SyncEngine } from "./engine";

/**
 * The engine against a real Staaash server: the system test stack sets
 * STAAASH_SYNC_TEST_ORIGIN and signs in with its bootstrap owner.
 */
const origin = process.env.STAAASH_SYNC_TEST_ORIGIN;
const EMAIL = "owner-e2e@staaash.test";
const PASSWORD = "staaash-owner-pass";

let cookie = "";
let token = "";

const web = async (pathname: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  headers.set("origin", origin ?? "");
  const response = await fetch(new URL(pathname, origin), { ...init, headers });
  if (!response.ok) {
    throw new Error(`${pathname}: ${response.status} ${await response.text()}`);
  }
  return response;
};

/** The browser half of device sign-in, then the app's token exchange. */
const signInDevice = async () => {
  const signIn = await web("/api/auth/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  cookie = signIn.headers
    .getSetCookie()
    .map((each) => each.split(";")[0])
    .join("; ");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = "http://127.0.0.1:9/callback";
  const approved = (await (
    await web("/api/auth/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirectUri,
        codeChallenge: challenge,
        deviceName: "Sync test",
      }),
    })
  ).json()) as { redirectUrl: string };
  const code = new URL(approved.redirectUrl).searchParams.get("code");
  const exchanged = (await (
    await web("/api/auth/device/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, codeVerifier: verifier, redirectUri }),
    })
  ).json()) as { token: string };
  return exchanged.token;
};

/** Another client: the web app, signed in with the browser cookie. */
const server = {
  createFolder: async (name: string, parentId: string | null = null) =>
    (
      (await (
        await web("/api/files/folders", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parentId, name }),
        })
      ).json()) as { folder: { id: string } }
    ).folder.id,
  upload: async (folderId: string, name: string, text: string) => {
    const form = new FormData();
    form.set("folderId", folderId);
    form.set(
      "manifest",
      JSON.stringify([
        { clientKey: "0", originalName: name, conflictStrategy: "replace" },
      ]),
    );
    form.append("files", new Blob([text]), name);
    await web("/api/files/files", { method: "POST", body: form });
  },
  list: async (folderId: string) => {
    const page = (await (
      await web(`/api/sync/snapshot?folderId=${folderId}&limit=5000`)
    ).json()) as {
      items: {
        id: string;
        type: string;
        path: string;
        name: string;
        parentId: string;
        contentChecksum: string | null;
      }[];
    };
    return page.items;
  },
  read: async (fileId: string) =>
    (await web(`/api/files/files/${fileId}/download`)).text(),
  post: (pathname: string, body: unknown = {}) =>
    web(pathname, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
};

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** Written a while ago, so the engine treats the file as finished. */
const writeOld = async (file: string, text: string) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  const past = new Date(Date.now() - 60_000);
  await utimes(file, past, past);
};

const rigs: { engine: SyncEngine; root: string }[] = [];
/** Server folders the tests made; removed for good at the end. */
const made = new Set<string>();

const rig = async (
  mode: SyncMode = "two-way",
  existingFolderId?: string,
  extra: Partial<EngineConfig> = {},
) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staaash-sync-"));
  const local = path.join(root, "local");
  const trash = path.join(root, "trash");
  const data = path.join(root, "data");
  await mkdir(local);
  await mkdir(trash);
  await mkdir(data);
  const folderId =
    existingFolderId ?? (await server.createFolder(`sync-${randomUUID()}`));
  made.add(folderId);
  const notes: string[] = [];
  const events: EngineEvent[] = [];
  let config: EngineConfig = {
    serverUrl: origin ?? "",
    token,
    deviceName: "Test PC",
    pairs: [
      {
        id: "pair",
        localPath: local,
        remoteFolderId: folderId,
        remoteLabel: "test",
        mode,
      },
    ],
    ignore: [],
    minFreeBytes: 0,
    uploadLimitKBps: null,
    downloadLimitKBps: null,
    paused: false,
    ...extra,
  };
  const start = async () => {
    const engine = new SyncEngine(
      {
        emit: (event) => {
          events.push(event);
          if (event.type === "notify") notes.push(event.title);
        },
        trash: async (file) => {
          await rename(
            file,
            path.join(trash, `${randomUUID()}-${path.basename(file)}`),
          );
        },
        watch: async () => () => {},
        log: () => {},
      },
      data,
    );
    await engine.configure(config);
    return engine;
  };
  const result = {
    root,
    local,
    trash,
    folderId,
    engine: await start(),
    notes,
    events,
    at: (rel: string) => path.join(local, ...rel.split("/")),
    /** Runs passes until one finds nothing to do. */
    sync: async () => {
      await result.engine.syncNow();
      await result.engine.syncNow();
    },
    configure: async (patch: Partial<EngineConfig>) => {
      config = { ...config, ...patch };
      await result.engine.configure(config);
    },
    /**
     * Stops the engine as the app does on quit, runs `whileStopped`, and
     * starts a new one on the same data.
     */
    restart: async (whileStopped: () => Promise<void> = async () => {}) => {
      await result.engine.stop();
      await whileStopped();
      result.engine = await start();
    },
    /**
     * Runs `change`, syncs, then puts the sync history back to what it was
     * before: the files and the server moved on, but the app stopped before
     * it saved that. Then a new engine syncs again.
     */
    interrupted: async (change: () => Promise<void>) => {
      await result.engine.stop();
      const saved = history(data);
      result.engine = await start();
      await change();
      await result.sync();
      await result.engine.stop();
      restoreHistory(data, saved);
      result.engine = await start();
      await result.sync();
    },
    remote: async () =>
      new Map(
        (await server.list(folderId)).map((item) => [
          item.path.split("/").slice(1).join("/"),
          item,
        ]),
      ),
  };
  rigs.push(result);
  return result;
};

const HISTORY_TABLES = ["base", "upload", "conflict"];

/** Transfers finished so far. */
const finished = (engine: SyncEngine) =>
  engine.status().activity.filter((each) => each.state === "done").length;

/** Waits until a transfer is running and has moved some bytes. */
const transferStarted = async (engine: SyncEngine) => {
  for (let tries = 0; tries < 200; tries += 1) {
    const moving = engine
      .status()
      .activity.some((each) => each.state === "active" && each.doneBytes > 0);
    if (moving) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("No transfer started.");
};

/** Upload sessions the engine has open on the server. */
const pendingSessions = (root: string) => {
  const db = new DatabaseSync(path.join(root, "data", "sync.db"));
  const rows = db.prepare("SELECT sessionId FROM upload").all() as {
    sessionId: string;
  }[];
  db.close();
  return rows.map((row) => row.sessionId);
};

/** The engine's saved sync history: what both sides last agreed on. */
const history = (data: string) => {
  const db = new DatabaseSync(path.join(data, "sync.db"));
  const rows = Object.fromEntries(
    HISTORY_TABLES.map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table}`).all(),
    ]),
  );
  db.close();
  return rows;
};

const restoreHistory = (data: string, rows: ReturnType<typeof history>) => {
  const db = new DatabaseSync(path.join(data, "sync.db"));
  for (const table of HISTORY_TABLES) {
    db.exec(`DELETE FROM ${table}`);
    for (const row of rows[table] ?? []) {
      const columns = Object.keys(row);
      db.prepare(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      ).run(...(Object.values(row) as SQLInputValue[]));
    }
  }
  db.close();
};

/** Everything under a folder, by relative path, with file contents. */
const tree = async (dir: string, rel = ""): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const entry of await readdir(path.join(dir, rel), {
    withFileTypes: true,
  })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out[`${child}/`] = "";
      Object.assign(out, await tree(dir, child));
    } else {
      out[child] = await readFile(path.join(dir, child), "utf8");
    }
  }
  return out;
};

describe.skipIf(!origin)("sync against a real server", () => {
  beforeAll(async () => {
    token = await signInDevice();
  });

  // The stack runs other suites after this one, and its backup check
  // copies every stored byte; leave nothing behind.
  afterAll(async () => {
    for (const id of made) {
      await server.post(`/api/files/folders/${id}/trash`).catch(() => {});
    }
    await server.post("/api/files/trash/clear");
  }, 120_000);

  afterEach(async () => {
    for (const each of rigs.splice(0)) {
      await each.engine.stop();
      await rm(each.root, { recursive: true, force: true });
    }
  });

  it("uploads new local files and folders", async () => {
    const r = await rig();
    await writeOld(r.at("a.txt"), "alpha");
    await writeOld(r.at("docs/deep/b.txt"), "beta");
    await writeOld(r.at("empty.txt"), "");
    await r.sync();
    const remote = await r.remote();
    expect(remote.get("a.txt")?.contentChecksum).toBe(sha("alpha"));
    expect(remote.get("docs/deep/b.txt")?.contentChecksum).toBe(sha("beta"));
    expect(remote.has("empty.txt")).toBe(true);
  });

  it("downloads server files with their contents", async () => {
    const r = await rig();
    const sub = await server.createFolder("photos", r.folderId);
    await server.upload(sub, "c.txt", "gamma");
    await r.sync();
    expect(await readFile(r.at("photos/c.txt"), "utf8")).toBe("gamma");
    expect(await readdir(r.local)).toEqual(["photos"]);
  });

  it("replaces an edited file in place, keeping its server id", async () => {
    const r = await rig();
    await writeOld(r.at("a.txt"), "one");
    await r.sync();
    const before = (await r.remote()).get("a.txt");
    await writeOld(r.at("a.txt"), "two!");
    await r.sync();
    const after = (await r.remote()).get("a.txt");
    expect(after?.id).toBe(before?.id);
    expect(after?.contentChecksum).toBe(sha("two!"));
  });

  it("follows a server edit", async () => {
    const r = await rig();
    await writeOld(r.at("a.txt"), "one");
    await r.sync();
    await server.upload(r.folderId, "a.txt", "server edit");
    await r.sync();
    expect(await readFile(r.at("a.txt"), "utf8")).toBe("server edit");
  });

  it("repeats a server rename locally without downloading again", async () => {
    const r = await rig();
    await writeOld(r.at("a.txt"), "rename me");
    await r.sync();
    const { ino } = await stat(r.at("a.txt"));
    const file = (await r.remote()).get("a.txt");
    await server.post(`/api/files/files/${file?.id}/rename`, { name: "b.txt" });
    await r.sync();
    expect(existsSync(r.at("a.txt"))).toBe(false);
    expect((await stat(r.at("b.txt"))).ino).toBe(ino);
  });

  it("repeats a local rename and move on the server, keeping the id", async () => {
    const r = await rig();
    await writeOld(r.at("a.txt"), "move me");
    await mkdir(r.at("inbox"));
    await r.sync();
    const before = (await r.remote()).get("a.txt");
    await rename(r.at("a.txt"), r.at("inbox/b.txt"));
    await r.sync();
    const remote = await r.remote();
    expect(remote.has("a.txt")).toBe(false);
    expect(remote.get("inbox/b.txt")?.id).toBe(before?.id);
  });

  it("trashes on the server what was deleted here, and here what the server trashed", async () => {
    const r = await rig();
    await writeOld(r.at("mine.txt"), "1");
    await writeOld(r.at("theirs.txt"), "2");
    await r.sync();
    await rm(r.at("mine.txt"));
    const theirs = (await r.remote()).get("theirs.txt");
    await server.post(`/api/files/files/${theirs?.id}/trash`);
    await r.sync();
    expect((await r.remote()).has("mine.txt")).toBe(false);
    expect(existsSync(r.at("theirs.txt"))).toBe(false);
    expect(
      (await readdir(r.trash)).some((name) => name.endsWith("theirs.txt")),
    ).toBe(true);
  });

  it("keeps both versions after a conflict, and keep-mine settles it", async () => {
    const r = await rig();
    await writeOld(r.at("report.txt"), "base");
    await r.sync();
    const original = (await r.remote()).get("report.txt");
    await server.upload(r.folderId, "report.txt", "theirs");
    await writeOld(r.at("report.txt"), "mine");
    await r.sync();
    const names = await readdir(r.local);
    const copy = names.find((name) =>
      name.startsWith("report (conflict, Test PC,"),
    );
    expect(copy).toBeDefined();
    expect(await readFile(r.at("report.txt"), "utf8")).toBe("theirs");
    expect(await readFile(r.at(copy ?? ""), "utf8")).toBe("mine");
    expect(r.notes).toContain("Sync conflict");

    const [conflict] = r.engine.status().conflicts;
    expect(conflict?.copyRel).toBe(copy);
    await r.engine.resolveConflict(conflict?.id ?? 0, "keep-mine");
    await r.sync();
    expect(await readFile(r.at("report.txt"), "utf8")).toBe("mine");
    expect(existsSync(r.at(copy ?? ""))).toBe(false);
    const after = (await r.remote()).get("report.txt");
    expect(after?.id).toBe(original?.id);
    expect(after?.contentChecksum).toBe(sha("mine"));
    expect(r.engine.status().conflicts).toEqual([]);
  });

  it("download-only keeps a local edit aside and restores the server version", async () => {
    const r = await rig("download");
    await server.upload(r.folderId, "a.txt", "server");
    await r.sync();
    await writeOld(r.at("a.txt"), "local edit");
    await writeOld(r.at("local-only.txt"), "stays here");
    await r.sync();
    expect(await readFile(r.at("a.txt"), "utf8")).toBe("server");
    const names = await readdir(r.local);
    expect(names.some((name) => name.startsWith("a (conflict, Test PC,"))).toBe(
      true,
    );
    expect((await r.remote()).size).toBe(1);
  });

  it("upload-only wins a conflict and sends the server's version to the trash", async () => {
    const r = await rig("upload");
    await writeOld(r.at("a.txt"), "base");
    await r.sync();
    const original = (await r.remote()).get("a.txt");
    await server.upload(r.folderId, "a.txt", "server edit");
    await writeOld(r.at("a.txt"), "computer wins");
    await r.sync();
    const after = (await r.remote()).get("a.txt");
    expect(after?.id).toBe(original?.id);
    expect(await server.read(after?.id ?? "")).toBe("computer wins");
    expect((await r.remote()).size).toBe(1);
  });

  it("sends a big file in chunks and brings it back intact", async () => {
    const r = await rig();
    const big = randomBytes(40 * 1024 * 1024);
    await mkdir(r.at("video"));
    await writeFile(r.at("video/big.bin"), big);
    const past = new Date(Date.now() - 60_000);
    await utimes(r.at("video/big.bin"), past, past);
    await r.sync();
    const hash = createHash("sha256").update(big).digest("hex");
    expect((await r.remote()).get("video/big.bin")?.contentChecksum).toBe(hash);

    const other = await rig("download", r.folderId);
    await other.sync();
    const copy = await readFile(other.at("video/big.bin"));
    expect(createHash("sha256").update(copy).digest("hex")).toBe(hash);
    expect((await stat(other.at("video/big.bin"))).mtimeMs).toBe(
      past.getTime(),
    );
  });

  it("moves a whole folder locally when the server renames it", async () => {
    const r = await rig();
    await writeOld(r.at("old/one.txt"), "1");
    await writeOld(r.at("old/two.txt"), "2");
    await r.sync();
    const { ino } = await stat(r.at("old"));
    const folder = (await r.remote()).get("old");
    await server.post(`/api/files/folders/${folder?.id}/rename`, {
      name: "new",
    });
    await r.sync();
    expect((await stat(r.at("new"))).ino).toBe(ino);
    expect(existsSync(r.at("old"))).toBe(false);
    expect(await readFile(r.at("new/two.txt"), "utf8")).toBe("2");
    expect((await readdir(r.trash)).length).toBe(0);
  });

  it("upload-only keeps the server copy of a file deleted here", async () => {
    const r = await rig("upload");
    await writeOld(r.at("keep.txt"), "backup");
    await r.sync();
    await rm(r.at("keep.txt"));
    await r.sync();
    expect((await r.remote()).get("keep.txt")?.contentChecksum).toBe(
      sha("backup"),
    );
    expect(existsSync(r.at("keep.txt"))).toBe(false);
  });

  it("stops when every file of a big folder disappears locally", async () => {
    const r = await rig();
    for (let index = 0; index < 10; index += 1) {
      await writeOld(r.at(`f${index}.txt`), String(index));
    }
    await r.sync();
    for (const name of await readdir(r.local)) await rm(r.at(name));
    await r.sync();
    expect((await r.remote()).size).toBe(10);
    expect(r.engine.status().issues.map((issue) => issue.kind)).toEqual([
      "folder-emptied",
    ]);
    await r.engine.resolvePair("pair", "download-again");
    await r.sync();
    expect((await readdir(r.local)).length).toBe(10);
  });
  it("keeps the id, share links and favorites when a file is emptied", async () => {
    const r = await rig();
    await writeOld(r.at("notes.txt"), "something");
    await r.sync();
    const before = (await r.remote()).get("notes.txt");
    await writeOld(r.at("notes.txt"), "");
    await r.sync();
    const after = (await r.remote()).get("notes.txt");
    expect(after?.id).toBe(before?.id);
    expect(after?.contentChecksum).toBe(sha(""));
  });

  it("links an identical local copy of a server file with no checksum", async () => {
    // Only the seeded file has none; the upload routes always record one.
    const folders = (await (await web("/api/files/folders/tree")).json()) as {
      folders: { id: string; isFilesRoot: boolean }[];
    };
    const drive = folders.folders.find((each) => each.isFilesRoot)?.id ?? "";
    const top = await server.list(drive);
    const seeded = top.find(
      (each) => each.name === "shared-preview.png" && !each.contentChecksum,
    );
    expect(seeded).toBeDefined();
    const everythingElse = top
      .filter(
        (each) => each.parentId === drive && each.name !== "shared-preview.png",
      )
      .map((each) => each.name);
    const r = await rig("two-way", drive, {
      paused: true,
      ignore: everythingElse,
    });
    made.delete(drive);
    const bytes = Buffer.from(
      await (
        await web(`/api/files/files/${seeded?.id}/download`)
      ).arrayBuffer(),
    );
    await mkdir(r.local, { recursive: true });
    await writeFile(r.at("shared-preview.png"), bytes);
    await r.configure({ paused: false });
    await r.sync();
    expect(await readdir(r.local)).toEqual(["shared-preview.png"]);
    expect(await readdir(r.trash)).toEqual([]);
    const done = finished(r.engine);
    await r.sync();
    expect(finished(r.engine)).toBe(done);
  });

  describe("skipped folders", () => {
    const skipping = (r: Awaited<ReturnType<typeof rig>>, id: string) => ({
      id: "pair",
      localPath: r.local,
      remoteFolderId: r.folderId,
      remoteLabel: "test",
      mode: "two-way" as const,
      skipFolders: [{ id, label: "lexend" }],
    });

    it("syncs the rest of a folder and leaves a skipped folder alone", async () => {
      // Paused, so no pass sees the new folder before the skip is set.
      const r = await rig("two-way", undefined, { paused: true });
      const left = await server.createFolder("lexend", r.folderId);
      await server.upload(left, "server.txt", "server");
      await server.upload(r.folderId, "top.txt", "top");
      await r.configure({ pairs: [skipping(r, left)], paused: false });
      await writeOld(r.at("mine.txt"), "mine");
      await writeOld(r.at("lexend/local.txt"), "local");
      await r.sync();
      expect(await tree(r.local)).toEqual({
        "lexend/": "",
        "lexend/local.txt": "local",
        "mine.txt": "mine",
        "top.txt": "top",
      });
      const remote = await r.remote();
      expect(remote.get("mine.txt")?.contentChecksum).toBe(sha("mine"));
      expect(remote.get("lexend/server.txt")?.contentChecksum).toBe(
        sha("server"),
      );
      expect(remote.has("lexend/local.txt")).toBe(false);
    });

    it("syncs a skipped folder through its own pair, elsewhere", async () => {
      // Paused, so no pass sees the new folder before the skip is set.
      const r = await rig("two-way", undefined, { paused: true });
      const left = await server.createFolder("lexend", r.folderId);
      const elsewhere = path.join(r.root, "elsewhere");
      await mkdir(elsewhere);
      await writeOld(path.join(elsewhere, "font.txt"), "font");
      await server.upload(r.folderId, "top.txt", "top");
      await r.configure({
        paused: false,
        pairs: [
          skipping(r, left),
          {
            id: "own",
            localPath: elsewhere,
            remoteFolderId: left,
            remoteLabel: "lexend",
            mode: "upload",
          },
        ],
      });
      await r.sync();
      expect(await tree(r.local)).toEqual({ "top.txt": "top" });
      expect((await r.remote()).get("lexend/font.txt")?.contentChecksum).toBe(
        sha("font"),
      );
      expect(await readdir(r.trash)).toEqual([]);
    });

    it("trashes nothing when a synced folder becomes skipped, and combines when it comes back", async () => {
      const r = await rig();
      await writeOld(r.at("docs/a.txt"), "a");
      await r.sync();
      const docs = (await r.remote()).get("docs");
      await r.configure({ pairs: [skipping(r, docs?.id ?? "")] });
      await writeOld(r.at("docs/b.txt"), "b");
      await r.sync();
      expect(await readdir(r.trash)).toEqual([]);
      expect((await r.remote()).has("docs/b.txt")).toBe(false);
      await r.configure({
        pairs: [{ ...skipping(r, ""), skipFolders: [] }],
      });
      await r.sync();
      expect((await r.remote()).get("docs/a.txt")?.contentChecksum).toBe(
        sha("a"),
      );
      expect((await r.remote()).get("docs/b.txt")?.contentChecksum).toBe(
        sha("b"),
      );
    });
  });

  describe("ignored names", () => {
    it("keeps the server copy of a synced file once its name is ignored", async () => {
      const r = await rig();
      await writeOld(r.at("a.txt"), "alpha");
      await writeOld(r.at("cache/x.bin"), "x");
      await r.sync();
      await r.configure({ ignore: ["a.txt", "cache"] });
      await r.sync();
      await rm(r.at("a.txt"));
      await rm(r.at("cache"), { recursive: true });
      await r.sync();
      const remote = await r.remote();
      expect(remote.get("a.txt")?.contentChecksum).toBe(sha("alpha"));
      expect(remote.get("cache/x.bin")?.contentChecksum).toBe(sha("x"));
    });

    it("neither downloads nor trashes a server file with an ignored name", async () => {
      const r = await rig();
      await server.upload(r.folderId, "report.tmp", "keep me");
      await server.upload(r.folderId, "real.txt", "real");
      await r.sync();
      await r.sync();
      expect(await tree(r.local)).toEqual({ "real.txt": "real" });
      expect((await r.remote()).get("report.tmp")?.contentChecksum).toBe(
        sha("keep me"),
      );
    });

    it("never trashes the contents of a folder renamed here to an ignored name", async () => {
      const r = await rig();
      await writeOld(r.at("docs/a.txt"), "a");
      await r.sync();
      const before = (await r.remote()).get("docs/a.txt");
      await rename(r.at("docs"), r.at("docs.tmp"));
      await r.sync();
      expect((await r.remote()).get("docs/a.txt")?.id).toBe(before?.id);
      expect(await readFile(r.at("docs/a.txt"), "utf8")).toBe("a");
      expect(await readFile(r.at("docs.tmp/a.txt"), "utf8")).toBe("a");
      expect(await readdir(r.trash)).toEqual([]);
    });

    it("never trashes local files when the server renames their folder to an ignored name", async () => {
      const r = await rig();
      await writeOld(r.at("docs/a.txt"), "a");
      await r.sync();
      const folder = (await r.remote()).get("docs");
      await server.post(`/api/files/folders/${folder?.id}/rename`, {
        name: "docs.tmp",
      });
      await r.sync();
      expect(await readFile(r.at("docs/a.txt"), "utf8")).toBe("a");
      expect(await readdir(r.trash)).toEqual([]);
      const remote = await r.remote();
      expect(remote.get("docs.tmp/a.txt")?.contentChecksum).toBe(sha("a"));
      expect(remote.get("docs/a.txt")?.contentChecksum).toBe(sha("a"));
    });

    it("re-downloads, never trashes, a file renamed here to an ignored name", async () => {
      const r = await rig();
      await writeOld(r.at("draft.txt"), "draft");
      await r.sync();
      await rename(r.at("draft.txt"), r.at("draft.tmp"));
      await r.sync();
      expect((await r.remote()).get("draft.txt")?.contentChecksum).toBe(
        sha("draft"),
      );
      expect(await readFile(r.at("draft.txt"), "utf8")).toBe("draft");
    });
  });

  describe("stopped before the sync history was saved", () => {
    const settled = async (r: Awaited<ReturnType<typeof rig>>) => {
      expect(r.engine.status().conflicts).toEqual([]);
      expect(await readdir(r.trash)).toEqual([]);
      const names = await readdir(r.local, { recursive: true });
      expect(names.filter((name) => name.includes("conflict"))).toEqual([]);
    };

    it("after a download", async () => {
      const r = await rig();
      await r.interrupted(() =>
        server.upload(r.folderId, "new.txt", "from the server"),
      );
      expect(await tree(r.local)).toEqual({ "new.txt": "from the server" });
      expect((await r.remote()).size).toBe(1);
      await settled(r);
    });

    it("after an upload", async () => {
      const r = await rig();
      await r.interrupted(() => writeOld(r.at("new.txt"), "from here"));
      const remote = await r.remote();
      expect(remote.size).toBe(1);
      expect(remote.get("new.txt")?.contentChecksum).toBe(sha("from here"));
      await settled(r);
    });

    it("after an edit was uploaded", async () => {
      const r = await rig();
      await writeOld(r.at("a.txt"), "one");
      await r.sync();
      const id = (await r.remote()).get("a.txt")?.id;
      await r.interrupted(() => writeOld(r.at("a.txt"), "two"));
      const after = (await r.remote()).get("a.txt");
      expect(after?.id).toBe(id);
      expect(after?.contentChecksum).toBe(sha("two"));
      await settled(r);
    });

    it("after a server edit was downloaded", async () => {
      const r = await rig();
      await writeOld(r.at("a.txt"), "one");
      await r.sync();
      await r.interrupted(() => server.upload(r.folderId, "a.txt", "two"));
      expect(await tree(r.local)).toEqual({ "a.txt": "two" });
      await settled(r);
    });

    it("after a server rename was repeated here", async () => {
      const r = await rig();
      await writeOld(r.at("docs/a.txt"), "a");
      await r.sync();
      const folder = (await r.remote()).get("docs");
      await r.interrupted(async () => {
        await server.post(`/api/files/folders/${folder?.id}/rename`, {
          name: "papers",
        });
      });
      expect(await tree(r.local)).toEqual({
        "papers/": "",
        "papers/a.txt": "a",
      });
      expect((await r.remote()).get("papers")?.id).toBe(folder?.id);
      await settled(r);
    });

    it("after a local rename was repeated on the server", async () => {
      const r = await rig();
      await writeOld(r.at("a.txt"), "a");
      await r.sync();
      const id = (await r.remote()).get("a.txt")?.id;
      await r.interrupted(() => rename(r.at("a.txt"), r.at("b.txt")));
      const remote = await r.remote();
      expect([...remote.keys()]).toEqual(["b.txt"]);
      expect(remote.get("b.txt")?.id).toBe(id);
      await settled(r);
    });

    it("between moving a file on the server and renaming it", async () => {
      const r = await rig();
      await writeOld(r.at("A/old.txt"), "moving");
      await mkdir(r.at("B"));
      await r.sync();
      const remote = await r.remote();
      const file = remote.get("A/old.txt");
      // Here: moved and renamed. Server: only the move went through.
      await rename(r.at("A/old.txt"), r.at("B/new.txt"));
      await server.post(`/api/files/files/${file?.id}/move`, {
        destinationFolderId: remote.get("B")?.id,
      });
      await r.sync();
      const after = await r.remote();
      expect(after.get("B/new.txt")?.id).toBe(file?.id);
      expect([...after.keys()].sort()).toEqual(["A", "B", "B/new.txt"]);
      expect(await tree(r.local)).toEqual({
        "A/": "",
        "B/": "",
        "B/new.txt": "moving",
      });
      await settled(r);
    });

    it("after a delete on each side was repeated on the other", async () => {
      const r = await rig();
      await writeOld(r.at("mine.txt"), "m");
      await writeOld(r.at("theirs.txt"), "t");
      await r.sync();
      const theirs = (await r.remote()).get("theirs.txt");
      await r.interrupted(async () => {
        await rm(r.at("mine.txt"));
        await server.post(`/api/files/files/${theirs?.id}/trash`);
      });
      expect(await tree(r.local)).toEqual({});
      expect((await r.remote()).size).toBe(0);
      // The engine trashed theirs.txt here in the first run.
      expect((await readdir(r.trash)).length).toBe(1);
    });
  });

  describe("failures during transfers", () => {
    it("reports a file it cannot read, keeps its server copy, and syncs the rest", async () => {
      const r = await rig();
      await writeOld(r.at("locked.txt"), "one");
      await r.sync();
      await writeOld(r.at("locked.txt"), "two");
      await chmod(r.at("locked.txt"), 0o000);
      await writeOld(r.at("other.txt"), "other");
      try {
        await r.sync();
        const remote = await r.remote();
        expect(remote.get("locked.txt")?.contentChecksum).toBe(sha("one"));
        expect(remote.get("other.txt")?.contentChecksum).toBe(sha("other"));
        expect(r.engine.status().state).toBe("idle");
        expect(
          r.engine.status().issues.some((each) => each.rel === "locked.txt"),
        ).toBe(true);
      } finally {
        await chmod(r.at("locked.txt"), 0o644);
      }
      await r.sync();
      expect((await r.remote()).get("locked.txt")?.contentChecksum).toBe(
        sha("two"),
      );
    });

    it("reports a folder it cannot write to and downloads the rest", async () => {
      const r = await rig();
      await writeOld(r.at("shut/a.txt"), "a");
      await r.sync();
      const shut = (await r.remote()).get("shut");
      await chmod(r.at("shut"), 0o555);
      await server.upload(shut?.id ?? "", "b.txt", "b");
      await server.upload(r.folderId, "c.txt", "c");
      try {
        await r.sync();
        expect(await readFile(r.at("c.txt"), "utf8")).toBe("c");
        expect(existsSync(r.at("shut/b.txt"))).toBe(false);
        expect(r.engine.status().state).toBe("idle");
        expect(
          r.engine.status().issues.some((each) => each.rel === "shut/b.txt"),
        ).toBe(true);
      } finally {
        await chmod(r.at("shut"), 0o755);
      }
      await r.sync();
      expect(await readFile(r.at("shut/b.txt"), "utf8")).toBe("b");
      expect(await readdir(r.at("shut"))).toEqual(["a.txt", "b.txt"]);
    });

    it("stops cleanly when the device is signed out mid-upload, leaving no partial file", async () => {
      const own = await signInDevice();
      const r = await rig("two-way", undefined, {
        token: own,
        uploadLimitKBps: 8 * 1024,
      });
      const big = randomBytes(40 * 1024 * 1024);
      await writeFile(r.at("big.bin"), big);
      const past = new Date(Date.now() - 60_000);
      await utimes(r.at("big.bin"), past, past);
      const syncing = r.engine.syncNow();
      // Sign out once some bytes are on their way.
      await transferStarted(r.engine);
      await fetch(new URL("/api/auth/sign-out", origin), {
        method: "POST",
        headers: { authorization: `Bearer ${own}` },
      });
      await syncing;
      expect(r.events.some((event) => event.type === "signed-out")).toBe(true);
      expect(r.engine.status().state).toBe("signed-out");
      expect((await r.remote()).has("big.bin")).toBe(false);
      // The revoked device could not cancel its upload; the owner can.
      for (const id of pendingSessions(r.root)) {
        await web(`/api/uploads/sessions/${id}`, { method: "DELETE" });
      }
      expect(
        createHash("sha256")
          .update(await readFile(r.at("big.bin")))
          .digest("hex"),
      ).toBe(createHash("sha256").update(big).digest("hex"));
    });

    it("finishes an interrupted upload-only edit as keep-mine after the server changed", async () => {
      const r = await rig("upload", undefined, { uploadLimitKBps: 8 * 1024 });
      await writeOld(r.at("report.txt"), "base");
      await r.sync();
      const original = (await r.remote()).get("report.txt");
      const edit = randomBytes(24 * 1024 * 1024);
      await writeFile(r.at("report.txt"), edit);
      const past = new Date(Date.now() - 60_000);
      await utimes(r.at("report.txt"), past, past);
      const syncing = r.engine.syncNow();
      await transferStarted(r.engine);
      let replacement: string | undefined;
      await r.restart(async () => {
        await syncing;
        [replacement] = pendingSessions(r.root);
        expect(replacement).toBeDefined();
        await server.upload(r.folderId, "report.txt", "server edit");
      });
      await r.configure({ uploadLimitKBps: null });
      await r.sync();
      const after = (await r.remote()).get("report.txt");
      expect(after?.id).toBe(original?.id);
      expect(after?.contentChecksum).toBe(
        createHash("sha256").update(edit).digest("hex"),
      );
      // The server's edit went to the trash, not under the old session.
      const trash = (await (
        await server.post("/api/views/trash", { query: {} })
      ).json()) as { items: { name: string }[] };
      expect(trash.items.some((item) => item.name === "report.txt")).toBe(true);
      const old = await fetch(
        new URL(`/api/uploads/sessions/${replacement}`, origin),
        { headers: { cookie, origin: origin ?? "" } },
      );
      expect(old.status).toBe(404);
    });

    it("stops a pass before its next upload when an ignore rule is added", async () => {
      const r = await rig("two-way", undefined, { uploadLimitKBps: 1024 });
      for (let index = 0; index < 12; index += 1) {
        await writeOld(r.at(`f${index}.bin`), "x".repeat(512 * 1024));
      }
      const syncing = r.engine.syncNow();
      await transferStarted(r.engine);
      const done = finished(r.engine);
      await r.configure({ ignore: ["*.bin"] });
      await syncing;
      // Only what had finished, plus the uploads already running.
      const sent = (await r.remote()).size;
      expect(sent).toBeLessThanOrEqual(done + 4);
      expect(sent).toBeLessThan(12);
      await r.sync();
      expect((await r.remote()).size).toBe(sent);
    });

    it("cancels unfinished uploads when stopping for a sign-out", async () => {
      // Slow enough that the second chunk waits far longer than a stop may.
      const r = await rig("two-way", undefined, { uploadLimitKBps: 100 });
      await writeFile(r.at("big.bin"), randomBytes(40 * 1024 * 1024));
      const past = new Date(Date.now() - 60_000);
      await utimes(r.at("big.bin"), past, past);
      const syncing = r.engine.syncNow();
      await transferStarted(r.engine);
      const [session] = pendingSessions(r.root);
      expect(session).toBeDefined();
      await r.engine.stop({ cancelUploads: true });
      await syncing;
      const status = await fetch(
        new URL(`/api/uploads/sessions/${session}`, origin),
        { headers: { cookie, origin: origin ?? "" } },
      );
      expect(status.status).toBe(404);
      expect((await r.remote()).has("big.bin")).toBe(false);
    });

    it("stops transfers on quit, and a restart completes them", async () => {
      const r = await rig("two-way", undefined, { downloadLimitKBps: 2048 });
      for (const name of ["a", "b", "c", "d", "e", "f"]) {
        await server.upload(r.folderId, `${name}.bin`, "x".repeat(1024 * 1024));
      }
      const syncing = r.engine.syncNow();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await r.restart(async () => {
        await syncing;
        const names = await readdir(r.local);
        expect(names.some((name) => name.startsWith(".staaash-part-"))).toBe(
          false,
        );
      });
      await r.sync();
      expect((await readdir(r.local)).sort()).toEqual(
        ["a", "b", "c", "d", "e", "f"].map((name) => `${name}.bin`),
      );
    });

    it("stops before the next action when a folder stops syncing mid-pass", async () => {
      const r = await rig("two-way", undefined, { downloadLimitKBps: 2048 });
      for (const name of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
        await server.upload(r.folderId, `${name}.bin`, "x".repeat(1024 * 1024));
      }
      const syncing = r.engine.syncNow();
      await transferStarted(r.engine);
      const done = finished(r.engine);
      await r.configure({ pairs: [] });
      await syncing;
      // Only what had finished, plus the transfers already running.
      const names = await readdir(r.local);
      expect(names.length).toBeLessThanOrEqual(done + 4);
      expect(names.length).toBeLessThan(8);
      expect(r.engine.status().fileCount).toBe(0);
    });
  });
});
