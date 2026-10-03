// Keeps global CSS small: app/globals.css only imports, shared styles stay
// under a line budget, and nothing uses !important.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const STYLES_LINE_BUDGET = 400;
const problems = [];

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
  if (
    /\.(css|tsx?)$/.test(file) &&
    readFileSync(file, "utf8").includes("!important")
  ) {
    problems.push(`${rel}: uses !important`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
