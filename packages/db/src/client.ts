import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { Prisma, PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  __staaashDatabase?: {
    pool: Pool;
    uploadPool: Pool;
    prisma: PrismaClient;
    storagePrisma: PrismaClient;
  };
};

let productionDatabase:
  | {
      pool: Pool;
      uploadPool: Pool;
      prisma: PrismaClient;
      storagePrisma: PrismaClient;
    }
  | undefined;

// The list queries' recursive CTEs push the planner's cost estimate past
// jit_above_cost, so PostgreSQL spends most of each run compiling code for
// work that takes a few milliseconds (Trash: 738 ms with JIT, 30 ms without).
// Staaash runs no query large enough to gain from JIT.
const connectionOptions = (connectionString: string | undefined) => ({
  connectionString,
  options: "-c jit=off",
});

function createDatabase() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required before calling getPrisma().");
  }

  const pool = new Pool(connectionOptions(connectionString));
  const uploadPool = new Pool({
    ...connectionOptions(connectionString),
    max: 3,
  });
  // An idle connection dies when PostgreSQL restarts. The pool drops it and
  // opens a new one; without a listener Node would exit instead.
  for (const each of [pool, uploadPool]) {
    each.on("error", (error) =>
      console.warn("[db] Idle PostgreSQL connection closed.", error.message),
    );
  }
  const adapter = new PrismaPg(pool, { disposeExternalPool: true });
  return {
    pool,
    uploadPool,
    prisma: new PrismaClient({ adapter }),
    storagePrisma: new PrismaClient({
      adapter: new PrismaPg({ ...connectionOptions(connectionString), max: 3 }),
    }),
  };
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

export function getStoragePrisma(): PrismaClient {
  const database = getDatabase();
  // A development reload can reuse a cache created before the storage pool existed.
  database.storagePrisma ??= new PrismaClient({
    adapter: new PrismaPg({
      ...connectionOptions(database.pool.options.connectionString),
      max: 3,
    }),
  });
  return database.storagePrisma;
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
