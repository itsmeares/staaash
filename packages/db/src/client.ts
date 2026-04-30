import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  __staaashPrisma?: PrismaClient;
};

let productionPrisma: PrismaClient | undefined;

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required before calling getPrisma().");
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export function getPrisma(): PrismaClient {
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__staaashPrisma ??= createPrismaClient();
    return globalForPrisma.__staaashPrisma;
  }

  productionPrisma ??= createPrismaClient();
  return productionPrisma;
}

export { Prisma };
export type {
  File,
  Folder,
  Invite,
  PasswordReset,
  PrismaClient,
  Session,
  ShareLink,
  ShareTargetType,
  SystemSettings,
  User,
  UserPreference,
  UserRole,
} from "./generated/prisma/client";
