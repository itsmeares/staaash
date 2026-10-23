// Within a major version the public API only grows. Compares apps/web/openapi.json
// with the newest release tag whose spec has the same info.version.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SPEC = "apps/web/openapi.json";
const METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "patch",
  "head",
  "options",
]);

// Parameters are a list; match them by where they go and their name, not order.
const byName = (parameters) =>
  Array.isArray(parameters)
    ? Object.fromEntries(parameters.map((p) => [`${p.in}:${p.name}`, p]))
    : parameters;

const isObject = (value) => Boolean(value) && typeof value === "object";

const removedEnumValues = (before, after, at) =>
  (before.enum ?? [])
    .filter((value) => !(after.enum ?? []).includes(value))
    .map((value) => `${at} no longer allows ${JSON.stringify(value)}`);

// A client that sent nothing before must not start failing.
const newRequirements = (before, after, at) => {
  if (after.required === true && before.required !== true) {
    return [`${at} is now required`];
  }
  if (!Array.isArray(after.required)) return [];
  return after.required
    .filter((name) => !(before.required ?? []).includes(name))
    .map((name) => `${at} now requires ${name}`);
};

const CHECKED_HERE = new Set(["enum", "required"]);
const opensRequest = (key) => key === "parameters" || key === "requestBody";
const pair = (key, before, after) =>
  key === "parameters" ? [byName(before), byName(after)] : [before, after];

const walk = (before, after, at, inRequest) => {
  if (!isObject(before)) return [];
  if (!isObject(after)) return [`${at} was removed`];
  return [
    ...removedEnumValues(before, after, at),
    ...(inRequest ? newRequirements(before, after, at) : []),
    ...Object.entries(before)
      .filter(([key]) => !CHECKED_HERE.has(key))
      .flatMap(([key, value]) =>
        walk(
          ...pair(key, value, after[key]),
          `${at}/${key}`,
          inRequest || opensRequest(key),
        ),
      ),
  ];
};

/** Every way `next` breaks a client written against `previous`. */
export const breakingChanges = (previous, next) => [
  ...Object.entries(previous.paths ?? {}).flatMap(([path, operations]) =>
    Object.entries(operations)
      .filter(([method]) => METHODS.has(method))
      .map(([method, operation]) =>
        walk(
          operation,
          next.paths?.[path]?.[method],
          `${method.toUpperCase()} ${path}`,
          false,
        ),
      )
      .flat(),
  ),
  ...walk(previous.components, next.components, "components", false),
];

const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

const releasedSpec = (major) => {
  for (const tag of git("tag", "--list", "v*", "--sort=-v:refname").split(
    "\n",
  )) {
    if (!tag) continue;
    try {
      const spec = JSON.parse(git("show", `${tag}:${SPEC}`));
      if (spec.info?.version === major) return { tag, spec };
    } catch {
      // Releases before the contract have no spec.
    }
  }
  return null;
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const current = JSON.parse(readFileSync(SPEC, "utf8"));
  const released = releasedSpec(current.info.version);
  if (!released) {
    console.log(
      `No release of API ${current.info.version} yet; nothing to compare.`,
    );
  } else {
    const problems = breakingChanges(released.spec, current);
    for (const problem of problems) console.error(`✗ ${problem}`);
    if (problems.length > 0) {
      console.error(
        `The API changed incompatibly since ${released.tag}. Add instead of changing, or start a new major version.`,
      );
      process.exit(1);
    }
    console.log(`API ${current.info.version} only grew since ${released.tag}.`);
  }
}
