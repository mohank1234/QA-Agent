import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "./config";

// Standard Next.js dev-mode singleton: hot reload re-executes this module on
// every edit, and each PrismaClient opens its own connection pool — without
// caching on globalThis, a long dev session exhausts the pool. Production
// has one long-lived module instance either way.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: config.database.url });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (!config.isProduction) {
  globalForPrisma.prisma = prisma;
}
