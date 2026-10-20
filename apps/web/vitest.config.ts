import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["e2e/**", "node_modules/**"],
    globalSetup: ["../../packages/db/test/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
