// Keeps global CSS small: app/globals.css only imports, shared styles stay
// under a line budget, and nothing uses !important. Also keeps text readable:
// faded text depends on the surface behind it, so text uses foreground (80%
// or more) or muted-foreground, which server/text-contrast.test.ts checks
// against every surface in both themes.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const STYLES_LINE_BUDGET = 400;
const problems = [];
const TEXT_OPACITY_FLOOR = 80;
// Utility classes like `hover:text-foreground/60`. `before:`/`after:` content
// (breadcrumb separators) is decorative and exempt.
const fadedTextClass =
  /(?<![\w/-])((?:[\w-]+:)*)text-(muted-)?foreground\/(\d+)/g;
// `color-mix(in oklab, var(--foreground) 60%, …)` or Tailwind's
// `--alpha(var(--foreground) / 60%)`.
const fadedTextCss =
  /(?<![\w-])color:\s*(?:color-mix\(in oklab, |--alpha\()var\(--(muted-)?foreground\)(?: \/)? (\d+)%/g;
const isFaded = (muted, amount) =>
  Boolean(muted) || Number(amount) < TEXT_OPACITY_FLOOR;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const globals = readFileSync(path.join(root, "app/globals.css"), "utf8");
for (const line of globals.split("\n")) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith("@import ")) {
    problems.push(
      `app/globals.css may only contain @import lines: "${trimmed}"`,
    );
  }
}

const stylesDir = path.join(root, "styles");
const styleLines = readdirSync(stylesDir)
  .filter((name) => name.endsWith(".css"))
  .reduce(
    (sum, name) =>
      sum + readFileSync(path.join(stylesDir, name), "utf8").split("\n").length,
    0,
  );
if (styleLines > STYLES_LINE_BUDGET) {
  problems.push(
    `styles/*.css has ${styleLines} lines, over the ${STYLES_LINE_BUDGET} line budget`,
  );
}

for (const file of [
  ...walk(path.join(root, "app")),
  ...walk(path.join(root, "components")),
  ...walk(stylesDir),
]) {
  const rel = path.relative(root, file);
  if (
    file.endsWith(".css") &&
    !rel.startsWith("styles/") &&
    rel !== "app/globals.css" &&
    !file.endsWith(".module.css")
  ) {
    problems.push(
      `${rel}: global CSS belongs in styles/; use a .module.css next to the component instead`,
    );
  }
  if (!/\.(css|tsx?)$/.test(file)) continue;
  const source = readFileSync(file, "utf8");
  if (source.includes("!important")) {
    problems.push(`${rel}: uses !important`);
  }
  for (const [match, variants, muted, amount] of source.matchAll(
    fadedTextClass,
  )) {
    if (/(^|:)(before|after):$/.test(variants)) continue;
    if (isFaded(muted, amount)) {
      problems.push(
        `${rel}: ${match} fades text below the contrast floor; use text-muted-foreground, or text-foreground/${TEXT_OPACITY_FLOOR} and up`,
      );
    }
  }
  for (const [match, muted, amount] of source.matchAll(fadedTextCss)) {
    if (isFaded(muted, amount)) {
      problems.push(
        `${rel}: ${match} fades text below the contrast floor; use var(--muted-foreground), or --foreground at ${TEXT_OPACITY_FLOOR}% and up`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
