import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createStack, destroyStack } from "./stack.mjs";

await test("cleanup removes the owned stack and files after earlier commands fail", async () => {
  const commands = await mkdtemp(path.join(os.tmpdir(), "staaash-cleanup-"));
  const previousPath = process.env.PATH;
  const state = await createStack("test-only-image");
  const log = path.join(commands, "commands.jsonl");
  await writeFile(
    path.join(commands, "docker"),
    `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';
const args=process.argv.slice(2);
appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
if(args.includes('stop') || args.includes('chown')) process.exit(9);
`,
    { mode: 0o700 },
  );
  process.env.PATH = commands + path.delimiter + previousPath;
  try {
    await assert.rejects(destroyStack(state), (error) => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      return true;
    });
    await assert.rejects(stat(state.root), { code: "ENOENT" });
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert(
      calls.some((args) => args.includes("down") && args.includes("--volumes")),
    );
    assert(calls.every((args) => args.includes(state.project)));
  } finally {
    process.env.PATH = previousPath;
    await rm(state.root, { recursive: true, force: true });
    await rm(commands, { recursive: true, force: true });
  }
});
