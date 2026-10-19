# Phase 1 — Foundation: step plan

> Implements P1-T01..P1-T07 of `docs/IMPLEMENTATION_PLAN.md`. Read its Global Constraints first.
> Versions and setup snippets: `docs/STACK.md`. Use superpowers:test-driven-development per task.

## Fixed names (all later phases rely on these)

| Thing | Value |
|---|---|
| Workspace packages | `@rightnow/web` (apps/web), `@rightnow/worker` (apps/worker), `@rightnow/db`, `@rightnow/core`, `@rightnow/providers` |
| Internal package consumption | TS source, no build: each package.json `"exports": { ".": "./src/index.ts" }`; web uses `transpilePackages`; worker runs with `tsx` (dev and prod) |
| Module format | ESM everywhere (`"type": "module"`) |
| Prisma client import | `import { prisma, type PrismaClient } from "@rightnow/db"`; generated output `packages/db/src/generated/prisma` (gitignored, generated on `postinstall`) |
| Root scripts | `dev` (web+worker concurrently via `npm run dev --workspaces --if-present`), `test` (`vitest run`), `lint`, `typecheck` (`tsc -b` or per-workspace `tsc --noEmit`), `e2e` (playwright), `db:migrate` (`prisma migrate dev`), `db:deploy`, `db:generate` |
| Env vars (in `.env.example`) | `MODE=local|vps`, `DATABASE_URL`, `DB_POOL_MAX`, `ENCRYPTION_KEY` (32-byte base64), `BETTER_AUTH_SECRET`, `SETUP_TOKEN`, `APP_URL`, `WORKER_HEALTH_PORT=8081`, `SYNC_MAX_STALENESS_SEC=300`, provider vars added later |
| Branch | all Phase 1 work on `phase-1-foundation`; push after each task; fast-forward `main` at the phase gate |
| Clock | `packages/core/src/clock.ts`: `type Clock = { now(): Date }`, `systemClock`, `fixedClock(d)` with `advance(ms)` |
| Health | `/api/healthz` (liveness), `/api/readyz` (db + worker heartbeat ≤ 2 min + sync-gate summary) |
| Test DB | Vitest `globalSetup` (`packages/db/test/global-setup.ts`) starts one embedded-postgres, creates DB `template_rn`, runs `prisma migrate deploy` against it, exposes `TEST_PG_URL_BASE` via `provide()`. `createTestDb()` in `packages/db/src/test-db.ts` creates `CREATE DATABASE t_<rand> TEMPLATE template_rn` and returns `{ prisma, url, drop }` |

## P1-T01 Monorepo scaffold & tooling

Owns: PS-DEPLOY-01, PS-DEPLOY-03 (partially; finished by P1-T06), PS-DEPLOY-16 (unit part; e2e added P1-T04).

