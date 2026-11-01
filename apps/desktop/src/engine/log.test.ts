import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createSyncLog } from "./log";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "staaash-log-"));
  file = path.join(dir, "sync.log");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the sync log", () => {
  it("keeps the stage, code, message and cause", () => {
    const error = Object.assign(
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect refused"), {
          code: "ECONNREFUSED",
        }),
      }),
      { code: "ERR_TEST" },
    );
    createSyncLog(file)("reading server changes", error);
    const text = readFileSync(file, "utf8");
    for (const part of [
      "reading server changes",
      "code: ERR_TEST",
      "fetch failed",
      "caused by",
      "code: ECONNREFUSED",
      "connect refused",
    ]) {
      expect(text).toContain(part);
    }
  });

  it("does not write fields other than the ones it names", () => {
    const error = Object.assign(new Error("failed"), {
      headers: { authorization: "Bearer secret-token" },
    });
    createSyncLog(file)("stage", error);
    expect(readFileSync(file, "utf8")).not.toContain("secret-token");
  });

  it("hides the device token if an error message quotes it", () => {
    const error = new TypeError(
      'Headers.append: "Bearer secret-token" is an invalid header value.',
    );
    createSyncLog(file, () => "secret-token")("stage", error);
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain("secret-token");
    expect(text).toContain("[device token]");
  });

  it("writes a failure later if the disk refused it the first time", () => {
    const missing = path.join(dir, "later");
    const log = createSyncLog(path.join(missing, "sync.log"));
    log("stage", new Error("failed"));
    mkdirSync(missing);
    log("stage", new Error("failed"));
    expect(readFileSync(path.join(missing, "sync.log"), "utf8")).toContain(
      "failed",
    );
  });

  it("writes a repeated failure once, even between other failures", () => {
    const log = createSyncLog(file);
    const first = new Error("first");
    const second = new Error("second");
    for (let pass = 0; pass < 3; pass += 1) {
      log("a", first);
      log("b", second);
    }
    expect(readFileSync(file, "utf8").match(/Error: first/g)).toHaveLength(1);
    expect(readFileSync(file, "utf8").match(/Error: second/g)).toHaveLength(1);
  });

  it("moves a full log aside and keeps writing", () => {
    writeFileSync(file, "x".repeat(1024 * 1024));
    createSyncLog(file)("stage", new Error("after"));
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("after");
    expect(readFileSync(file, "utf8")).not.toContain("xxx");
  });

  it("never throws when the file can't be written", () => {
    const log = createSyncLog(path.join(dir, "missing", "sync.log"));
    expect(() => log("stage", new Error("failed"))).not.toThrow();
  });
});
