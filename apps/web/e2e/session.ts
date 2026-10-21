import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type PlaywrightWorkerArgs } from "@playwright/test";

// One owner session for every spec, saved after the first sign-in: better-auth allows 5 sign-ins a minute,
// and each retry of a beforeAll would spend more. global-setup deletes the file so it never outlives the DB.
export const STATE = join(tmpdir(), "rightnow-e2e-ada.json");

export async function ensureSession(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string,
) {
  if (existsSync(STATE)) return;
  const api = await playwright.request.newContext({ baseURL, storageState: undefined });
  let ok = false;
  for (let i = 0; i < 8 && !ok; i++) {
    const r = await api.post("/api/auth/sign-in/email", {
      data: { email: "ada@example.com", password: "correct horse battery" },
      headers: { origin: baseURL },
    });
    ok = r.ok();
    if (!ok) await new Promise((r) => setTimeout(r, 10_000)); // rate limited: wait out the window
  }
  expect(ok).toBe(true);
  await api.storageState({ path: STATE });
  await api.dispose();
}
