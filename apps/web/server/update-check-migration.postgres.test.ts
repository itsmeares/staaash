import { readFile } from "node:fs/promises";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

const migrationPath = new URL(
  "../../../packages/db/prisma/migrations/20260831000000_add_instance_checked_version/migration.sql",
  import.meta.url,
);

describe("checkedVersion migration", () => {
  const client = new Client({
    connectionString: inject("postgresDatabaseUrl"),
  });

  beforeAll(() => client.connect());
  afterAll(() => client.end());

  it("clears update state that predates checkedVersion", async () => {
    await client.query(`
      CREATE TEMP TABLE "Instance" (
        "lastUpdateCheckAt" TIMESTAMP,
        "updateCheckStatus" TEXT,
        "updateCheckMessage" TEXT,
        "latestAvailableVersion" TEXT
      )
    `);
    await client.query(`
      INSERT INTO "Instance" VALUES (
        NOW(),
        'update-available',
        'Update available: 2.0.0.',
        '2.0.0'
      )
    `);

    await client.query(await readFile(migrationPath, "utf8"));

    const { rows } = await client.query(`SELECT * FROM "Instance"`);
    expect(rows).toEqual([
      {
        lastUpdateCheckAt: null,
        updateCheckStatus: null,
        updateCheckMessage: null,
        latestAvailableVersion: null,
        checkedVersion: null,
      },
    ]);
  });
});
