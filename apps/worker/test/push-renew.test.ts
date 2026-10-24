import { expect, test } from "vitest";
import { jobs } from "../src/jobs";
import { pushRenewJob } from "../src/jobs/push-renew";

test("push-renew: every 30 min, at boot, stately, with a heartbeat (R2), registered", () => {
  expect(pushRenewJob).toMatchObject({
    name: "push-renew",
    cron: "*/30 * * * *",
    boot: true,
    options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10 },
  });
  expect(jobs).toContain(pushRenewJob);
});