Files: `package.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`, `vitest.config.ts` (projects = packages/*, apps/*), `LICENSE` (MIT, "rightnow-ai contributors", 2026), `README.md` (what it is, quickstart pointing to docs/ops/LOCAL.md), `.env.example`, `.github/workflows/ci.yml`, empty `packages/core/src/index.ts` with one smoke test.

- [ ] Write `packages/core/test/smoke.test.ts`: `expect(VERSION).toBe("0.1.0")` importing `VERSION` from `@rightnow/core`.
- [ ] Run `npm test` → FAIL (no package).
- [ ] Create the files; `npm install`.
- [ ] Run `npm test && npm run lint && npm run typecheck` → all pass.
- [ ] CI: Ubuntu, Node 24, `npm ci`, lint, typecheck, test. Push, confirm green with the GitHub API (`git ls-remote` + Actions page; `gh` is not installed — use `curl https://api.github.com/repos/AnalyticDog13/rightnow-ai/actions/runs?per_page=1`).
- [ ] Commit `chore: monorepo scaffold, tooling, CI`.

## P1-T02 Database package + test harness

Owns: PS-SEC-01 (data model convention + a tenant-isolation test helper `expectIsolated()` reused by later tasks, PS-SEC-14).

Files: `packages/db/{package.json,prisma.config.ts,prisma/schema.prisma,src/index.ts,src/test-db.ts,test/global-setup.ts,test/workspace.test.ts}`.

Schema now: `Workspace(id cuid, name, slug unique, createdAt)`, `AuditLog(id, workspaceId, actorId?, action, target?, meta Json?, createdAt, @@index([workspaceId, createdAt]))`, `ApiKey(id, workspaceId, name, prefix, hash unique, createdAt, lastUsedAt?, revokedAt?)`. Auth tables are added in P1-T04 by better-auth's generator. Workspace = better-auth Organization: in P1-T04 the `Organization` model is the workspace; in this task create `Workspace` and in P1-T04 map better-auth's organization model name to `Workspace` (better-auth `organization({ schema: { organization: { modelName: "workspace" } } })`) — the implementer of P1-T04 reconciles fields.

- [ ] Test `workspace.test.ts`: create Workspace, read by slug, duplicate slug rejects with Prisma `P2002`.
- [ ] Run → FAIL.
- [ ] Implement schema, first migration `init`, client (`PrismaPg` adapter, singleton across hot reload), `createTestDb`.
- [ ] Run → PASS on Windows. Also a test that two `createTestDb()` calls are isolated.
- [ ] Commit `feat(db): prisma schema, migrations, embedded-postgres test harness`.

## P1-T03 Core crypto + env + clock

Owns: PS-SEC-05 (env-only secrets, never logged; `docs/ops/KEY_ROTATION.md` with re-encrypt script `scripts/rotate-key.ts` taking old+new keys).

Files: `packages/core/src/{crypto.ts,env.ts}`, tests.

- `encrypt(plain: string, key?: Buffer): string` → `"v1:" + base64(iv12 | tag16 | ciphertext)`; `decrypt(enc: string, key?: Buffer): string`; default key from `getEnv().ENCRYPTION_KEY`.
- `getEnv()` zod schema, memoized, throws listing every missing/invalid var.
- [ ] Tests: round-trip unicode; flipped byte → throws; other key → throws; `"v2:"` prefix → throws "unsupported"; key not 32 bytes → throws.
- [ ] Implement with `node:crypto` only. Pass. Commit `feat(core): credential encryption and env validation`.

## P1-T04 Web app shell + auth

Owns: PS-UI-01, PS-UI-05 (theme + accessible primitives), PS-SEC-03 (except 2FA → P7-T07), PS-SEC-04, PS-SEC-06, PS-DEPLOY-04/05 (wrapper behavior).

Files: `apps/web/**` (create-next-app equivalent by hand or CLI, then trim), `apps/web/lib/{auth.ts,auth-client.ts,workspace.ts,api.ts}`, `apps/web/app/api/auth/[...all]/route.ts`, `apps/web/app/(auth)/{sign-in,sign-up}/page.tsx`, `apps/web/app/(app)/layout.tsx` (sidebar), `apps/web/app/(app)/<section>/page.tsx` for: dashboard, accounts, deliverability, campaigns, leads, inbox, crm, analytics, automations, settings. `apps/web/app/api/health/route.ts` (`{ok:true, db:true}` after `select 1`). Playwright config `apps/web/playwright.config.ts` using embedded-postgres via a small `e2e/global-setup.ts` that reuses `@rightnow/db` test harness and starts `next dev` with that DATABASE_URL.

- Sign-up: first owner only with the correct `SETUP_TOKEN` (form field) while zero users exist; race-safe (Postgres advisory lock or unique singleton row); creates the user, Workspace, OWNER membership; afterwards only invites. Login rate limit (better-auth rate-limit config).
- `requireWorkspace(): Promise<{ userId: string; workspaceId: string }>` — redirects to `/sign-in` in pages; in API throws `HttpError(401)`.
- `route<S extends z.ZodType>(opts: { body?: S; query?: S; auth?: "session" | "session-or-apikey" | "public"; role?: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" (minimum, default MEMBER for writes, VIEWER for GET); scope?: string (api key scope e.g. "leads:read") }, handler: (ctx: { userId?: string; workspaceId: string; body; query; req }) => Promise<unknown>)` → Next route handler; maps `HttpError(status,msg)` → JSON `{error}`; zod error → 400 with issues; unknown → 500 logged.
- [ ] Vitest `api.test.ts`: unauthenticated → 401; VIEWER on write → 403; unknown body property → 400 (zod `.strict()`); bad body → 400 with issue path; ok → 200 JSON (session getter injected).
- [ ] Playwright `auth.spec.ts`: sign up with SETUP_TOKEN → Dashboard with the 10 nav items in spec order → sign out → sign-in page; wrong token rejected; second owner sign-up blocked.
- [ ] Vitest: two concurrent first-owner sign-ups → exactly one succeeds.
- [ ] Section pages show a real empty state naming what arrives in which phase (temporary; each later task replaces it).
- [ ] Commit `feat(web): Next.js shell, better-auth with workspaces, API handler wrapper`.

## P1-T05 Worker skeleton

Owns: worker side of PS-DEPLOY-12.

Files: `apps/worker/src/{index.ts,boss.ts,jobs/index.ts,jobs/heartbeat.ts,health.ts}`, tests. Schema: `WorkerBoot(id, startedAt, hostname, lastHeartbeatAt, stoppedAt?)`; heartbeat every 30 s.

- `startWorker(opts: { databaseUrl: string; jobs?: JobDef[] }): Promise<{ bootId: string; boss: PgBoss; stop(): Promise<void> }>`; `type JobDef = { name: string; cron?: string; options?: QueueOptions; handler: (jobs: Job[]) => Promise<void> }`.
- On start: insert WorkerBoot, createQueue for each job, schedule crons, start health server (`GET /healthz` → 200 when boss started & DB reachable).
- [ ] Test: start against test DB with a demo job, `boss.send` it, handler called within 5 s; `stop()` resolves and stamps `stoppedAt`.
- [ ] Commit `feat(worker): pg-boss worker skeleton with boot record and health endpoint`.

## P1-T06 Docker & deploy baseline

Owns: PS-DEPLOY-03, 07, 08, 09, 10 (backup/restore incl. ENCRYPTION_KEY note), 16 (CI e2e on compose stack). PS-DEPLOY-11 finished in P8-T02, PS-DEPLOY-13 documented in LOCAL.md.

Files: `docker/Dockerfile`, `docker/Caddyfile`, `docker-compose.yml`, `.dockerignore`, `scripts/{start,stop,upgrade,backup,restore}.sh` + `.ps1`, `docs/ops/LOCAL.md`, `docs/ops/VPS.md`, CI job `compose-smoke`.

- One image; entry `docker/entrypoint.sh` with `web` | `worker` | `migrate`. Postgres 18 (`postgres:18-alpine`) volume `pgdata`; `migrate` service runs `prisma migrate deploy` and web/worker `depends_on: migrate: condition: service_completed_successfully`; `restart: unless-stopped`; healthchecks (pg_isready, `/api/health`, worker `/healthz`). Caddy in profile `vps` with `{$DOMAIN}` reverse_proxy web:3000.
- backup = `pg_dump -Fc` via `docker compose exec` to `backups/rightnow-<ts>.dump`; restore = stop web/worker, `pg_restore --clean`, start.
- [ ] CI `compose-smoke`: `docker compose up -d --build`, poll `/api/health` 120 s, run backup script, restore into fresh volume, health again.
- [ ] Commit `feat(deploy): docker image, compose, scripts, ops docs`.

## P1-T07 API keys + audit log + readiness

Owns: PS-SEC-02, PS-SEC-07 (helper + login/key events; other actions call it in their tasks), PS-DEPLOY-12.

Files: `packages/core/src/{audit.ts,apikeys.ts}`, `apps/web/app/api/v1/api-keys/route.ts` (+ `[id]/route.ts`), `apps/web/app/(app)/settings/api-keys/page.tsx`, `route()` gains apikey auth.

- `createApiKey(prisma, workspaceId, name, scopes: string[]): Promise<{ id; token }>` token `rn_<prefix8>_<secret32>`; store sha256(token); `verifyApiKey(prisma, token): Promise<{ workspaceId; keyId } | null>` (updates lastUsedAt, rejects revoked); `audit(prisma, ctx, action, target?, meta?)`.
- `verifyApiKey` returns `scopes`; `route({scope})` checks `scopes` includes the scope, `<resource>:all`, or `all:all`.
- [ ] Tests: key with `leads:read` → GET ok, POST 403; wrong secret → null; revoked → null; other workspace's key cannot revoke; audit row written on create/revoke.
- [ ] Commit `feat: API keys and audit log`.

## Phase gate
Full `npm test`, lint, typecheck, Playwright, CI green; `ponytail-audit` by fresh reviewer; update docs; push.
