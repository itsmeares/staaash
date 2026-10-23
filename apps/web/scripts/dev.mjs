// The app on :3000 (Vite) and the API on STAAASH_API_PORT (3001), stopped together.
import { spawn } from "node:child_process";

const apiPort = process.env.STAAASH_API_PORT ?? "3001";
const run = (command, args, env = {}) =>
  spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });

const children = [
  run(
    "tsx",
    [
      "watch",
      "--clear-screen=false",
      "--env-file-if-exists=../../.env.local",
      "server/main.ts",
    ],
    { PORT: apiPort },
  ),
  run("vp", ["dev"]),
];

const stop = (code = 0) => {
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
};
for (const child of children) {
  child.on("exit", (code) => stop(code ?? 0));
  child.on("error", (error) => {
    console.error(error);
    stop(1);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
