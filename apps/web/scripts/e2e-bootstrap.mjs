import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { fileURLToPath } from "node:url";

import pg from "../../../packages/db/node_modules/pg/lib/index.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webAppRoot = path.resolve(scriptDirectory, "..");
const workspaceRoot = path.resolve(webAppRoot, "..", "..");
const envFilePath = path.join(webAppRoot, ".env.local");
const stateFilePath = path.join(webAppRoot, ".data", "e2e", "state.json");
const workspaceMarker = "pnpm-workspace.yaml";

const OWNER_EMAIL = "owner-e2e@staaash.test";
const OWNER_ID = "e2e-owner";
const OWNER_USERNAME = "owner";
const OWNER_PASSWORD = "staaash-owner-pass";
const MEMBER_EMAIL = "member-e2e@staaash.test";
const MEMBER_ID = "e2e-member";
const MEMBER_USERNAME = "member";
const MEMBER_PASSWORD = "staaash-member-pass";
const OWNER_ROOT_ID = "e2e-owner-root";
const MEMBER_ROOT_ID = "e2e-member-root";
const SHARE_FILE_ID = "e2e-share-file";
const SHARE_LINK_ID = "e2e-share-link";
const SHARE_FILE_NAME = "shared-preview.png";
const SHARE_IMAGE_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnSUswAAAAASUVORK5CYII=",
  "base64",
);

