import { expect, test } from "vitest";
import { jobs } from "../src/jobs";
import { abOptimizeJob } from "../src/jobs/ab-optimize";

test("ab-optimize: hourly at :17, stately, with a heartbeat (R2), registered", () => {
  expect(abOptimizeJob).toMatchObject({
    name: "ab-optimize",
    cron: "17 * * * *",
    options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10 },
  });
  expect(jobs).toContain(abOptimizeJob);
});
