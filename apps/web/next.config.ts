import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const rootEnvLocal = path.resolve(__dirname, "../../.env.local");
if (existsSync(rootEnvLocal)) {
  for (const line of readFileSync(rootEnvLocal, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

export default function config(phase: string): NextConfig {
  return {
    output: "standalone",
    ...(phase !== PHASE_DEVELOPMENT_SERVER && {
      outputFileTracingRoot: path.join(__dirname, "../../"),
    }),
    transpilePackages: ["@staaash/db"],
  };
}
