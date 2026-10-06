import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { randomClientId } from "@/lib/client-id";

const webRoot = path.resolve(__dirname, "..");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });

describe("randomClientId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a v4 UUID without crypto.randomUUID (insecure contexts)", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: globalThis.crypto.getRandomValues.bind(
        globalThis.crypto,
      ),
    });

    expect(randomClientId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("browser code", () => {
  // crypto.randomUUID is undefined on plain-HTTP origins other than localhost,
  // so anything that runs in the browser has to use randomClientId instead.
  it("never calls crypto.randomUUID", () => {
    const offenders = ["app", "components", "lib"]
      .flatMap((dir) => sourceFiles(path.join(webRoot, dir)))
      .filter((file) => !file.includes(`${path.sep}api${path.sep}`))
      .filter((file) => !file.endsWith(`${path.sep}client-id.ts`))
      .filter((file) =>
        /\bcrypto\.randomUUID\(/.test(readFileSync(file, "utf8")),
      )
      .map((file) => path.relative(webRoot, file));

    expect(offenders).toEqual([]);
  });
});
