# Stack versions and setup notes

Checked 2026-10-19 with `npm view <pkg> version` (npm `latest` tag). Pin exact versions in package.json.

| Package | Version | Notes |
|---|---|---|
| next | 16.4.2 | Peers: react ^18.2 or ^19; Node >=20 assumed. App Router, route handlers = API (D2). |
| react / react-dom | 19.3.1 | |
| typescript | 7.0.2 | Latest tag is 7.x (native compiler line). If a tool (eslint-config-next, prisma) chokes, pin 5.9/6.x; smoke-test first. |
| tailwindcss | 4.3.3 | v4: CSS-first (`@import "tailwindcss"`), plus `@tailwindcss/postcss` in Next. No tailwind.config.js needed. |
| shadcn (CLI) | 4.22.1 | `npx shadcn@latest init` (Tailwind v4 + React 19 supported). |
| prisma | 8.0.0-rc.23 (`latest` tag!) | **Release candidate is tagged latest.** Use `prisma@7.10.1` (tag `prev`) to stay stable. |
| @prisma/client | 7.10.1 | Stable latest. Keep prisma CLI and client on same version. |
| @prisma/adapter-pg | 7.10.1 | Required driver adapter (see below). |
| pg | 8.23.1 | Used by adapter, pg-boss, tests. |
| pg-boss | 12.38.0 | Node >=22.12. ESM/TS typings included. |
| better-auth | 1.7.11 | Peers accept next 14-16, prisma 5-7, vitest up to 5, pg. |
| next-auth | 4.24.15 (latest); 5.0.0-beta.32 | v5 (Auth.js) is still beta after years; no org model. |
| zod | 4.6.7 | v4 API (`z.email()`, `z.url()`). |
| vitest | 5.0.5 | |
| @playwright/test | 1.64.1 | `npx playwright install chromium`. Next peers ^1.51. |
| embedded-postgres | 18.4.0-beta.17 | Tested OK on this machine (below). Postgres 18.4, Windows x64 binary `@embedded-postgres/windows-x64`. |
| @googleapis/gmail | 22.0.2 | NOT USED (D10): Gmail via plain fetch. |
| google-auth-library | 11.3.1 | NOT USED (D10). |
| @azure/msal-node | 7.1.0 | NOT USED (D10): hides refresh tokens; OAuth and Graph via plain fetch. |
| imapflow | 2.5.8 | IMAP IDLE, async API. |
| nodemailer | 10.1.7 | SMTP send; also builds MIME for Gmail API raw send. |
| mailparser | 3.10.0 | `simpleParser` for inbound/replies. |
| smtp-server (dev) | 3.20.2 | In-process SMTP test server (D11); `@types/smtp-server` 3.5.13. |
| hoodiecrow-imap (dev) | 3.3.1 | In-process scriptable IMAP test server (D11); young, see spike and `imap-real` CI job (GreenMail container). |
| recharts | 3.10.1 | v3; client components only. |
| tsx | 4.23.15 | Runs TS scripts and the worker (dev + prod), per phase-1 fixed names. |
| papaparse | 5.7.0 | CSV lead import; add `@types/papaparse`. |
| @tanstack/react-table | 9.3.1 | v9 line (latest tag); API differs from v8 tutorials. Check docs before copying snippets. |
| eslint | 10.13.0 | Flat config only (`eslint.config.mjs`). |
| eslint-config-next | 16.4.2 | Matches next; check it supports eslint 10, else pin eslint 9. |

## Auth: use better-auth
- Email+password is built in; `organization()` plugin gives organizations/members/roles/invitations (workspaces) out of the box.
- Prisma adapter, Next.js route handler (`toNextJsHandler`), and `npx auth generate` for schema; peer ranges cover our versions.
- next-auth 4 has no orgs and is legacy; v5 is perpetual beta and credentials login is deliberately second class. Orgs would be hand-rolled.
- Setup: `betterAuth({ database: prismaAdapter(prisma,{provider:"postgresql"}), emailAndPassword:{enabled:true}, plugins:[organization()] })`; client: `createAuthClient({plugins:[organizationClient()]})`. Docs: https://www.better-auth.com/docs/plugins/organization

## Prisma 7 (use this, not the 8 RC)
- Generator is `prisma-client` (not `prisma-client-js`, deprecated) and `output` is REQUIRED:
  `generator client { provider = "prisma-client"  output = "../src/generated/prisma" }`
- Import from the generated path, not `@prisma/client`: `import { PrismaClient } from "./generated/prisma/client"`.
- Driver adapter required: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`.
- `prisma.config.ts` required at package root (schema path, migrations path, datasource url); Prisma no longer reads `.env` itself, so `import "dotenv/config"` there and in the worker.
- Shared generated client lives in a workspace package (e.g. `packages/db`) used by web and worker; web needs `transpilePackages` or a build step.
- Sources: https://www.prisma.io/docs/orm/prisma-schema/overview/generators (adapter/config details for 7 from release notes; verify `prisma.config.ts` fields on first `prisma init`).

## pg-boss 12 (verified against shipped typings)
```ts
import { PgBoss } from "pg-boss";           // check named vs default export on install
const boss = new PgBoss(DATABASE_URL); boss.on("error", console.error);
await boss.start();
await boss.createQueue("send", { retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600, deadLetter: "send_dlq" });
await boss.send("send", { id }, { singletonKey: id, startAfter: date });   // singletonKey dedups queued/active
await boss.work("send", { batchSize: 1 }, async ([job]) => { ... });       // handler receives an ARRAY of jobs
await boss.schedule("poll-inboxes", "*/2 * * * *", {});                      // cron; boss.unschedule(name)
```
- Queues must be created (`createQueue`) before send/work. Retry options: `retryLimit`, `retryDelay`, `retryBackoff`, `retryDelayMax`. `singletonKey`, `singletonSeconds` for throttle/dedupe. Queue policies include `stately`, `key_strict_fifo`.
- It uses its own schema `pgboss`, separate connection; do not put it in Prisma migrations.

## embedded-postgres (tested on this machine: WORKS)
Windows 11 x64, Node 24, installed `embedded-postgres@18.4.0-beta.17` + `pg`. Initialised, started on a random port, `select version()` returned `PostgreSQL 18.4 on x86_64-windows, compiled by msvc-19.44.35226, 64-bit`, stopped cleanly (~10s cold start incl. initdb). Scratch: `...\scratchpad\epg\t.mjs`.
```js
import EmbeddedPostgres from "embedded-postgres"; import pg from "pg"; import net from "net";
const port = await new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const e = new EmbeddedPostgres({ databaseDir: "./data", user: "postgres", password: "pw", port, persistent: false });
await e.initialise(); await e.start();
const c = new pg.Client({ host: "localhost", port, user: "postgres", password: "pw", database: "postgres" });
await c.connect(); console.log((await c.query("select version()")).rows[0].version); await c.end();
await e.stop();
```
Notes: Postgres refuses to run as Windows admin (use non-elevated shell). Use a unique `databaseDir` per test run (os.tmpdir) and `createDatabase()` per test file. Postgres logs go to stderr; pass `onLog`/`onError` to silence. Use vitest `globalSetup` to boot one server and expose its URL.
