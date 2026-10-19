# Review log

Newest last. Each entry: date · subject · reviewer (agent/model) · verdict · findings · resolution.

## 2026-10-19 · Plan review round 1 · independent agent (opus, fresh context) · **Changes Required**
Critical: C1 startup gate misses sleep/wake (→ freshness gate in claim SQL); C2 per-account readiness misses
cross-mailbox replies (→ sticky sender, company-stop freshness, re-route step 1 only); C3 UNCERTAIN "not found" resent
(→ re-search after 15 min then HELD; Graph draft+send); C4 quota reservation day/leak (→ stored usage days, upsert
reservation in savepoints, campaign usage rows). Important: ambiguous-error classification, claimToken leases,
re-plan by revive, re-warm before first send, compliance (unsubscribe, physical address) moved into P3, ~40 parity
fields/features added, injected clock, E2E mapping, SETUP_TOKEN + roles + API scopes, rfcMessageId dedupe, attachments
in Postgres, 50 % provider-cap clamp, task splits + Opus for dispatcher/sender. Minor items applied (Cc/Bcc counted,
bounce threshold 3 %, Redis mentions superseded, postgres 18, suppression hash, push auth, phase branches).
Resolution: plan rev 2 + phase-1 rev 2.
