import { expect, test } from "vitest";
import { pushLine } from "../app/(app)/accounts/push-line";

const at = "2026-11-08T12:00:00.000Z";

test("the push status line says when push ends, or why it is not on, and polling always runs", () => {
  const poll = " · Polling every 2 min";
  expect(pushLine({ state: "active", expiresAt: new Date(at), error: null })).toBe(
    `Push: active until ${new Date(at).toLocaleString()}${poll}`,
  );
  expect(pushLine({ state: "expired", expiresAt: new Date(at), error: null })).toBe(
    `Push: expired${poll}`,
  );
  expect(pushLine({ state: "failed", expiresAt: null, error: "pubsub_permission" })).toBe(
    `Push: failed: pubsub_permission${poll}`,
  );
  expect(pushLine({ state: "pending", expiresAt: null, error: null })).toBe(
    `Push: starting${poll}`,
  );
  expect(pushLine({ state: "not_configured", expiresAt: null, error: null })).toBe(
    `Push: not configured${poll}`,
  );
  expect(pushLine({ state: "failed", expiresAt: null, error: null })).not.toContain("�");
});
