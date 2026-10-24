# RightNow AI public API (v1)

Base path `/api/v1`. The machine-readable description is [`docs/openapi.json`](openapi.json), generated from the route
definitions (`npm run openapi`) and served without authentication at `GET /api/v1/openapi.json`. Responses are
documented as plain `200 application/json` (no response schemas yet). The route table at the end is generated from it;
when they differ, `openapi.json` wins.

## Authentication

- **Session cookie** (the web app). State-changing requests must come from the app's own origin (CSRF check).
- **API key**: `Authorization: Bearer rn_<prefix>_<secret>`. Create keys in Settings and pick scopes; the token is shown once.
- **API keys act as MEMBER, and ADMIN routes are session-only.** Every route that needs ADMIN rejects an API key with
  401: connecting, disconnecting, deleting and testing mailboxes, clearing or deleting blocklist entries, placement
  tests, releasing held sends, pipeline stages, API keys, the verifier and workspace settings. They are marked
  "session only" in the table at the end.
- **Scopes** are `<resource>:read` and `<resource>:write` (plus `all:all`). `<resource>:write` covers `create`,
  `update` and `delete`; a route may name the finer scope (`leads:create`) and a `:write` key satisfies it.
  Resources: `leads`, `blocklist`, `campaigns`, `accounts`, `inbox`, `analytics`, `crm`, `automations`, `webhooks`,
  `jobs`, `audit`, `workspace`. A key without the route's scope gets 403. The scope of every route is in the table at
  the end.
- Creating or editing an automation rule or webhook with a key also needs the scopes of what it does (for example a
  `suppress_contact` action needs `blocklist:write`; a webhook for reply events needs `inbox:read`): 403
  `scope_required:<scope>`.

## Errors

Every error is JSON `{ "error": "<message or code>" }`.

| Status | Meaning |
|---|---|
| 400 | Invalid request. A body or query that fails validation returns `{ "error": "Invalid request", "issues": [...] }`; each issue has `path` and `message`, and the machine-readable reason is in `issues[].message` (for example `invalid_header`). Bodies are strict: an unknown key is a 400. A non-JSON body gives `{ "error": "Body must be valid JSON" }`. |
| 401 | No valid session or API key. |
| 403 | Role too low, key lacks the scope, or a cross-origin cookie request. |
| 404 | Not found, or it belongs to another workspace. |
| 409 | Conflict (for example `name_taken`). |
| 412 | Not configured (for example an OAuth provider without credentials). |
| 413 | Payload too large. |
| 429 | Rate limited (see below). |

## Pagination

List endpoints that page return `{ "<items>": [...], "nextCursor": "<id>" | null }` (the items key is named after the
resource, for example `jobs`, `logs`, `deliveries`). Pass the value back as `?cursor=<id>`; `null` means the last page.
`take` or `limit` bounds the page (maximum 100). Treat every cursor as opaque (inbox threads use a
`lastMessageAt|id` string).

## Background jobs (202)

Long operations answer `202 { "jobId": "<id>" }` instead of blocking: `POST /leads/bulk` with a `filter`, imports
(`POST /imports`, which has its own status resource) and, as they ship, AI personalization and placement runs. Poll
`GET /jobs/{id}` (scope `jobs:read`) until `status` is `DONE` or `FAILED`:

```json
{ "id": "...", "kind": "leads_bulk", "status": "RUNNING", "progress": 40, "result": null, "error": null }
```

`status` is `PENDING`, `RUNNING`, `DONE` or `FAILED`. `result` holds the outcome and `error` a short code. One job runs
per workspace at a time; a job that makes no progress for 5 minutes is requeued, and after three requeues it ends
`FAILED`. `GET /jobs` lists them.

## Rate limits

Filled in with the rate-limit work (P7-T07a). A limited request gets 429.

## Webhooks

Create webhooks with `POST /webhooks` (scope `webhooks:write`). The signing secret (`whsec_...`) is returned once, on
create and on `rotate-secret`; rotation takes effect immediately with no overlap.

Delivery is at-least-once and unordered, with 8 attempts over about 24 hours; 20 consecutive failures disable the
webhook (`resume` re-enables it). Event names: `email_sent`, `email_opened`, `email_link_clicked`, `reply_received`,
`auto_reply_received`, `email_bounced`, `lead_unsubscribed`, `account_error`, `campaign_completed`, `deal_won`,
`deal_lost`, `quota_reached`, the interest events `lead_neutral`, `lead_out_of_office`, `lead_interested`,
`lead_meeting_booked`, `lead_meeting_completed`, `lead_closed`, `lead_not_interested`, `lead_wrong_person`,
`lead_lost`, `lead_no_show`, a lead label's name, or `all_events`.

