# rightnow-ai

Open-source (MIT), self-hosted alternative to Instantly.ai: cold-email accounts, warm-up/re-warm-up,
campaigns + sequences, leads, unified inbox, CRM, analytics, automations.
Authoritative spec: `rightnow_ai_master_prompt.md` (root). Derived docs live in `docs/`.
Repo: https://github.com/AnalyticDog13/rightnow-ai (branch `main`).

## "Keep going" recovery procedure

When the user says "keep going" (or any session starts mid-project), do exactly this:
1. Read this file, then `docs/HANDOFF.md`, `docs/TASKS.json`, `docs/PROGRESS.md`.
2. `git status`, `git log --oneline -15`, `git branch -a`. Uncommitted changes = interrupted task; inspect, keep usable work.
3. Reconcile `docs/TASKS.json` against the code. First task not `done` is the next task.
4. Re-run only the tests for the interrupted task, then continue the loop in "Development workflow".
5. Never re-plan, restart, or redo `done` tasks unless `docs/IMPLEMENTATION_PLAN.md` is demonstrably obsolete.
Details: `docs/RESUME_INSTRUCTIONS.md`.

## Architecture principles (see `docs/DECISIONS.md` for reasons)

- npm workspaces monorepo: `apps/web` (Next.js UI + API routes), `apps/worker` (background jobs),
  `packages/db` (Prisma), `packages/core` (pure domain logic), `packages/providers` (Gmail / Graph / IMAP-SMTP).
- PostgreSQL is the single source of truth, including the job queue (pg-boss) and the send queue
  (`ScheduledMessage` rows claimed with `FOR UPDATE SKIP LOCKED`). No Redis. Quotas are reserved in the
  same transaction that claims a send, so parallel workers cannot exceed limits or double-send.
- Every startup reconciles each mailbox (incremental, full-reconcile fallback) before that mailbox may send.
  No burst-sending of backlog; uncertain sends are never retried blindly.
- Same codebase for local (Docker Compose) and VPS (Compose + Caddy HTTPS, backups).
- Secrets only in env vars; OAuth tokens and SMTP passwords encrypted at rest (AES-256-GCM).
- Every query is scoped by `workspaceId` (multi-tenant ready, single owner today).
- No fabricated engagement, no limit circumvention, honest sender identity, unsubscribe always honored.

## Tooling: Superpowers + Ponytail (both installed as Claude Code plugins, user scope)

- Superpowers 7.x: `writing-plans`, `subagent-driven-development`, `test-driven-development`,
  `systematic-debugging`, `requesting-code-review`, `verification-before-completion`.
- Ponytail 5.x (level `full`): smallest complete change, reuse before adding, no speculative abstraction.
  Run `ponytail-review` on each significant task, `ponytail-audit` after each phase, `ponytail-debt` periodically.
  If Ponytail would remove spec-required functionality, keep the feature and simplify the implementation.
- If a session lacks either plugin, follow the same procedures manually and note it in `docs/HANDOFF.md`.

## Model policy

Orchestrator delegates. Subagents get an explicit `model`: `sonnet` by default (implementation, tests, reviews),
`haiku` for mechanical edits / file inspection, `opus` only for concurrency/security design, stuck debugging,
and the final cross-system review. Escalate one task, never the whole project. No unbounded parallel agents
(max 2 concurrent implementers, only on disjoint files).

## Commands

Not yet confirmed; filled in by task P1-T01. Planned: `npm install`, `npm run dev`, `npm test`,
`npm run lint`, `npm run typecheck`, `npm run e2e`, `docker compose up -d`.
Docker is NOT installed on the primary dev machine (Windows, no WSL): tests use `embedded-postgres`;
Docker builds are verified in GitHub Actions CI.

## Development workflow (every task)

1. Pick next task from `docs/TASKS.json`; read its section in `docs/IMPLEMENTATION_PLAN.md` / `docs/plans/`.
2. Dispatch implementer subagent (TDD) → run tests, lint, typecheck.
3. Independent reviewer subagent (spec compliance + Ponytail quality). Fix important findings.
4. Commit (conventional commits, `feat(scope): ...`), push to `origin`, update `docs/TASKS.json`
   (status, commit), `docs/PROGRESS.md`, `docs/HANDOFF.md`, and `docs/REVIEW_LOG.md`.
5. Never commit secrets, `.env`, or OAuth credentials. No force-push to `main`.

## Docs index

`docs/PRODUCT_SPEC.md` (requirements + Instantly parity checklist) · `docs/IMPLEMENTATION_PLAN.md` (approved plan) ·
`docs/plans/` (per-phase step plans) · `docs/TASKS.json` · `docs/PROGRESS.md` · `docs/HANDOFF.md` ·
`docs/DECISIONS.md` · `docs/REVIEW_LOG.md` · `docs/RESUME_INSTRUCTIONS.md`
