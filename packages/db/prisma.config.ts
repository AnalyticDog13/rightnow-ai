import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

// The documented .env lives at the repo root.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // lazy: `prisma generate` needs no database, migrate commands do
    get url() {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error("DATABASE_URL is not set (set it in the repo-root .env, see .env.example)");
      return url;
    },
  },
});
