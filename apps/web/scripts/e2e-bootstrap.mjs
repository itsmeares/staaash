import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomBytes, scryptSync } from "node:crypto";

import pg from "pg";

const stateFilePath = process.env.STAAASH_E2E_STATE_FILE;

const OWNER_EMAIL = "owner-e2e@staaash.test";
const OWNER_ID = "e2e-owner";
const OWNER_STORAGE_ID = "e2e-owner";
const OWNER_PASSWORD = "staaash-owner-pass";
const MEMBER_EMAIL = "member-e2e@staaash.test";
const MEMBER_ID = "e2e-member";
const MEMBER_STORAGE_ID = "e2e-member";
const MEMBER_PASSWORD = "staaash-member-pass";
const ONBOARDING_EMAIL = "onboarding-e2e@staaash.test";
const ONBOARDING_ID = "e2e-onboarding";
const ONBOARDING_STORAGE_ID = "e2e-onboarding";
const ONBOARDING_PASSWORD = "staaash-onboarding-pass";
const OWNER_ROOT_ID = "e2e-owner-root";
const MEMBER_ROOT_ID = "e2e-member-root";
const ONBOARDING_ROOT_ID = "e2e-onboarding-root";
const SHARE_FILE_ID = "e2e-share-file";
const SHARE_LINK_ID = "e2e-share-link";
const SHARE_FILE_NAME = "shared-preview.png";
const SHARE_IMAGE_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwaDjwHwAFBAKAPJ4DgAAAAABJRU5ErkJggg==",
  "base64",
);

const { Client } = pg;

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

const requireIsolatedStorage = async (env) => {
  const filesRoot = env.FILES_ROOT;
  assert(filesRoot, "Run E2E preparation through scripts/ci/stack.mjs.");
  assert(path.isAbsolute(filesRoot));
  assert(stateFilePath);
  assert.equal(path.dirname(stateFilePath), path.dirname(filesRoot));
  assert.match(
    new URL(env.DATABASE_URL).pathname.slice(1),
    /^staaash_test_[a-f0-9]{32}$/,
  );
  assert.match(env.STAAASH_E2E_PROJECT ?? "", /^staaash-test-[a-f0-9]{12}$/);
  assert.equal(
    await readFile(
      path.join(path.dirname(filesRoot), ".staaash-test-root"),
      "utf8",
    ),
    env.STAAASH_E2E_PROJECT,
  );
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
    const onboardingPasswordHash = hashPassword(ONBOARDING_PASSWORD);

    await client.query(
      `INSERT INTO "Instance" ("id", "name", "setupCompletedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, NOW(), NOW(), NOW())`,
      ["singleton", "Staaash E2E"],
    );

    await client.query(
      `INSERT INTO "User" ("id", "email", "storageId", "displayName", "passwordHash", "isOwner", "isAdmin", "createdAt", "updatedAt")
       VALUES
       ($1, $2, $3, $4, $5, TRUE, TRUE, NOW(), NOW()),
       ($6, $7, $8, $9, $10, FALSE, FALSE, NOW(), NOW()),
       ($11, $12, $13, $14, $15, TRUE, TRUE, NOW(), NOW())`,
      [
        OWNER_ID,
        OWNER_EMAIL,
        OWNER_STORAGE_ID,
        "E2E Owner",
        ownerPasswordHash,
        MEMBER_ID,
        MEMBER_EMAIL,
        MEMBER_STORAGE_ID,
        "E2E Member",
        memberPasswordHash,
        ONBOARDING_ID,
        ONBOARDING_EMAIL,
        ONBOARDING_STORAGE_ID,
        "E2E Onboarding",
        onboardingPasswordHash,
      ],
    );

    await client.query(
      `INSERT INTO "UserPreference" ("id", "userId", "timeZone", "onboardingCompletedAt", "createdAt", "updatedAt")
       VALUES
       ($1, $2, 'UTC', NOW(), NOW(), NOW()),
       ($3, $4, 'UTC', NOW(), NOW(), NOW()),
       ($5, $6, 'UTC', NULL, NOW(), NOW())`,
      [
        "e2e-owner-preferences",
        OWNER_ID,
        "e2e-member-preferences",
        MEMBER_ID,
        "e2e-onboarding-preferences",
        ONBOARDING_ID,
      ],
    );

    await client.query(
      `INSERT INTO "Folder" ("id", "ownerUserId", "parentId", "name", "isFilesRoot", "deletedAt", "createdAt", "updatedAt")
       VALUES
       ($1, $2, NULL, $3, TRUE, NULL, NOW(), NOW()),
       ($4, $5, NULL, $6, TRUE, NULL, NOW(), NOW()),
       ($7, $8, NULL, $9, TRUE, NULL, NOW(), NOW())`,
      [
        OWNER_ROOT_ID,
        OWNER_ID,
        "Files",
        MEMBER_ROOT_ID,
        MEMBER_ID,
        "Files",
        ONBOARDING_ROOT_ID,
        ONBOARDING_ID,
        "Files",
      ],
    );

    const storageKey = `files/${OWNER_STORAGE_ID}/${SHARE_FILE_NAME}`;
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
          ownerIdentifier: OWNER_EMAIL,
          ownerPassword: OWNER_PASSWORD,
          memberIdentifier: MEMBER_EMAIL,
          memberPassword: MEMBER_PASSWORD,
          onboardingIdentifier: ONBOARDING_EMAIL,
          onboardingPassword: ONBOARDING_PASSWORD,
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
  const env = process.env;
  const authSecret = env.AUTH_SECRET;

  if (!authSecret) {
    throw new Error("AUTH_SECRET is required for E2E bootstrap.");
  }

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for E2E bootstrap.");
  }

  const filesRoot = await requireIsolatedStorage(env);
  await seedE2EData({
    filesRoot,
    authSecret,
    databaseUrl: env.DATABASE_URL,
  });

  console.log(`E2E bootstrap complete. State written to ${stateFilePath}`);
};

await main();
