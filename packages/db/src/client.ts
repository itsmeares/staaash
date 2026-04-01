import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  __staaashPrisma?: PrismaClient;
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is required before importing @staaash/db/client.",
  );
}

const adapter = new PrismaPg({
  connectionString,
});

export const prisma =
  globalForPrisma.__staaashPrisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__staaashPrisma = prisma;
}

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
