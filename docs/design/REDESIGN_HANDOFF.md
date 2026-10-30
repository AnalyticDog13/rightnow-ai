# UI redesign: handoff (read this on "keep going")

Branch `ui-redesign` (pushed). `main` is untouched; fast-forward it only after the full redesign passes lint,
typecheck, unit tests and e2e.

User rules for this effort:
- Superpowers, Ponytail and frontend-design are turned OFF (disabled in `~/.claude/settings.json`). Do not invoke
  them. Re-enable only when the user asks.
- The design comes from `docs/design/DESIGN_SPEC.md` (Part B is authoritative), not intuition.
- The brand is always lowercase `rightnow` in visible text (header names `X-RightNow-*` stay as-is).
- Commit and push as you go. Orchestrator = Opus; builders = Opus agents; run in parallel on disjoint files.
- After a reviewer/agent finishes with a browser tab, close it.

## Done
1. Research shortlist: `docs/design/SHORTLIST.md`.
2. 15 reference specs (Chrome screenshots, local only): `docs/design/references/*.md`.
3. Synthesis: `docs/design/DESIGN_SPEC.md` ("Signal Desk"), plus B5.18 guided onboarding wizard (user feedback:
   the old one-page owner form with an unexplained setup token felt random and overwhelming).
4. Foundation build (B7.3 steps 1-4): tokens + IBM Plex fonts, primitives, app shell (sidebar + mobile drawer + send
   meter), table kit + Email Accounts reference screen. Commits bd959f9, 7d27ba4, d4766a8, b429d7a, ceb8c46.
5. Brand lowercase sweep in core/docs: 38314c1.

## In progress when paused (2026-10-30)
- Onboarding wizard (B5.18): see "Pause status" below for what was committed vs. left in the working tree.
- Foundation agent was running its final e2e verification.

## Next steps
1. Reconcile uncommitted changes (`git status`); finish/verify the onboarding wizard (auth e2e spec updated,
   `/api/setup/verify-token` test), commit.
2. Screens (B7.3 step 5) with two Opus builders in parallel on disjoint files:
   - A: Dashboard (+ setup checklist B4.15), Deliverability (+ placement), Campaigns list, Campaign detail
     (+ sequence editor), Scheduled.
   - B: Leads (+ import, drawer), Lead lists, Blocklist, Inbox, CRM, Analytics (+ charts), Automations (+ webhooks),
     Settings (+ API keys), Link check, remaining auth pages (sign-in, 2FA, invite).
   Brief each with: spec sections, the component APIs from the foundation (read `components/`), B7.4 test-safety
   rules, verify at 1440x900 and 390x844 light+dark via Chrome DevTools (own tab, pass pageId, close it), commit by
   explicit path, push.
3. B7.3 step 6 cleanup (remove compatibility aliases, leftover raw palette classes), step 7 acceptance checklist
   (B7.5) on every route; independent review agent (sonnet) of the whole diff.
4. Full `npm run lint`, `npm run typecheck`, `npm test`, `npm run e2e` (Windows: `E2E_PROD=1` after `next build`;
   delete `apps/web/.next` after). Check CI. Then fast-forward `main` and push.
5. Kill leftover embedded Postgres / node processes at the end.

## Pause status
(filled in below by the orchestrator from the builders' reports)

**Foundation agent (stopped cleanly):** B7.3 steps 1-4 committed and pushed. Lint + typecheck pass.
- Last full unit run had 3 failures in 2 files (output truncated; other agents' uncommitted changes were in the
  tree). Re-run `npm test` and fix first thing.
- e2e NOT yet run (unconfirmed: CSP with next/font).
- Known: `/dashboard` overflows to 430px at 390 width (account strip), left for the screens pass.
- Spec deviations: connect buttons stay inline (e2e clicks "Connect Google"); row-action labels collapse to icons
  below 1536px; warm-up chart shows inbox/spam/not-found (no "planned" data exists).
- `apps/.web-onb/` (onboarding agent's temp copy) breaks vitest ("project name not unique"): delete it before
  testing; never commit it. Also a stray root `onboarding-wizard.tsx`.