const parseDotEnv = async (filePath) => {
  if (!existsSync(filePath)) {
    return {};
  }

  const fileContents = await readFile(filePath, "utf8");
  const entries = {};

  for (const rawLine of fileContents.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    entries[key] = value.replace(/^(['"])(.*)\1$/u, "$2");
  }

  return entries;
};

const findWorkspaceRoot = (startDir) => {
  let current = path.resolve(startDir);

  while (true) {
    if (existsSync(path.join(current, workspaceMarker))) {
      return current;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      throw new Error(
        `Unable to find workspace root from ${startDir}. Missing ${workspaceMarker}.`,
      );
    }

    current = parent;
  }
};

const resolveWorkspacePath = (candidatePath, startDir) =>
  path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(findWorkspaceRoot(startDir), candidatePath);

const { Client } = pg;

const runPnpm = (args, env) => {
  execFileSync(
    process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm",
    process.platform === "win32"
      ? ["/d", "/s", "/c", `pnpm ${args.join(" ")}`]
      : args,
    {
      cwd: workspaceRoot,
      stdio: "inherit",
      env,
    },
  );
};

const hashPassword = (password) => {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = scryptSync(password, salt, 64);
  return `s1:${salt}:${derivedKey.toString("base64url")}`;
};

const hashOpaqueToken = (secret, token) =>
  createHash("sha256")
    .update(secret)
    .update(":")
    .update(token)
    .digest("base64url");

const buildShareToken = (secret, tokenLookupKey) => {
  const signature = createHash("sha256")
    .update(secret)
    .update(":share-token:")
    .update(tokenLookupKey)
    .digest("base64url");

  return `${tokenLookupKey}.${signature}`;
};

const ensureAppEnv = async () => {
  const appEnv = await parseDotEnv(envFilePath);
  const mergedEnv = {
    ...appEnv,
    ...process.env,
  };

  for (const [key, value] of Object.entries(mergedEnv)) {
    if (typeof value === "string") {
      process.env[key] = value;
    }
  }

  return mergedEnv;
};

const resetStorageAndSchema = async (env) => {
  const filesRoot = resolveWorkspacePath(
    env.FILES_ROOT ?? "./.data/files",
    webAppRoot,
  );

  await rm(filesRoot, { recursive: true, force: true });
  await rm(stateFilePath, { force: true });

  try {
    runPnpm(
      [
        "--filter",
        "@staaash/db",
        "exec",
        "prisma",
        "db",
        "push",
        "--force-reset",
      ],
      env,
    );
  } catch (error) {
    throw new Error(
      `E2E bootstrap could not reset schema. Ensure PostgreSQL is running and DATABASE_URL is reachable. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return filesRoot;
};

const seedE2EData = async ({ filesRoot, authSecret, databaseUrl }) => {
  const client = new Client({
    connectionString: databaseUrl,
  });

  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `E2E bootstrap could not connect to PostgreSQL. Start database and retry. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const ownerPasswordHash = hashPassword(OWNER_PASSWORD);
    const memberPasswordHash = hashPassword(MEMBER_PASSWORD);

    await client.query(
      `INSERT INTO "Instance" ("id", "name", "setupCompletedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, NOW(), NOW(), NOW())`,
      ["singleton", "Staaash E2E"],
    );

    await client.query(
      `INSERT INTO "User" ("id", "email", "username", "displayName", "passwordHash", "role", "createdAt", "updatedAt")
       VALUES
       ($1, $2, $3, $4, $5, $6::"UserRole", NOW(), NOW()),
       ($7, $8, $9, $10, $11, $12::"UserRole", NOW(), NOW())`,
      [
        OWNER_ID,
        OWNER_EMAIL,
        OWNER_USERNAME,
        "E2E Owner",
        ownerPasswordHash,
        "owner",
        MEMBER_ID,
        MEMBER_EMAIL,
        MEMBER_USERNAME,
        "E2E Member",
        memberPasswordHash,
        "member",
      ],
    );

    await client.query(
      `INSERT INTO "Folder" ("id", "ownerUserId", "parentId", "name", "isLibraryRoot", "deletedAt", "createdAt", "updatedAt")
       VALUES
       ($1, $2, NULL, $3, TRUE, NULL, NOW(), NOW()),
       ($4, $5, NULL, $6, TRUE, NULL, NOW(), NOW())`,
      [
        OWNER_ROOT_ID,
        OWNER_ID,
        "Library",
        MEMBER_ROOT_ID,
        MEMBER_ID,
        "Library",
      ],
    );

    const storageKey = `library/${OWNER_ID}/${SHARE_FILE_NAME}`;
    const absoluteShareFilePath = path.join(
      filesRoot,
      ...storageKey.split("/"),
    );
    await mkdir(path.dirname(absoluteShareFilePath), { recursive: true });
    await writeFile(absoluteShareFilePath, SHARE_IMAGE_BYTES);

    await client.query(
      `INSERT INTO "File" ("id", "ownerUserId", "folderId", "originalName", "storageKey", "mimeType", "sizeBytes", "contentChecksum", "deletedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, NOW(), NOW())`,
      [
        SHARE_FILE_ID,
        OWNER_ID,
        OWNER_ROOT_ID,
        SHARE_FILE_NAME,
        storageKey,
        "image/png",
        SHARE_IMAGE_BYTES.length,
      ],
    );

    const tokenLookupKey = randomBytes(24).toString("base64url");
    const shareToken = buildShareToken(authSecret, tokenLookupKey);

    await client.query(
      `INSERT INTO "ShareLink" ("id", "createdByUserId", "targetType", "fileId", "folderId", "tokenLookupKey", "tokenHash", "passwordHash", "downloadDisabled", "expiresAt", "revokedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3::"ShareTargetType", $4, NULL, $5, $6, NULL, TRUE, $7, NULL, NOW(), NOW())`,
      [
        SHARE_LINK_ID,
        OWNER_ID,
        "file",
        SHARE_FILE_ID,
        tokenLookupKey,
        hashOpaqueToken(authSecret, shareToken),
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ],
    );

    await mkdir(path.dirname(stateFilePath), { recursive: true });
    await writeFile(
      stateFilePath,
      JSON.stringify(
        {
          ownerIdentifier: OWNER_USERNAME,
          ownerPassword: OWNER_PASSWORD,
          memberIdentifier: MEMBER_USERNAME,
          memberPassword: MEMBER_PASSWORD,
          shareUrl: `/s/${encodeURIComponent(shareToken)}`,
        },
        null,
        2,
      ),
      "utf8",
    );
  } finally {
    await client.end();
  }
};

const main = async () => {
  const env = await ensureAppEnv();
  const authSecret = env.AUTH_SECRET;

  if (!authSecret) {
    throw new Error("AUTH_SECRET is required for E2E bootstrap.");
  }

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for E2E bootstrap.");
  }

  const filesRoot = await resetStorageAndSchema(env);
  await seedE2EData({
    filesRoot,
    authSecret,
    databaseUrl: env.DATABASE_URL,
  });

  console.log(`E2E bootstrap complete. State written to ${stateFilePath}`);
};

await main();
