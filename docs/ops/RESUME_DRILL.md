# Resume drill (spec row 16)

Proves a fresh session recovers after a hard stop: it must name the right next task and the interrupted
change from the repository alone. The drill adds no code to the app. "No duplicate send after a crash"
is proved by `apps/worker/test/restart.test.ts`, `browser-closed.test.ts` and
`packages/core/test/e2e/downtime.test.ts`.

Executed by an agent. The fresh subagent is read-only: told it is a drill, it only reports.

## Prerequisites

- A Postgres at the `.env` `DATABASE_URL` (dev uses port 5433; start the project's dev database first,
  never kill it), `MAIL_PROVIDER_FAKE=1`, `npm ci` done.
- A clean tree except the task's own work. Do not touch `docs/TASKS.json` for the drill.

## Steps

1. Append a marker comment to a tracked file of the next task (for example `# DRILL-MARKER <task>` to
   `docker/entrypoint.sh`). Record `git status --short`, and the first task in `docs/TASKS.json` whose
   status is not `done` (the expected next task).
2. Spawn `npm run dev` as a background child (Bash `run_in_background`). Confirm
   `curl -s localhost:3000/api/healthz` and `curl -s localhost:8081/healthz` answer.
3. Kill the whole tree mid-run: `taskkill /PID <pid> /T /F` on Windows (`kill -- -<pgid>` elsewhere).
   Confirm both ports no longer listen (`netstat -ano | grep -E ":(3000|8081) "` shows nothing).
4. Dispatch a FRESH subagent (Agent tool, no fork) whose prompt is the repo path, the text "keep going",
   and: "This is a drill. Follow the 'Keep going' procedure in CLAUDE.md and `docs/RESUME_INSTRUCTIONS.md`
   read-only: no edits, no commits, no pushes, no agent dispatches, no test runs. Stop after stating
   (a) which task is next and (b) which uncommitted change you believe was interrupted, and what you
   would do first."
5. Compare the answer with the step 1 record.
6. Cleanup: revert only the marker edit (`git diff` first, then undo that one line), confirm
   `git status --short` equals the step 1 record minus the marker, stop any `node`/`next` process the
   drill started, and end orphaned `postgres.exe` whose command line contains `embedded-postgres` and
   this repo, except the dev database.

## Results

| Date       | Expected next task             | Expected interrupted change                                                                                                | Subagent answer                                                                                                            | Result |
| ---------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2026-10-24 | P8-T01 (first task not `done`) | Untracked `apps/web/e2e/placement.spec.ts` and `docs/ops/RESUME_DRILL.md`; plus the drill marker on `docker/entrypoint.sh` | P8-T01; the two untracked files are the real work; the entrypoint marker is the drill's own, to be reverted, not committed | pass   |

Notes (2026-10-24): `npm run dev` was killed with `taskkill /PID <scripts/dev.mjs pid> /T /F`; ports 3000 and 8081 answered
before and were closed after. The marker named the next-after task (P8-T02) on purpose, so the answer also shows the
agent does not mistake a marker for the interrupted task. The dev database on 5433 was not running at the start, so
the drill started a throwaway embedded Postgres there and left it up.
