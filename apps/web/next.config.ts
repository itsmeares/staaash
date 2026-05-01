import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function config(phase: string): NextConfig {
  return {
    output: "standalone",
    ...(phase !== PHASE_DEVELOPMENT_SERVER && {
      outputFileTracingRoot: path.join(__dirname, "../../"),
    }),
    transpilePackages: ["@staaash/db"],
  };
}
