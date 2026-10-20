import { defineConfig } from "@playwright/test";
import { E2E_PORT } from "./e2e/env";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1, // one shared DB: the tests are a sequence (first owner, then blocked)
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 30_000 }, // first requests compile routes in next dev
  use: { baseURL: `http://localhost:${E2E_PORT}` },
  projects: [
    { name: "auth", testMatch: "auth.spec.ts", use: { browserName: "chromium" } },
    // needs the owner that auth.spec creates
    {
      name: "accounts",
      testMatch: "accounts-google.spec.ts",
      dependencies: ["auth"],
      use: { browserName: "chromium" },
    },
  ],
});
