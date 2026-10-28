// The app on :3000 (Vite) and the API on STAAASH_API_PORT (3001), stopped together.
import { spawn } from "node:child_process";

const apiPort = process.env.STAAASH_API_PORT ?? "3001";
const run = (command, args, env = {}) =>
  spawn(command, args, {
    detached: process.platform !== "win32",
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
  for (const child of children) {
    if (!child.pid) continue;
    if (process.platform === "win32") {
      spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      continue;
    }
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
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
