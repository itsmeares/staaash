import { spawnSync } from "node:child_process";

// Turbo's ^build dependency owns shared outputs; direct package commands still need them.
if (!process.env.TURBO_HASH) {
  const result = spawnSync("pnpm", ["run", "build:deps"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
