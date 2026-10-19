# Architecture decisions

Format: date · decision · why · consequences.

## 2026-10-19 · D1 · PostgreSQL-only job queue (pg-boss + row claiming), no Redis/BullMQ

Spec allows "Redis and BullMQ or an equivalent reliable architecture".
- The send queue must live in Postgres anyway (scheduled messages are shown in the UI and must survive
  restarts). Claiming a due row and reserving quota in one transaction makes double-send and
  over-quota impossible across parallel workers; a second store (Redis) could diverge after downtime.
- One fewer stateful service to run, secure, back up and restore on the VPS and the laptop.
- pg-boss gives cron, retries with exponential backoff, singleton jobs, and dead-letter on Postgres.
Consequence: throughput ceiling is far above cold-email volumes (thousands/day per workspace).

## 2026-10-19 · D2 · npm workspaces; Next.js route handlers are the backend API

pnpm is not installed on the dev machine; npm workspaces are built in. A separate API server would duplicate
auth and validation; route handlers under `apps/web/app/api` with a shared service layer are enough.
Long-running work never runs in the web process; it lives in `apps/worker`.

## 2026-10-19 · D3 · Tests run against real Postgres via `embedded-postgres`

The primary dev machine has no Docker and no WSL. `embedded-postgres` downloads real Postgres binaries
per platform, so tests exercise real SQL (SKIP LOCKED, constraints) everywhere. CI additionally builds
and smoke-tests the Docker Compose stack.
