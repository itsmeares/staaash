import { readFile } from "node:fs/promises";

import packageMetadata from "../package.json" with { type: "json" };

const builtPackagePath = [
  "..",
  ".next",
  "standalone",
  "apps",
  "web",
  "package.json",
].join("/");
const builtPackageUrl = new URL(builtPackagePath, import.meta.url);
const builtPackage = JSON.parse(await readFile(builtPackageUrl, "utf8"));

if (builtPackage.version !== packageMetadata.version) {
  throw new Error(
    `Built web package has ${builtPackage.version}; expected ${packageMetadata.version}.`,
  );
}

console.info(`[web] Runtime version smoke passed (${builtPackage.version}).`);
