import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["e2e/**", "node_modules/**", "**/.next/**"],
    globalSetup: ["../../packages/db/test/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
