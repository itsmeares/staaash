import { readFile } from "node:fs/promises";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

const migrationPath = new URL(
  "../../../packages/db/prisma/migrations/20261010000000_update_channel_and_releases/migration.sql",
  import.meta.url,
);

const columnsOf = async (client: Client, table: string) =>
  (
    await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = $1 AND table_schema LIKE 'pg_temp%'
       ORDER BY column_name`,
      [table],
    )
  ).rows.map((row) => row.column_name);

describe("update channel migration", () => {
  const client = new Client({
    connectionString: inject("postgresDatabaseUrl"),
  });

  beforeAll(() => client.connect());
  afterAll(() => client.end());

  it("moves update state to stored releases and keeps the other settings", async () => {
    await client.query(`
      CREATE TEMP TABLE "Instance" (
        "lastUpdateCheckAt" TIMESTAMP,
        "updateCheckStatus" TEXT,
        "updateCheckMessage" TEXT,
        "latestAvailableVersion" TEXT,
        "checkedVersion" TEXT
      );
      CREATE TEMP TABLE "SystemSettings" (
        "updateCheckIntervalHours" INTEGER NOT NULL DEFAULT 24,
        "updateCheckRepository" TEXT NOT NULL
      );
      CREATE TEMP TABLE "UserPreference" (
        "theme" TEXT NOT NULL,
        "showUpdateNotifications" BOOLEAN NOT NULL,
        "enableVersionChecks" BOOLEAN NOT NULL
      );
      INSERT INTO "Instance" VALUES (NOW(), 'update-available', 'x', '1.3.0', '1.2.0');
      INSERT INTO "SystemSettings" VALUES (6, 'fork/staaash');
      INSERT INTO "UserPreference" VALUES ('dark', false, true);
    `);

    await client.query(await readFile(migrationPath, "utf8"));

    expect(await columnsOf(client, "Instance")).toEqual([
      "lastUpdateCheckAt",
      "updateCheckError",
      "updateReleases",
    ]);
    expect((await client.query(`SELECT * FROM "Instance"`)).rows).toEqual([
      { lastUpdateCheckAt: null, updateCheckError: null, updateReleases: null },
    ]);
    // Existing installs keep their repository, get checks on and follow
    // their running version until an owner picks a channel.
    expect((await client.query(`SELECT * FROM "SystemSettings"`)).rows).toEqual(
      [
        {
          updateCheckRepository: "fork/staaash",
          updateCheckEnabled: true,
          updateChannel: null,
        },
      ],
    );
    expect((await client.query(`SELECT * FROM "UserPreference"`)).rows).toEqual(
      [{ theme: "dark", showUpdateNotifications: false }],
    );
  });
});
