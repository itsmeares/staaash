import packageMetadata from "../package.json" with { type: "json" };

const { resolveWorkerVersion } = await import("../dist/runtime-version.js");
const resolvedVersion = resolveWorkerVersion(null);

if (resolvedVersion !== packageMetadata.version) {
  throw new Error(
    `Built worker resolved ${resolvedVersion}; expected ${packageMetadata.version}.`,
  );
}

console.info(`[worker] Runtime version smoke passed (${resolvedVersion}).`);
