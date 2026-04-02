import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  __staaashPrisma?: PrismaClient;
};

function getPrismaClient(): PrismaClient {
  if (globalForPrisma.__staaashPrisma) {
    return globalForPrisma.__staaashPrisma;
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required before importing @staaash/db/client.",
    );
  }

  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({ adapter });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__staaashPrisma = client;
  }

  return client;
}

// Lazy proxy: defers client construction (and the DATABASE_URL guard) until the
// first property access. This allows the module to be imported at Next.js build
// time without a live DATABASE_URL in the environment.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return getPrismaClient()[prop as keyof PrismaClient];
  },
});

export { Prisma };
export type {
  File,
  Folder,
  Invite,
  PasswordReset,
  Session,
  ShareLink,
  ShareTargetType,
  User,
  UserRole,
} from "./generated/prisma/client";
