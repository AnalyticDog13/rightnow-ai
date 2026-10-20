import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

/** The one place a PrismaClient is built; `max` is the pg pool size. */
export const createPrisma = (connectionString: string, max: number) =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString, max }) });
