import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, it } from "vite-plus/test";

import { app } from "@/server/http/app";

const committed = path.resolve(__dirname, "../../openapi.json");

/** The public API contract. Admin routes stay out: only the bundled UI calls them. */
it("keeps openapi.json in step with the routes", () => {
  const document = app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Staaash",
      version: "2",
      description:
        "Within a major version, routes and fields are only added, never renamed or removed.",
    },
  });
  const generated = `${JSON.stringify(document, null, 2)}\n`;
  if (process.env.UPDATE_OPENAPI) writeFileSync(committed, generated);
  expect(
    readFileSync(committed, "utf8"),
    "Routes changed. Run `pnpm --filter web openapi` and review the diff.",
  ).toBe(generated);
});
