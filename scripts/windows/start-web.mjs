// The Windows web service: apply database migrations, then serve. The same
// order as the container's start command.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const appDir = import.meta.dirname;
const migrateDir = path.join(appDir, "migrate");

const migrate = spawnSync(
  process.execPath,
  [
    path.join(migrateDir, "node_modules", "prisma", "build", "index.js"),
    "migrate",
    "deploy",
  ],
  { cwd: migrateDir, stdio: "inherit", windowsHide: true },
);
if (migrate.status !== 0) {
  console.error("[startup] Database migrations failed. Staaash did not start.");
  process.exit(1);
}

await import(
  pathToFileURL(path.join(appDir, "web", "dist", "server", "main.mjs")).href
);
