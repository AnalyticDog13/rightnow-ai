import { config } from "dotenv";
import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// The documented .env lives at the repo root (never overrides real env vars).
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const nextConfig: NextConfig = {
  transpilePackages: ["@rightnow/db", "@rightnow/core", "@rightnow/providers"],
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
};
export default nextConfig;