Payload: `event_id, timestamp, event_type, workspace, campaign_id, campaign_name`, and when relevant `lead_email,
email_account, unibox_url, step, variant, is_first, email_id, email_subject, email_text, email_html,
reply_text_snippet, reply_subject, reply_text, reply_html` plus the lead's fields in snake_case and custom fields.
Unsubscribe links in stored mail bodies are replaced with `[unsubscribe link]`.

### Verifying a delivery

Each request carries:

- `X-RightNow-Event-Id`: the event id (stable across retries).
- `X-RightNow-Timestamp`: unix seconds of this attempt.
- `X-RightNow-Signature: t=<unix s>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "<t>." + rawBody)`.

Replay protection: compute the HMAC over `t.<raw body>` (the exact bytes received, before JSON parsing), compare in
constant time, **reject a timestamp more than 300 seconds from your clock**, and **dedupe on `X-RightNow-Event-Id`**,
because a delivery can arrive more than once. The timestamp is refreshed on every attempt, so a late retry still
passes the 300 s check.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(rawBody, header, secret, seenEventIds, eventId) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const want = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const got = Buffer.from(v1, "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  if (seenEventIds.has(eventId)) return false;
  seenEventIds.add(eventId);
  return true;
}
```

Answer with any 2xx within 10 seconds; redirects are not followed.

## Instantly v2 to RightNow v1 (approximate)

| Instantly v2 | RightNow v1 |
|---|---|
| `/accounts` | `/accounts`, `/accounts/{id}` (+ `pause`, `resume`, `warmup`) |
| `/campaigns`, `/campaigns/{id}/activate`, `/pause` | `/campaigns`, `/campaigns/{id}/launch`, `/pause`, `/resume` |
| `/leads` | `/leads`, `/leads/{id}`, `/leads/bulk` |
| `/lead-lists` | `/lead-lists`, `/lead-lists/{id}/leads` |
| `/emails`, `/emails/reply` | `/inbox/threads`, `/inbox/threads/{id}/reply` |
| `/lead-labels` | `/lead-labels` |
| `/block-lists-entries` | `/blocklist` |
| `/campaigns/analytics` | `/analytics`, `/analytics/accounts`, `/analytics/bounces` |
| `/webhooks`, `/webhook-events` | `/webhooks`, `/webhooks/{id}/deliveries` |
| `/api-keys` | `/api-keys` |
| `/background-jobs/{id}` | `/jobs/{id}` |

## Out of scope

An official SDK, a CLI and an MCP server are not provided (PS-AUTO-14); generate a client from `openapi.json`.

## Routes, roles and scopes

"session only" routes reject API keys. The role is the minimum for that method; keys count as MEMBER.

<!-- routes:start -->
| Method | Path | Role | Scope |
|---|---|---|---|
| GET | `/accounts` | VIEWER | `accounts:read` |
| POST | `/accounts` | ADMIN | session only |
| GET | `/accounts/{id}` | VIEWER | `accounts:read` |
| PATCH | `/accounts/{id}` | MEMBER | `accounts:update` |
| DELETE | `/accounts/{id}` | ADMIN | session only |
| GET | `/accounts/{id}/campaigns` | VIEWER | `campaigns:read` |
| POST | `/accounts/{id}/credentials` | ADMIN | session only |
| POST | `/accounts/{id}/diagnostics` | MEMBER | `accounts:update` |
| POST | `/accounts/{id}/disconnect` | ADMIN | session only |
| POST | `/accounts/{id}/mark-fixed` | MEMBER | `accounts:update` |
| POST | `/accounts/{id}/pause` | MEMBER | `accounts:update` |
| POST | `/accounts/{id}/resume` | MEMBER | `accounts:update` |
| POST | `/accounts/{id}/resume-full` | MEMBER | `accounts:update` |
| POST | `/accounts/{id}/rewarm` | MEMBER | `accounts:update` |
| DELETE | `/accounts/{id}/rewarm` | MEMBER | `accounts:update` |
| POST | `/accounts/{id}/test-send` | ADMIN | session only |
| GET | `/accounts/{id}/warmup` | VIEWER | `accounts:read` |
| PATCH | `/accounts/{id}/warmup` | MEMBER | `accounts:update` |
| GET | `/accounts/{id}/warmup/stats` | VIEWER | `accounts:read` |
| POST | `/accounts/bulk` | MEMBER | `accounts:update` |
| POST | `/accounts/test-connection` | ADMIN | session only |
| GET | `/ai/suggestions` | VIEWER | `ai:read` |
| PATCH | `/ai/suggestions/{id}` | MEMBER | `ai:write` |
| GET | `/analytics` | VIEWER | `analytics:read` |
| GET | `/analytics/accounts` | VIEWER | `analytics:read` |
| GET | `/analytics/activity` | VIEWER | `analytics:read` |
| GET | `/analytics/bounces` | VIEWER | `analytics:read` |
| GET | `/analytics/crm` | VIEWER | `analytics:read` |
| GET | `/api-keys` | ADMIN | session only |
| POST | `/api-keys` | ADMIN | session only |
| DELETE | `/api-keys/{id}` | ADMIN | session only |
| GET | `/audit-logs` | MEMBER | `audit:read` |
| GET | `/automations/builtin` | VIEWER | `automations:read` |
| PATCH | `/automations/builtin/{key}` | ADMIN | session only |
| GET | `/automations/rules` | VIEWER | `automations:read` |
| POST | `/automations/rules` | MEMBER | `automations:create` |
| GET | `/automations/rules/{id}` | VIEWER | `automations:read` |
| PATCH | `/automations/rules/{id}` | MEMBER | `automations:update` |
| DELETE | `/automations/rules/{id}` | MEMBER | `automations:delete` |
| GET | `/automations/rules/{id}/runs` | VIEWER | `automations:read` |
| GET | `/blocklist` | VIEWER | `blocklist:read` |
| POST | `/blocklist` | MEMBER | `blocklist:create` |
| DELETE | `/blocklist/{id}` | ADMIN | session only |
| POST | `/blocklist/bulk-delete` | ADMIN | session only |
| POST | `/blocklist/clear` | ADMIN | session only |
| GET | `/blocklist/export` | VIEWER | `blocklist:read` |
| POST | `/blocklist/import` | MEMBER | `blocklist:create` |
| GET | `/campaigns` | VIEWER | `campaigns:read` |
| POST | `/campaigns` | MEMBER | `campaigns:create` |
| GET | `/campaigns/{id}` | VIEWER | `campaigns:read` |
| PATCH | `/campaigns/{id}` | MEMBER | `campaigns:update` |
| DELETE | `/campaigns/{id}` | MEMBER | `campaigns:delete` |
| PUT | `/campaigns/{id}/accounts` | MEMBER | `campaigns:update` |
| POST | `/campaigns/{id}/archive` | MEMBER | `campaigns:update` |
| POST | `/campaigns/{id}/duplicate` | MEMBER | `campaigns:create` |
| GET | `/campaigns/{id}/export` | VIEWER | `campaigns:read` |
| POST | `/campaigns/{id}/launch` | MEMBER | `campaigns:update` |
| GET | `/campaigns/{id}/leads` | VIEWER | `campaigns:read` |
| POST | `/campaigns/{id}/leads` | MEMBER | `campaigns:update` |
| POST | `/campaigns/{id}/leads/{clId}` | MEMBER | `campaigns:update` |
| POST | `/campaigns/{id}/pause` | MEMBER | `campaigns:update` |
| POST | `/campaigns/{id}/preview` | VIEWER | `campaigns:read` |
| POST | `/campaigns/{id}/resume` | MEMBER | `campaigns:update` |
| PUT | `/campaigns/{id}/schedules` | MEMBER | `campaigns:update` |
| GET | `/campaigns/{id}/status` | VIEWER | `campaigns:read` |
| GET | `/campaigns/{id}/steps` | VIEWER | `campaigns:read` |
| POST | `/campaigns/{id}/steps` | MEMBER | `campaigns:update` |
| PATCH | `/campaigns/{id}/steps/{stepId}` | MEMBER | `campaigns:update` |
| DELETE | `/campaigns/{id}/steps/{stepId}` | MEMBER | `campaigns:update` |
| POST | `/campaigns/{id}/steps/{stepId}/variants` | MEMBER | `campaigns:update` |
| PATCH | `/campaigns/{id}/steps/{stepId}/variants/{variantId}` | MEMBER | `campaigns:update` |
| DELETE | `/campaigns/{id}/steps/{stepId}/variants/{variantId}` | MEMBER | `campaigns:update` |
| PUT | `/campaigns/{id}/steps/reorder` | MEMBER | `campaigns:update` |
| POST | `/campaigns/{id}/subsequences` | MEMBER | `campaigns:update` |
| PATCH | `/campaigns/{id}/subsequences/{subId}` | MEMBER | `campaigns:update` |
| POST | `/campaigns/{id}/test-send` | ADMIN | session only |
| POST | `/campaigns/import` | MEMBER | `campaigns:create` |
| GET | `/crm/activity` | VIEWER | `crm:read` |
| GET | `/crm/opportunities` | VIEWER | `crm:read` |
| POST | `/crm/opportunities` | MEMBER | `crm:create` |
| GET | `/crm/opportunities/{id}` | VIEWER | `crm:read` |
| PATCH | `/crm/opportunities/{id}` | MEMBER | `crm:update` |
| DELETE | `/crm/opportunities/{id}` | MEMBER | `crm:delete` |
| GET | `/crm/stages` | VIEWER | `crm:read` |
| POST | `/crm/stages` | ADMIN | session only |
| PATCH | `/crm/stages/{id}` | ADMIN | session only |
| DELETE | `/crm/stages/{id}` | ADMIN | session only |
| GET | `/crm/tasks` | VIEWER | `crm:read` |
| POST | `/crm/tasks` | MEMBER | `crm:create` |
| PATCH | `/crm/tasks/{id}` | MEMBER | `crm:update` |
| DELETE | `/crm/tasks/{id}` | MEMBER | `crm:delete` |
| GET | `/dashboard` | VIEWER | `analytics:read` |
| GET | `/deliverability` | VIEWER | `accounts:read` |
| GET | `/domains` | VIEWER | `accounts:read` |
| PATCH | `/domains/{domain}` | MEMBER | `accounts:update` |
| POST | `/domains/{domain}/check` | MEMBER | `accounts:update` |
| POST | `/imports` | MEMBER | `leads:create` |
| GET | `/imports/{id}` | VIEWER | `leads:read` |
| POST | `/imports/preview` | MEMBER | `leads:create` |
| GET | `/inbox/attachments/{id}` | VIEWER | `inbox:read` |
| GET | `/inbox/macros` | VIEWER | `inbox:read` |
| POST | `/inbox/macros` | MEMBER | `inbox:write` |
| PATCH | `/inbox/macros/{id}` | MEMBER | `inbox:write` |
| DELETE | `/inbox/macros/{id}` | MEMBER | `inbox:write` |
| POST | `/inbox/macros/{id}/render` | VIEWER | `inbox:read` |
| POST | `/inbox/messages/{id}/ai-feedback` | MEMBER | `inbox:write` |
| GET | `/inbox/notes` | VIEWER | `inbox:read` |
| POST | `/inbox/notes` | MEMBER | `inbox:write` |
| PATCH | `/inbox/notes/{id}` | MEMBER | `inbox:write` |
| DELETE | `/inbox/notes/{id}` | MEMBER | `inbox:write` |
| GET | `/inbox/threads` | VIEWER | `inbox:read` |
| GET | `/inbox/threads/{id}` | VIEWER | `inbox:read` |
| PATCH | `/inbox/threads/{id}` | MEMBER | `inbox:write` |
| DELETE | `/inbox/threads/{id}` | MEMBER | `inbox:write` |
| POST | `/inbox/threads/{id}/attach-lead` | MEMBER | `inbox:write` |
| POST | `/inbox/threads/{id}/read-all` | MEMBER | `inbox:write` |
| POST | `/inbox/threads/{id}/reply` | MEMBER | `inbox:write` |
| POST | `/inbox/threads/bulk` | MEMBER | `inbox:write` |
| GET | `/inbox/unread-count` | VIEWER | `inbox:read` |
| GET | `/inbox/views` | VIEWER | `inbox:read` |
| POST | `/inbox/views` | MEMBER | `inbox:write` |
| PATCH | `/inbox/views/{id}` | MEMBER | `inbox:write` |
| DELETE | `/inbox/views/{id}` | MEMBER | `inbox:write` |
| GET | `/jobs` | VIEWER | `jobs:read` |
| GET | `/jobs/{id}` | VIEWER | `jobs:read` |
| GET | `/lead-labels` | VIEWER | `leads:read` |
| POST | `/lead-labels` | MEMBER | `leads:create` |
| PATCH | `/lead-labels/{id}` | MEMBER | `leads:update` |
| DELETE | `/lead-labels/{id}` | MEMBER | `leads:delete` |
| GET | `/lead-lists` | VIEWER | `leads:read` |
| POST | `/lead-lists` | MEMBER | `leads:create` |
| PATCH | `/lead-lists/{id}` | MEMBER | `leads:update` |
| DELETE | `/lead-lists/{id}` | MEMBER | `leads:delete` |
| POST | `/lead-lists/{id}/leads` | MEMBER | `leads:update` |
| DELETE | `/lead-lists/{id}/leads` | MEMBER | `leads:update` |
| POST | `/lead-lists/{id}/move` | MEMBER | `leads:update` |
| GET | `/lead-lists/{id}/stats` | VIEWER | `leads:read` |
| GET | `/leads` | VIEWER | `leads:read` |
| POST | `/leads` | MEMBER | `leads:create` |
| GET | `/leads/{id}` | VIEWER | `leads:read` |
| PATCH | `/leads/{id}` | MEMBER | `leads:update` |
| DELETE | `/leads/{id}` | MEMBER | `leads:delete` |
| GET | `/leads/{id}/export` | MEMBER | `leads:read` |
| POST | `/leads/{id}/gdpr-delete` | ADMIN | session only |
| GET | `/leads/{id}/timeline` | VIEWER | `leads:read` |
| POST | `/leads/bulk` | MEMBER | `leads:update` |
| GET | `/leads/export` | VIEWER | `leads:read` |
| POST | `/leads/merge` | MEMBER | `leads:update` |
| POST | `/leads/verify` | MEMBER | `leads:update` |
| GET | `/members` | VIEWER | `workspace:read` |
| GET | `/oauth/{provider}/callback` | ADMIN | session only |
| POST | `/oauth/{provider}/start` | ADMIN | session only |
| GET | `/oauth/sessions/{id}` | VIEWER | session only |
| DELETE | `/oauth/sessions/{id}` | ADMIN | session only |
| GET | `/openapi.json` | VIEWER | public |
| GET | `/placement-tests` | VIEWER | `accounts:read` |
| POST | `/placement-tests` | ADMIN | session only |
| GET | `/placement-tests/{id}` | VIEWER | `accounts:read` |
| GET | `/scheduled-messages` | VIEWER | `campaigns:read` |
| POST | `/scheduled-messages/{id}/cancel` | MEMBER | `campaigns:update` |
| POST | `/scheduled-messages/{id}/release` | ADMIN | session only |
| POST | `/scheduled-messages/{id}/retry` | MEMBER | `campaigns:update` |
| GET | `/settings/ai` | ADMIN | session only |
| PUT | `/settings/ai` | ADMIN | session only |
| GET | `/settings/verifier` | ADMIN | session only |
| PUT | `/settings/verifier` | ADMIN | session only |
| GET | `/settings/workspace` | ADMIN | session only |
| PATCH | `/settings/workspace` | ADMIN | session only |
| GET | `/tags` | VIEWER | `workspace:read` |
| GET | `/webhooks` | VIEWER | `webhooks:read` |
| POST | `/webhooks` | MEMBER | `webhooks:write` |
| GET | `/webhooks/{id}` | VIEWER | `webhooks:read` |
| PATCH | `/webhooks/{id}` | MEMBER | `webhooks:write` |
| DELETE | `/webhooks/{id}` | MEMBER | `webhooks:write` |
| GET | `/webhooks/{id}/deliveries` | VIEWER | `webhooks:read` |
| POST | `/webhooks/{id}/resume` | MEMBER | `webhooks:write` |
| POST | `/webhooks/{id}/rotate-secret` | MEMBER | `webhooks:write` |
| POST | `/webhooks/{id}/test` | MEMBER | `webhooks:write` |
| POST | `/webhooks/deliveries/{id}/redeliver` | MEMBER | `webhooks:write` |
| GET | `/webhooks/overview` | VIEWER | `webhooks:read` |
<!-- routes:end -->
