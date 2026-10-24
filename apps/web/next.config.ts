import { config } from "dotenv";
import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// The documented .env lives at the repo root (never overrides real env vars).
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const nextConfig: NextConfig = {
  transpilePackages: ["@rightnow/db", "@rightnow/core", "@rightnow/providers"],
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  // D49: on every response, API included (the page CSP is set per request in proxy.ts)
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    },
  ],
};
export default nextConfig;
