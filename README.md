# rightnow-ai

A self-hosted, open-source (MIT) alternative to Instantly.ai. Connect your own mailboxes, warm them up (or
re-warm them after a break), run multi-step cold-email campaigns, handle every reply in one inbox, and track
deals in a built-in CRM. The same codebase runs on your laptop (Docker Compose) or on a Linux VPS.

> **Status:** all 8 phases are built and tested. Real-provider campaign sending is enabled per provider
> once `scripts/live-verify.ts` passes for it. Progress log: [docs/PROGRESS.md](docs/PROGRESS.md).
> Full plan: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## What it will do

| Area | Highlights |
|---|---|
| Email accounts | Google (Gmail API), Microsoft 365 / Outlook (Graph), any IMAP/SMTP host; encrypted credentials; per-account limits and health |
| Warm-up & deliverability | Gradual ramp-up, SPF/DKIM/DMARC/MX checks, bounce monitoring, automatic slow-down; **re-warm-up** for mailboxes that sat idle |
| Campaigns | Unlimited steps, delays, A/B variants, `{{RANDOM \| Hi \| Hello}}` spintax, merge fields with fallbacks, schedules per timezone, account rotation |
| Reliable sending | Postgres-backed queue: quotas reserved atomically, no duplicate sends, safe crash recovery, never sends outside your schedule |
| Offline recovery | After downtime or laptop sleep, each mailbox re-syncs replies, bounces and unsubscribes **before** it may send again |
| Leads | CSV import with mapping and dedupe, lists, custom fields, tags, suppression/blocklist |
| Unified inbox | All mailboxes, threaded, reply classification (interested, out of office, unsubscribe…), notes, reminders |
| CRM & analytics | Kanban pipeline, opportunities and revenue attributed to campaigns, dashboards, CSV export |
| Automations | Event rules, signed webhooks, REST API with scoped keys, optional AI drafting with human approval |

Honesty rules built in: no fake engagement, no spoofed senders, no claims that warm-up guarantees inbox
placement, and every campaign email carries a working unsubscribe.

RightNow.ai is an independent project. It is not affiliated with or endorsed by Instantly.ai; "Instantly" is a
trademark of its owner and is used here only to describe the workflows this project is compatible with.

## Responsible use

You are responsible for how you use this software. Before you email anyone you need a lawful basis to do so
(for example CAN-SPAM in the US, GDPR/PECR in the EU and UK, CASL in Canada, as applicable to you and your
recipients). Send only as your own, honestly identified sender. An unsubscribe link is built into every campaign
email and cannot be disabled, and unsubscribes are always honored. Your mailbox providers' terms also apply and
can restrict cold email. The software is provided without warranty (see [LICENSE](LICENSE)); nothing here is legal
advice. More detail: [docs/COMPLIANCE.md](docs/COMPLIANCE.md) and [docs/PROVIDER_COMPLIANCE.md](docs/PROVIDER_COMPLIANCE.md).

## Architecture

```
apps/web        Next.js app: UI + REST API (/api/v1)
apps/worker     Background jobs: sync, scheduling, sending, warm-up
packages/db     Prisma schema, migrations, test database harness
packages/core   Domain logic (templates, quotas, scheduling, crypto…)
packages/providers  Gmail / Microsoft Graph / IMAP-SMTP adapters
```

PostgreSQL is the only stateful service. It also holds the job queue, so there is no Redis to run or back up.
Reasons for this and other choices: [docs/DECISIONS.md](docs/DECISIONS.md).

## Requirements

- Node.js 22.12+ (CI uses Node 24) and npm
- PostgreSQL 18 to run the app (Docker Compose will provide it; see below)
- Tests need neither Docker nor Postgres: they start a real embedded Postgres automatically

## Run it (development)

```bash
npm ci
cp .env.example .env        # then fill in ENCRYPTION_KEY, BETTER_AUTH_SECRET, SETUP_TOKEN, DATABASE_URL
npm run db:deploy           # apply migrations
npm run dev                 # web on http://localhost:3000
```

Open `/sign-up` and create the owner account using your `SETUP_TOKEN`. Sign-up closes after the first owner;
further users join by invite.

Generate secrets with `openssl rand -base64 32`. Back up `ENCRYPTION_KEY` together with your database: without
it, stored mailbox credentials cannot be decrypted. Key rotation: [docs/ops/KEY_ROTATION.md](docs/ops/KEY_ROTATION.md).

Docker Compose (local and VPS modes, backup/restore, HTTPS): [docs/ops/LOCAL.md](docs/ops/LOCAL.md) and
[docs/ops/VPS.md](docs/ops/VPS.md).

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Unit and integration tests (Vitest, embedded Postgres) |
| `npm run e2e` | Browser tests (Playwright); first run `npx playwright install chromium` |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run db:migrate` | Create a migration in development |
| `npm run db:deploy` | Apply migrations |

## Documentation

- [Product spec and Instantly parity checklist](docs/PRODUCT_SPEC.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md) · [Progress](docs/PROGRESS.md) · [Decisions](docs/DECISIONS.md)
- [Provider rules and limits (Gmail, Microsoft, SMTP)](docs/PROVIDER_COMPLIANCE.md)
- [Stack and versions](docs/STACK.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) (tests, conventional commits, DCO sign-off, security reports). This project is built with Claude Code following the process in [CLAUDE.md](CLAUDE.md): small tasks, tests
first, independent review, one branch per phase. Resuming work in a new session: [docs/RESUME_INSTRUCTIONS.md](docs/RESUME_INSTRUCTIONS.md).

## License

[MIT](LICENSE). Third-party dependency licenses: [docs/LICENSES.md](docs/LICENSES.md) and [NOTICE](NOTICE).
