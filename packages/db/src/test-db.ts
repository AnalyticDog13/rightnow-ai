import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { inject } from "vitest";
import { PrismaClient } from "./generated/prisma/client";

/** Clones the migrated template DB; call from a test file (needs the db globalSetup). */
export async function createTestDb() {
  const base = inject("TEST_PG_URL_BASE");
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name} TEMPLATE template_rn`);
  } finally {
    await admin.end();
  }
  const url = `${base}/${name}`;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 5 }) });
  const drop = async () => {
    await prisma.$disconnect();
    const a = new pg.Client({ connectionString: `${base}/postgres` });
    await a.connect();
    try {
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      await a.end();
    }
  };
  return { prisma, url, drop };
}
