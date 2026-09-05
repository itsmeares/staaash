import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { Prisma, PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  __staaashDatabase?: {
    pool: Pool;
    uploadPool: Pool;
    prisma: PrismaClient;
  };
};

let productionDatabase:
  | {
      pool: Pool;
      uploadPool: Pool;
      prisma: PrismaClient;
    }
  | undefined;

/**
 * Creates the PostgreSQL pools and Prisma client used by the application.
 *
 * @returns The primary pool, upload-specific pool, and configured Prisma client
 * @throws If `DATABASE_URL` is not configured
 */
function createDatabase() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required before calling getPrisma().");
  }

  const pool = new Pool({ connectionString });
  const uploadPool = new Pool({ connectionString, max: 3 });
  const adapter = new PrismaPg(pool, { disposeExternalPool: true });
  return { pool, uploadPool, prisma: new PrismaClient({ adapter }) };
}

/**
 * Retrieves the shared database state, creating it when necessary.
 *
 * @returns The cached database pools and Prisma client.
 */
function getDatabase() {
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__staaashDatabase ??= createDatabase();
    return globalForPrisma.__staaashDatabase;
  }

  productionDatabase ??= createDatabase();
  return productionDatabase;
}

/**
 * Retrieves the shared Prisma client.
 *
 * @returns The Prisma client used by the application
 */
export function getPrisma(): PrismaClient {
  return getDatabase().prisma;
}

/**
 * Provides the shared primary PostgreSQL connection pool.
 *
 * @returns The shared PostgreSQL connection pool
 */
export function getPostgresPool(): Pool {
  return getDatabase().pool;
}

/**
 * Retrieves the PostgreSQL connection pool used for uploads.
 *
 * @returns The upload-specific PostgreSQL connection pool
 */
export function getUploadPostgresPool(): Pool {
  return getDatabase().uploadPool;
}

export { Prisma };
export type { PoolClient as PostgresPoolClient } from "pg";
export type {
  File,
  FileStorageStatus,
  Folder,
  PrismaClient,
  Session,
  ShareLink,
  ShareTargetType,
  SystemSettings,
  User,
  UserPreference,
} from "./generated/prisma/client";
