import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to install E2E database extensions.");
}

const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query("CREATE EXTENSION IF NOT EXISTS unaccent");
} finally {
  await client.end();
}
