import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, it } from "vite-plus/test";

import { openApiDocument } from "@/server/http/openapi";

const committed = path.resolve(__dirname, "../../openapi.json");

it("keeps openapi.json in step with the routes", () => {
  const generated = `${JSON.stringify(openApiDocument(), null, 2)}\n`;
  if (process.env.UPDATE_OPENAPI) writeFileSync(committed, generated);
  expect(
    readFileSync(committed, "utf8"),
    "Routes changed. Run `pnpm --filter web openapi` and review the diff.",
  ).toBe(generated);
});
