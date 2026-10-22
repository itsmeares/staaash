import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../../");
const require = createRequire(
  path.join(repositoryRoot, "apps/web/package.json"),
);
const { chromium, expect } = require("@playwright/test");

const runFile = process.argv[2];
if (!runFile) throw new Error("drive-folder.mjs needs a run.env path");

const parseEnv = (file) =>
  Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/u)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );

const env = parseEnv(runFile);
const stateDirectory = path.dirname(runFile);
const evidenceDirectory = env.STAAASH_VERIFY_EVIDENCE_DIR;
const publicUrl = env.STAAASH_VERIFY_URL;
const browserUrl = env.STAAASH_VERIFY_PROBE_URL || publicUrl;
const fakeEmail = `owner-${env.STAAASH_VERIFY_PROJECT}@staaash.test`;
const fakePassword = `staaash-verify-${env.STAAASH_VERIFY_PROJECT}`;
const folderName = `Verification folder ${Date.now()}`;
const composeArgs = [
  "compose",
  "--project-name",
  env.STAAASH_VERIFY_PROJECT,
  "--env-file",
  runFile,
  "--file",
  path.join(repositoryRoot, "docker-compose.yml"),
  "--file",
  path.join(scriptDirectory, "compose.override.yml"),
];

mkdirSync(evidenceDirectory, { recursive: true });
const logLines = [
  `url=${publicUrl}`,
  `fakeEmail=${fakeEmail}`,
  `folderName=${folderName}`,
];
let browser;
let context;
let tracing = false;

const screenshot = async (name) => {
  await context.pages()[0].screenshot({
    path: path.join(evidenceDirectory, name),
    fullPage: true,
  });
};

const checkDatabase = () => {
  const safeFolderName = folderName.replaceAll("'", "''");
  const query = `SELECT count(*) FROM "Folder" WHERE name = '${safeFolderName}' AND "isFilesRoot" = false AND "deletedAt" IS NULL;`;
  const result = spawnSync(
    "docker",
    [
      ...composeArgs,
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "postgres",
      "-d",
      "staaash",
      "-Atqc",
      query,
    ],
    { encoding: "utf8" },
  );
  writeFileSync(
    path.join(evidenceDirectory, "db-folder-check.txt"),
    `${result.stdout}${result.stderr}`,
  );
  if (result.status !== 0 || result.stdout.trim() !== "1") {
    throw new Error(
      "The folder was not found in the read-only database check.",
    );
  }
};

try {
  if (!existsSync(chromium.executablePath())) {
    throw new Error(
      "Chromium is not installed. From apps/web, run `pnpm exec playwright install chromium`, then run drive again.",
    );
  }
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ baseURL: browserUrl });
  await context.tracing.start({ screenshots: true, snapshots: true });
  tracing = true;
  const page = await context.newPage();

  await page.goto("/");
  await expect(
    page.getByText("Click anywhere or press any key", { exact: true }),
  ).toBeVisible();
  await screenshot("01-first-run.png");

  await page
    .getByText("Click anywhere or press any key", { exact: true })
    .click();
  await page.getByPlaceholder("your drive", { exact: true }).fill("Staaash QA");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(fakeEmail);
  await page.getByLabel("Password", { exact: true }).fill(fakePassword);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await page
    .getByRole("button", { name: "That's my time", exact: true })
    .click();
  await page.getByPlaceholder("your name", { exact: true }).fill("QA Owner");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page.waitForURL((next) => next.pathname === "/files", {
    timeout: 30_000,
  });
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }).getByText("Files"),
  ).toBeVisible();
  await screenshot("02-files-ready.png");

  await page.getByRole("button", { name: "New", exact: true }).click();
  await screenshot("03-new-menu.png");
  await page.getByRole("menuitem", { name: "New folder", exact: true }).click();
  const folderField = page.getByLabel("New folder name", { exact: true });
  await folderField.fill(folderName);
  await screenshot("04-folder-draft.png");
  await folderField.press("Enter");
  await expect(
    page.getByRole("grid", { name: "Files files" }).getByText(folderName, {
      exact: true,
    }),
  ).toBeVisible();
  await screenshot("05-folder-created.png");

  await page.reload();
  await expect(
    page.getByRole("grid", { name: "Files files" }).getByText(folderName, {
      exact: true,
    }),
  ).toBeVisible();
  await screenshot("06-folder-reloaded.png");

  const sessionCookie = (await context.cookies()).find(
    (cookie) => cookie.name === "staaash_session",
  );
  if (!sessionCookie)
    throw new Error("The setup flow did not create a session.");
  writeFileSync(
    path.join(stateDirectory, "auth-cookie.txt"),
    `staaash_session=${sessionCookie.value}`,
    { mode: 0o600 },
  );
  checkDatabase();
  logLines.push("result=folder-visible-after-reload");
  logLines.push("result=folder-found-in-database");
  writeFileSync(
    path.join(evidenceDirectory, "drive.log"),
    `${logLines.join("\n")}\n`,
  );
} catch (error) {
  logLines.push("result=failed");
  logLines.push(
    `error=${error instanceof Error ? error.message : String(error)}`,
  );
  writeFileSync(
    path.join(evidenceDirectory, "drive.log"),
    `${logLines.join("\n")}\n`,
  );
  if (context?.pages().length) {
    try {
      await screenshot("error.png");
    } catch {}
  }
  throw error;
} finally {
  if (tracing) {
    try {
      await context.tracing.stop({
        path: path.join(evidenceDirectory, "trace.zip"),
      });
    } catch {}
  }
  await context?.close();
  await browser?.close();
}
