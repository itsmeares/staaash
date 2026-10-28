import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
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
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import type { SyncMode } from "../shared/types";
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

const rig = async (mode: SyncMode = "two-way", existingFolderId?: string) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staaash-sync-"));
  const local = path.join(root, "local");
  const trash = path.join(root, "trash");
  await mkdir(local);
  await mkdir(trash);
  await mkdir(path.join(root, "data"));
  const folderId =
    existingFolderId ?? (await server.createFolder(`sync-${randomUUID()}`));
  const notes: string[] = [];
  const engine = new SyncEngine(
    {
      emit: (event) => {
        if (event.type === "notify") notes.push(event.title);
      },
      trash: async (file) => {
        await rename(
          file,
          path.join(trash, `${randomUUID()}-${path.basename(file)}`),
        );
      },
      watch: async () => () => {},
    },
    path.join(root, "data"),
  );
  await engine.configure({
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
  });
  const result = {
    root,
    local,
    trash,
    folderId,
    engine,
    notes,
    at: (rel: string) => path.join(local, ...rel.split("/")),
    /** Runs passes until one finds nothing to do. */
    sync: async () => {
      await engine.syncNow();
      await engine.syncNow();
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

describe.skipIf(!origin)("sync against a real server", () => {
  beforeAll(async () => {
    token = await signInDevice();
  });

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
    r.engine.resolvePair("pair", "download-again");
    await r.sync();
    expect((await readdir(r.local)).length).toBe(10);
  });
});
