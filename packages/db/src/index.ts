import { createPrisma } from "./create";
import { PrismaClient } from "./generated/prisma/client";

export { createPrisma };

export { PrismaClient };
export type * from "./generated/prisma/client";

// Singleton survives dev hot reload (module re-evaluation).
const g = globalThis as unknown as { __rnPrisma?: PrismaClient };

function create(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const max = Number.parseInt(process.env.DB_POOL_MAX ?? "", 10) || 10;
  return createPrisma(connectionString, max);
}

export const prisma: PrismaClient = (g.__rnPrisma ??= create());
