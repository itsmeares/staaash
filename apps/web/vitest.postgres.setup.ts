import { inject } from "vitest";

process.env.DATABASE_URL = inject("postgresDatabaseUrl");
process.env.POSTGRES_TEST_DATABASE_URL = inject("postgresDatabaseUrl");
process.env.POSTGRES_TEST_DATABASE_NAME = inject("postgresDatabaseName");
process.env.UPLOAD_LOCATION = inject("postgresStorageRoot");
process.env.AUTH_SECRET ??= "postgres-test-placeholder-secret";
