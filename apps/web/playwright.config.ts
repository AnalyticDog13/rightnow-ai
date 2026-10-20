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
    // creates the owner the other specs sign in as; every other spec runs after it
    { name: "setup", testMatch: "auth.spec.ts", use: { browserName: "chromium" } },
    {
      name: "chromium",
      testIgnore: "auth.spec.ts",
      dependencies: ["setup"],
      use: { browserName: "chromium" },
    },
  ],
});
