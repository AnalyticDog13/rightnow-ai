# Screenshots

Real rightnow-ai screens with seeded sample data (fictional `.example` addresses). Only resized WebPs ship
(quality 80): desktop shots at 1600 and 800 px wide, phone shots at 780 and 390 px wide. The 2x PNG originals and
full-size WebPs live outside the site in `docs/design/site/screens-src/`.

Regenerate (from the repo root, with `sharp` installed by `npm ci`): for each `<name>.png`, desktop gets
`sharp(png).resize({ width: 1600 | 800 }).webp({ quality: 80 })`, phone shots (780 wide) get 780 and 390.

| Key (SITE_SPEC B3) | File | Used in | Caption (visible) | Alt |
|---|---|---|---|---|
| dashboard | `dashboard-light-*` (+ `dashboard-dark-*`) | Hero, desktop | Sample data. The dashboard of a running install. | rightnow-ai dashboard showing today's sends against the daily allowance, replies and campaign status (sample data) |
| dashboard-mobile | `dashboard-mobile-light-*` | Hero, below 768px | (same caption) | rightnow-ai dashboard showing today's sends... (sample data) (the `<picture>` shares one alt) |
| accounts | `accounts-list-light-*` | Step 01 | Gmail, Microsoft 365 and IMAP/SMTP mailboxes side by side. | Email accounts page listing connected mailboxes with status and daily capacity (sample data) |
| deliverability | `deliverability-overview-light-*` | Step 02 | The Deliverability page tells you which DNS record to fix. | Deliverability page with SPF, DKIM, DMARC, MX and blacklist checks per domain (sample data) |
| warmup | `account-drawer-warmup-light-*` | Step 03, warm-up section | Warm-up volume, inbox rate and health per mailbox. | Warm-up settings for one mailbox with a chart of where warm-up mail landed over 30 days (sample data) |
| leads | `leads-list-light-*` | Step 04, tab "Leads" | Leads with lists, tags and custom fields. | Leads table with names, companies, lists and status (sample data) |
| csv-import | `leads-import-mapping-light-*` | Step 04, tab "CSV import" | Map CSV columns; duplicates are removed. | CSV import wizard mapping columns to lead fields (sample data) |
| sequence | `campaign-sequence-light-*` (+ `campaign-sequence-dark-*`) | Step 05, tab "Sequence" | Steps, delays, merge fields and A/B variants. | Campaign sequence editor with step 1 and its A/B variants (sample data) |
| schedule | `campaign-schedule-light-*` | Step 05, tab "Schedule" | Sending days, hours and time zone per campaign. | Campaign schedule with sending days, hours and time zone (sample data) |
| inbox | `inbox-thread-light-*` (1600x1511, shown cropped from the top) | Step 06, tab "Inbox" | Every mailbox in one threaded inbox. | Unified inbox with a reply labelled Interested (sample data) |
| crm | `crm-kanban-light-*` | Step 06, tab "CRM" | Deals on a Kanban board, revenue tied to the campaign. | CRM Kanban board with deals in pipeline stages (sample data) |
| analytics | `analytics-charts-light-*` | Step 06, tab "Analytics" | Sends, replies, bounces and revenue by campaign, step and mailbox. | Analytics page with sends, replies and bounces over time (sample data) |
| automations | `automations-rules-light-*` | Step 06, tab "Automations" | Rules like "when a lead replies interested, move it to this stage". | Automations page listing event rules (sample data) |
| api-keys | `settings-api-keys-light-*` | Deploy section | Once it runs, everything in the app is also available over a REST API with scoped keys. | API keys settings page with scopes per key (sample data) |
| inbox-mobile | `inbox-mobile-thread-light-*` | Inbox demo, at 1280px and wider | Replies from your phone. (screen-reader caption) | rightnow-ai inbox on a phone (sample data) |

Captured but not used on the page (originals kept in `screens-src/`): `analytics-overview`, `automations-editor`,
`campaign-leads`, `campaign-options`, `deliverability-placement`, `settings-workspace`, `inbox-mobile-list`.
