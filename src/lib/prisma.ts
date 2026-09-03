import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "./config";

// Standard Next.js dev-mode singleton: hot reload re-executes this module on
// every edit, and each PrismaClient opens its own connection pool — without
// caching on globalThis, a long dev session exhausts the pool. Production
// has one long-lived module instance either way.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  // `pg`'s own default pool max is 10. A single busy chat turn can hold
  // several connections at once — save_requirements/save_test_cases calls,
  // execution/evidence writes, a background test-suite run — all while the
  // project tabs the user is looking at are independently reading the same
  // database. Raised as cheap headroom against that overlap; unused
  // capacity here costs nothing.
  const adapter = new PrismaPg({ connectionString: config.database.url, max: 20 });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (!config.isProduction) {
  globalForPrisma.prisma = prisma;
}
