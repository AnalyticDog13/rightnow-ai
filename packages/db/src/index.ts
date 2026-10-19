import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export { PrismaClient };
export type * from "./generated/prisma/client";

// Singleton survives dev hot reload (module re-evaluation).
const g = globalThis as unknown as { __rnPrisma?: PrismaClient };

function create(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const max = Number(process.env.DB_POOL_MAX ?? 10);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max }) });
}

export const prisma: PrismaClient = (g.__rnPrisma ??= create());
