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

function getDatabase() {
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__staaashDatabase ??= createDatabase();
    return globalForPrisma.__staaashDatabase;
  }

  productionDatabase ??= createDatabase();
  return productionDatabase;
}

export function getPrisma(): PrismaClient {
  return getDatabase().prisma;
}

export function getPostgresPool(): Pool {
  return getDatabase().pool;
}

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
