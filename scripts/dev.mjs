// Runs web and worker together; either exiting (or Ctrl-C) stops both.
// (`npm run dev --workspaces` runs them one after another, so the worker never starts.)
import process from "node:process";
import { spawn } from "node:child_process";

const procs = ["@rightnow/web", "@rightnow/worker"].map((w) =>
  spawn(`npm run dev -w ${w}`, { stdio: "inherit", shell: true }),
);
let code = 0;
const stop = () => {
  for (const p of procs) if (p.exitCode === null) p.kill();
};
for (const p of procs)
  p.on("exit", (c) => {
    code ||= c ?? 1;
    stop();
  });
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, stop);
process.on("exit", () => (process.exitCode = code));
