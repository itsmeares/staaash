// vite-plus bundles its own vite core and vitest. The repo pins the same
// versions in a few places, and Vitest refuses to start with mixed versions
// when coverage runs, which pull request runs skip. Fail early instead.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const versionMismatches = ({ bundled, catalog, override, coverage }) =>
  [
    ["vitest in the pnpm catalog", catalog, bundled.vitest],
    ["@vitest/coverage-v8 in package.json", coverage, bundled.vitest],
    ["the vite override in pnpm-workspace.yaml", override, bundled.vite],
  ]
    .filter(([, actual, wanted]) => actual !== wanted)
    .map(
      ([what, actual, wanted]) =>
        `${what} is ${actual}, but vite-plus bundles ${wanted}`,
    );

const read = (path) => readFileSync(path, "utf8");

const main = () => {
  const workspace = read("pnpm-workspace.yaml");
  const catalog = workspace.match(/^catalog:\n(?:  .*\n)*?  vitest: (\S+)$/m);
  const override = workspace.match(/^ {2}vite@\*: (\S+)$/m);
  const { dependencies } = JSON.parse(
    read("node_modules/vite-plus/package.json"),
  );
  const { devDependencies } = JSON.parse(read("package.json"));
  const problems = versionMismatches({
    bundled: { vitest: dependencies.vitest, vite: dependencies.vite },
    catalog: catalog?.[1],
    override: override?.[1],
    coverage: devDependencies["@vitest/coverage-v8"],
  });
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
