import packageMetadata from "../package.json" with { type: "json" };

const builtRuntimePath = ["..", "dist", "runtime-version.js"].join("/");
const builtRuntimeUrl = new URL(builtRuntimePath, import.meta.url);
const { resolveWorkerVersion } = await import(builtRuntimeUrl.href);
const resolvedVersion = resolveWorkerVersion(null);

if (resolvedVersion !== packageMetadata.version) {
  throw new Error(
    `Built worker resolved ${resolvedVersion}; expected ${packageMetadata.version}.`,
  );
}

console.info(`[worker] Runtime version smoke passed (${resolvedVersion}).`);
