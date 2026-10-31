# rightnow-ai site spec (launch / project page)

Status: final, for the builder. The builder implements `site/` from this file alone.
Inputs: the 16 reference specs in `docs/design/site/references/*.md` (appflowy is the primary inspiration;
shortlist: `docs/design/site/SHORTLIST.md`), the product truth (`README.md`, `docs/PRODUCT_SPEC.md`,
`docs/ops/LOCAL.md`, `docs/ops/VPS.md`, `docs/ops/GOOGLE_SETUP.md`, `docs/ops/MICROSOFT_SETUP.md`,
`docs/COMPLIANCE.md`, `.env.example`, `docker-compose.yml`, `scripts/start.sh`), the code (cited inline), and the
in-app design system `docs/design/DESIGN_SPEC.md` (tokens, type) plus the logo `apps/web/public/rightnow-logo.svg`.

How to read it: Part A is the synthesis (what makes a good landing page and a good landing-page spec). Part B is the
rightnow-ai site: concept, copy, sections, tokens, components, the four signature interactive pieces, SEO,
accessibility, performance, files and the acceptance checklist. Borrowed patterns carry "(from: X §n)", where X is
the reference file name and §n its section. Values in Part B are decisions, not options. Numbers taken from the code
cite the file.

---

# Part A. What makes a good landing page (and a good landing-page spec)

## A1. Patterns that recur on the best pages

1. **The hero names the job in plain words.** The strongest heroes say what the product does and for whom
   (plausible's keyword-exact H1, coolify's "open-source and self-hostable alternative to Vercel, Heroku...",
   supabase's "Start your project with a Postgres database"). The weakest hide it behind a slogan (instantly §12
   "Find Clients", superhuman §12, attio "agentic revenue", twenty "Enterprise CRM at AI Speed").
2. **Real product UI is the illustration.** Every page we rated highly shows the actual product, either as a real
   screenshot (plausible §4, twenty §4) or as crisp HTML recreations of real components (attio §4, calcom §4,
   appflowy §4). Skeleton wireframes and stock art show nothing (firecrawl §12, lemlist §12).
3. **Every visual is captioned by one sentence.** Attio's bold-then-grey statement over each stage (attio §4),
   supabase's black-then-grey card sentences (supabase §12.3), resend's dimmed second half of H2s (resend §12.2).
   The reader gets the point without decoding the UI.
4. **One page tells the workflow in order.** Funnel-ordered sections (lemlist §12.1: find, engage, protect),
   numbered steps (calcom §12.3), sticky rails with five jobs (attio §5, n8n §5). Order beats a feature list.
5. **Something to play with, driven by the reader's own input.** AppFlowy's savings calculator (appflowy §5) and
   firecrawl's hero input (firecrawl §12.1) are the most memorable elements on their pages because the reader
   changes a number and something real answers.
6. **For self-hostable products, the install path is visible and short.** AppFlowy's dark "own your stack" band with
   real `helm` commands (appflowy §6), n8n's "Don't want to read the docs? Run this:" (n8n §6), chatwoot's README
   card (chatwoot §12.1), coolify's requirements table (coolify §6). Engineers judge effort from the commands.
7. **Candour builds more trust than badges.** Plausible's "Self-hosting is a real commitment" and its list of
   missing features (plausible §6), firecrawl's "You will own upgrades, security, storage, monitoring, and
   recovery" (firecrawl §6), posthog's "officially unsupported" self-host disclaimer (posthog §6).
8. **One visual rule, applied everywhere.** Instantly's black pill CTA after every section (instantly §12.1), cal.com's
   borders-not-shadows (calcom §12.4), twenty's notched buttons (twenty §3), firecrawl's mono bracket labels
   (firecrawl §12.4). A single repeated device makes a page feel designed.
9. **A typographic texture that is cheap and ownable.** Blueprint hairlines with "+" marks (lemlist §12.5,
   calcom §2, dub §3), dotted grids (n8n §3), halftone (twenty §3), ASCII art (firecrawl §3). All CSS or SVG, no
   photography.
10. **SEO is structural, not bolted on.** One H1 with the head term, an H2 per section, FAQPage JSON-LD answering the
    money question (twenty §10, lemlist §12.4), and competitor or "alternative" pages linked from the footer
    (appflowy §8, plausible §10, dub §12.3, coolify §12.4).

## A2. Each reference's best-executed idea

| Product | Best-executed idea | Where | How rightnow-ai uses it |
|---|---|---|---|
| appflowy (primary) | Dark "own your stack" band: selectable mono cards beside a terminal with real deploy commands; plus a play-with-it savings calculator | appflowy §2.7, §2.9, §12.2, §12.5 | Self-host band with a step-through terminal (B6.9) and the send-capacity planner (B6.7) |
| attio | Sticky left rail of five jobs, each panel captioned by a bold-then-grey sentence | attio §2.5, §12.1-3 | "How it works" rail of six steps with two-tone captions (B6.3) |
| firecrawl | Try-it input in the hero; honest "you will own upgrades, security..." self-host framing; mono bracket labels | firecrawl §12.1, §12.3, §12.4 | Copyable command box in the hero, "What you own" list, `[ 01 / 06 ]` step counters |
| superhuman | Tabbed product panels with a pause button on every loop | superhuman §12.1, §12.5 | Pause control on the inbox demo and simulator (B9) |
| instantly | One CTA style repeated with a one-sentence intro | instantly §12.1 | Ink "View on GitHub" button is the only filled CTA, repeated four times |
| twenty | Requirements first and an explicit `ENCRYPTION_KEY` loss warning in the self-host guide; FAQ answering "What does it cost?" | twenty §6, §12.2, §12.6 | Key warning callout in the setup section, FAQ question 1 |
| calcom | Pill label above every H2; numbered three-step cards with mini UI | calcom §12.2, §12.3 | Mono eyebrow label above every H2 (B7.2) |
| plausible | Keyword-exact H1, competitor pages, candid limits on the self-host page | plausible §10, §12.1, §12.3 | Title/H1 keywords, `/instantly-alternative/` with a "what you give up" list |
| posthog | Honest, funny microcopy carrying trust ("97% of users pay us $0") | posthog §12.2 | "$0. You pay for your server and your mailboxes, nothing else." |
| n8n | "Don't want to read the docs? Run this:" plus a one-line requirement sentence | n8n §6, §12.4 | Hero command box caption |
| dub | Footer "Compare" column; product switcher tinting one frame | dub §12.3, §12.1 | Footer Compare column |
| resend | 3x3 grid of deliverability terms, each with a one-line gloss | resend §12.3 | "Built not to burn your domain" grid (B6.6) |
| coolify | Diagram with dots travelling along connectors; requirements "Section / Check" table | coolify §12.3, §12.2 | Send-pipeline diagram in the reliability band (B6.6), requirements table (B6.9) |
| chatwoot | Self-host band with a README-style terminal card, GitHub button and a fact strip; deployment-option cards with "Best for / Maintenance" | chatwoot §12.1, §12.2 | Laptop vs VPS cards (B6.9) |
| supabase | GitHub star count pill in the nav; "Read, contribute, self-host" block copy | supabase §12.1, §12.5 | Live star pill (B7.4), labelled and hidden on failure |
| lemlist | Multi-step campaign shown as a real flow (If / Wait / Channel) | lemlist §12.2 | Sequence simulator timeline (B6.4) |

## A3. What the strongest reference specs did well as documents

- **Verbatim copy and measured values.** attio, firecrawl and plausible quote H1s and copy exactly and give
  computed sizes ("H1 64px / 60.8px / 600 / -1.28px", attio §3). A builder can use that directly. This spec writes
  every visible string and every size.
- **They said what was seen and what was inferred.** n8n §5 and dub §5 open with "captures are static JPEGs...
  inferred, not observed"; superhuman §11 marks "DOM metrics only". This spec marks what the real app does versus
  what the page simulates, in every interactive piece.
- **Ranked verdicts with an "Adapt:" line.** attio §12, twenty §12 and appflowy §12 rank what to borrow and say how.
  Part B cites those adaptations rather than re-deriving them.
- **Mobile was checked numerically** (scrollWidth 390 in appflowy §11, attio §11, firecrawl §11). The acceptance
  checklist does the same.
- **SEO facts were captured, not guessed** (title length, canonical, JSON-LD types, internal-link count, plausible
  §10). Part B specifies each tag literally.
- Weakest parts of the set: hover/easing/reduced-motion were rarely measured ("not verified" in most §5s). Part B
  therefore specifies every trigger, duration, easing and reduced-motion fallback itself.

## A4. Anti-patterns to avoid

| Anti-pattern | Seen in | Rule for rightnow-ai |
|---|---|---|
| Banner + cookie modal + chat bubble crowding the first screen | attio §12, instantly §5, lemlist §5, posthog §11 | No banner, no cookies, no chat widget. The page sets no cookies. |
| Logo walls, user counts, ratings, testimonials, compliance badges | instantly §7, calcom §7, appflowy §7, plausible §7 | None. Only facts the repo proves (A1.7). Live star count only if fetched and labelled. |
| Hero that does not say what the product is | instantly §12, superhuman §12, attio §9 | H1 says "open-source cold email you run yourself". |
| Self-hosting buried in the footer or one word | calcom §6, dub §6, supabase §6 | Self-host is the primary CTA and a full section. |
| Sign-up, trial, demo, pricing funnels | every SaaS reference | None exist. Primary CTA: view the code on GitHub. Secondary: the setup steps on the page. |
| OS-in-a-window scroll container breaking native scroll and find-in-page | posthog §10, §12 | Native document scroll only. No scroll-jacking. |
| Duplicated headings in the DOM from animated split text | appflowy §10, n8n §12, superhuman §10 | Every heading exists once. Animations wrap, never clone, text. |
| Blur-to-sharp lazy media that looks broken while loading | superhuman §12, supabase §12, twenty §12 | Reserved width/height on every image, a solid `--surface-sunken` placeholder, no blur. |
| Desktop screenshot scaled to 6px text on mobile | plausible §11, dub §12 | A separate mobile screenshot (`<picture>` with a media query) in the hero; others crop instead of shrinking. |
| Long sticky scrollytelling (6.5k px, 2.8k px) | attio §12, twenty §12 | The how-it-works rail is at most 6 x 480px and collapses to stacked steps on mobile. |
| Meta description that does not match the hero | posthog §10 | Title, meta, OG and H1 share the same nouns. |
| No JSON-LD, no canonical | firecrawl §10, calcom §10, coolify §12, dub §12 | Full `@graph` (B10.4), canonical on every page. |
| Title Case headings and vague slogans | instantly §12, superhuman §12 | Sentence case, literal nouns ("warm-up", "campaigns", "inbox"). |
| Calendar widget overflowing on mobile | calcom §11 | Every interactive piece is tested at 390px with no horizontal page scroll. |
| Animations that imply activity that is not happening | (DESIGN_SPEC B1.6) | Every animated number or event is labelled "sample" or comes from the reader's own input. |

---

# Part B. The rightnow-ai site

## B0. Concept: "The Post Room"

The app's design system is a **Signal Desk** (DESIGN_SPEC B0): warm paper, ink, ruled hairlines, Plex Mono ledger
labels, one teal signal hue. The site steps back one room: **the post room** where outgoing mail is metered, franked
and dispatched. It is the same paper, ink and teal, so it reads as the same brand, but it adds a small, tasteful
postal vocabulary that the app does not use:

- **The postage meter.** The app's signature send meter ("142 / 300 sent today", DESIGN_SPEC B4.17) is literally a
  postage meter. The site makes it the hero object and turns it into the interactive capacity planner (B6.7).
- **Postmarks.** A circular rubber-stamp mark (ink, slightly rough) "franks" a few things: the hero, each sent step
  in the simulator, the finished setup terminal. Its centre shows today's date from the reader's clock. It is the
  fun element: it "thunks" on once, never loops.
- **Cancellation waves.** The five wavy lines a post office prints across a stamp replace AppFlowy's brush underline
  (appflowy §1) under the key words of the H1 and as section dividers.
- **Kraft paper.** One marketing-only surface, a manila/kraft tint, for the "envelope" panels behind screenshots
  (where appflowy uses pastel gradients, appflowy §3).
- **The ledger.** Mono, bracketed counters (`[ 03 / 06 ]`, from: firecrawl §12.4) and timestamped event logs in the
  simulator, echoing the app's mono micro-labels.
- **"right now".** The brand name is a time. The planner shows what the reader's mailboxes would be doing *right
  now* on their own clock (inside or outside the sending window). One quiet joke, fully honest.

Personality: a calm, precise operator with dry humour. It tells you exactly what the software does and does not do,
shows you the commands, and lets you play with the real numbers. Never hype, never fake activity.

What makes it unique (no single reference looks like this): AppFlowy's structure (self-host as the first CTA, dark
own-your-stack band, calculator) carried in the app's own paper/ink/teal and IBM Plex instead of AppFlowy's
violet/Inter, with a postal motif no reference uses, and three simulations that teach the real product rules
(freshness gate, stop on reply, quota reservation) instead of selling outcomes.

## B1. Positioning and messaging

**Positioning statement (internal):** rightnow-ai is the open-source, self-hosted cold-email platform for people who
want Instantly-style sending, warm-up, inbox and CRM without handing their mailboxes, leads and replies to a SaaS.
It is free (MIT); you pay only for your own server, if any, and your own mailboxes.

**Message pillars (each maps to sections):**
1. *Runs on your machine.* Laptop or VPS, Docker Compose, PostgreSQL only. Your data never leaves your database.
2. *The whole outbound loop.* Mailboxes, DNS checks, warm-up, leads, campaigns, unified inbox, CRM, analytics,
   automations, REST API.
3. *Built not to burn your domain.* Quotas reserved before each send, no burst sending, sync before send, unknown
   outcomes held, never resent.
4. *Honest by construction.* No fake engagement, honest sender identity, unsubscribe always honored, warm-up that
   never promises inbox placement.

**Headline candidates:**
1. "Open-source cold email you run yourself." (keyword-rich, literal, short)
2. "Cold email, warm-up and a CRM, on your own server."
3. "The self-hosted Instantly alternative."
4. "Send it right. Send it from your own server." (brand pun, weaker keywords)
5. "Your mailboxes. Your server. Your leads." (from: appflowy §9 triplet; no category noun)

**Decision: candidate 1.** It contains "open-source" and "cold email", says "run yourself" (self-hosted) in plain
words, fits two lines at 1440 and three at 390, and the cancellation wave goes under "run yourself". The
"Instantly alternative" phrase moves to the subhead, the title tag and the meta description, where it serves search
without making the H1 about a competitor. Candidate 5's triplet is reused as the self-host band's sub line.

**Voice rules:** sentence case; second person; short sentences; literal feature nouns as used in the app ("warm-up",
"re-warm-up", "unified inbox", "CRM", "campaigns", "sequence", "daily limit"); numbers always with their source or
"sample"; brand always lowercase `rightnow` or `rightnow-ai` (never "RightNow", never "rightnow.ai" on the site).
Use "rightnow-ai" when naming the project/repo/software, "rightnow" is allowed in running prose after first use.

## B2. Information architecture

Pages (all static HTML; decision: three indexable pages plus a 404, because each carries substantive unique content):

| URL | File | Purpose | Primary queries |
|---|---|---|---|
| `/` | `site/index.html` | The launch page: what it is, how it works, play with it, set it up, compare, FAQ | self-hosted cold email software, open source cold email, open source instantly alternative, email warm-up open source |
| `/self-host/` | `site/self-host/index.html` | Full setup and deploy guide: requirements, laptop, VPS, mailbox setup, backups, upgrades, why not Vercel | self-hosted cold email, deploy cold email on vps, docker cold email |
| `/instantly-alternative/` | `site/instantly-alternative/index.html` | Honest comparison with hosted cold-email tools: hosting model, data, cost model, feature coverage, what you give up | instantly alternative, open source instantly alternative, smartlead alternative, lemlist alternative |
| (404) | `site/404.html` | Not-found page, `noindex` | - |

Not built (decision): no `/open-source-crm/` or `/email-warmup/` pages. The CRM and warm-up are real but a separate
page would repeat the homepage sections; they are covered by H2/H3s and FAQ on `/` (thin pages hurt more than they
help). No blog, no changelog page (link to GitHub commits instead).

**Nav (sticky, every page):** logo + wordmark (→ `/`), then `How it works` (`/#how`), `Features` (`/#features`),
`Self-host` (`/self-host/`), `Compare` (`/instantly-alternative/`), `FAQ` (`/#faq`); right: GitHub star pill (live,
B7.4), theme toggle, ink button "View on GitHub". On subpages the hash links are written `../#how` etc.

**Homepage section order** (ids are anchors):

| # | id | Section | Background |
|---|---|---|---|
| 0 | - | Skip link, nav | paper |
| 1 | `top` | Hero: H1, sub, CTAs, command box, framed dashboard with postage meter and postmark | paper |
| 2 | `proof` | Ledger strip of five provable facts | paper, hairlines |
| 3 | `how` | How it works: six steps, sticky rail, one screenshot each | paper / kraft panels |
| 4 | `simulator` | Signature: "Follow one lead through a campaign" | surface card on paper |
| 5 | `inbox` | Signature: unified inbox + CRM demo | paper |
| 6 | `features` | Feature grid (text, SEO depth) + reliability band "Built not to burn your domain" with pipeline diagram | paper, then dark band |
| 7 | `warmup` | Warm-up explained honestly + signature: postage-meter capacity planner | kraft |
| 8 | `self-host` | Self-host band: Laptop vs VPS cards, signature step-through terminal with .env generator, requirements, "What you own" | dark band |
| 9 | `deploy` | Deploy it yourself from GitHub (fork/clone → .env → start) + the Vercel note | paper |
| 10 | `compare` | Compared with hosted tools (short table) → link to `/instantly-alternative/` | paper |
| 11 | `responsible-use` | Responsible use and non-affiliation | kraft callout |
| 12 | `faq` | FAQ (10 questions, FAQPage JSON-LD) | paper |
| 13 | - | Final CTA + footer | ink footer card |

CTA cadence (from: instantly §12.1, appflowy §8): ink "View on GitHub" in nav, hero, self-host band, final CTA
(four). Secondary "Set it up" (→ `#self-host`) in hero and how-it-works step 06; "Read the full setup guide" (→
`/self-host/`) in the self-host band and deploy section. Nothing else is a button-styled CTA.

## B3. Screenshots

The capture is in progress in `site/assets/screens/`. At the time of writing it holds 24 shots as PNG + WebP pairs
(desktop 2880x1800 = 1440x900 @2x, except `inbox-thread-light` 2880x2720; mobile 780x1688 = 390x844 @2x), and no
`README.md` yet. The "Source file" column below names the files present. If the capture adds or renames files, the
builder maps them to the keys here and records the final mapping (key, file, caption, alt) in
`site/assets/screens/README.md` (create it if the capture did not). If a shot is missing, its panel shows the caption
with a 1px dashed `--border-strong` frame at the same aspect ratio (no broken image, no placeholder art), and its
acceptance item stays open.

Processing (one-off, committed; no build step): from each PNG source generate `<source>-1600.webp` and
`<source>-800.webp` (mobile shots: `-780.webp` and `-390.webp`) at quality 80 with `npx sharp-cli` or `cwebp -q 80
-resize`. The page references only these resized WebPs. The original PNGs and full-size WebPs are excluded from the
deploy with `site/.vercelignore` (`assets/screens/*.png` and `assets/screens/*-light.webp` / `*-dark.webp` without a
width suffix). Tall `inbox-thread-light` is shown in a 16:10 frame with `object-fit: cover; object-position: top`.
Where a `-dark` source exists (`dashboard-dark`, `campaign-sequence-dark`), use `<picture>` with
`media="(prefers-color-scheme: dark)"` plus a `[data-theme]` swap in `site.js` (the `<source>` media cannot read the
toggle, so the script sets `srcset` on theme change); otherwise the light shot shows in both themes inside its kraft
panel. Every `<img>` has `width`, `height`, `loading="lazy"` (hero: `fetchpriority="high"`, no lazy),
`decoding="async"`, `srcset` and `sizes`. All shots are from the real app with seeded sample data.

| Key | Source file (`site/assets/screens/`) | Shows | Used in | Caption (visible) | Alt |
|---|---|---|---|---|---|
| dashboard | `dashboard-light` (+ `dashboard-dark`) | Dashboard with send meter, KPIs, setup checklist | Hero (desktop) | Sample data. The dashboard of a running install. | rightnow-ai dashboard showing today's sends against the daily allowance, replies and campaign status (sample data) |
| dashboard-mobile | `dashboard-mobile-light` | Mobile dashboard, 390 wide | Hero (< 768px) | Sample data. The same app on a phone. | rightnow-ai dashboard on a phone (sample data) |
| accounts | `accounts-list-light` | Accounts list with providers, status pills, capacity bars | Step 01 | Gmail, Microsoft 365 and IMAP/SMTP mailboxes side by side. | Email accounts page listing connected mailboxes with status and daily capacity (sample data) |
| deliverability | `deliverability-overview-light` | SPF/DKIM/DMARC/MX/blacklist checks | Step 02 | The Deliverability page tells you which DNS record to fix. | Deliverability page with SPF, DKIM, DMARC, MX and blacklist checks per domain (sample data) |
| warmup | `account-drawer-warmup-light` (alt: `deliverability-placement-light`) | Warm-up settings / health per account | Step 03, warm-up section | Warm-up volume, inbox rate and health per mailbox. | Warm-up and deliverability page showing warm-up volume and health scores (sample data) |
| leads | `leads-list-light` | Leads table | Step 04 | Leads with lists, tags and custom fields. | Leads table with names, companies, lists and status (sample data) |
| csv-import | `leads-import-mapping-light` | CSV import column mapping | Step 04 (second image, tab) | Map CSV columns; duplicates are removed. | CSV import wizard mapping columns to lead fields (sample data) |
| sequence | `campaign-sequence-light` (+ `-dark`) | Campaign sequence editor with steps, delays, A/B variants | Step 05 | Steps, delays, merge fields and A/B variants. | Campaign sequence editor with three steps and A/B variants (sample data) |
| schedule | `campaign-schedule-light` | Campaign schedule tab | Step 05 (second image, tab) | Sending days, hours and time zone per campaign. | Campaign schedule with sending days, hours and time zone (sample data) |
| inbox | `inbox-thread-light` | Unified inbox thread view with label pill | Step 06 (Inbox tab) | Every mailbox in one threaded inbox. | Unified inbox with a reply labelled Interested (sample data) |
| crm | `crm-kanban-light` | CRM Kanban | Step 06 (CRM tab) | Deals on a Kanban board, revenue tied to the campaign. | CRM Kanban board with deals in pipeline stages (sample data) |
| analytics | `analytics-charts-light` (alt: `analytics-overview-light`) | Analytics charts | Step 06 (Analytics tab) | Sends, replies, bounces and revenue by campaign, step and mailbox. | Analytics page with sends, replies and bounces over time (sample data) |
| automations | `automations-rules-light` | Automation rules | Step 06 (Automations tab) | Rules like "when a lead replies interested, move it to this stage". | Automations page listing event rules and webhooks (sample data) |
| api-keys | `settings-api-keys-light` | Settings > API keys | Deploy section, small | A REST API with scoped keys. | API keys settings page (sample data) |
| inbox-mobile | `inbox-mobile-thread-light` (list view: `inbox-mobile-list-light`) | Mobile inbox | Inbox demo section, beside the demo on desktop only | Replies from your phone. | rightnow-ai inbox on a phone (sample data) |

## B4. Design tokens

All tokens are CSS custom properties in `site/assets/css/site.css`. Light is `:root`; dark applies under
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }` and again under
`:root[data-theme="dark"] { ... }`. `body` sets `background: var(--bg); color: var(--fg)`. Neutral, signal and
semantic values are copied from DESIGN_SPEC B2 so the site and app are one brand; marketing additions are marked
**new**. Contrast ratios (WCAG 2.x) were computed for every new pair.

### B4.1 Color

| Token | Role | Light | Dark | Contrast |
|---|---|---|---|---|
| `--bg` | Page | `#F8F7F4` | `#121210` | - |
| `--surface` | Cards, demo frames, code blocks' outer card | `#FFFFFF` | `#1A1917` | - |
| `--surface-sunken` | Image placeholders, code block body, inactive tabs | `#F0EFEA` | `#161614` | - |
| `--kraft` **new** | Envelope panels behind screenshots, warm-up section, responsible-use callout | `#EFE7D6` | `#26221B` | fg 14.00 (L) / 13.15 (D); fg-muted 5.51 (L) / 6.43 (D); signal 4.82 (L) / 7.38 (D) |
| `--hover` | Hover fill | `#EAE8E2` | `#262522` | per DESIGN_SPEC |
| `--border` | Hairlines | `#E3E1DB` | `#2E2D29` | decorative |
| `--border-strong` | Button outline, frames, rails | `#CFCCC4` | `#3D3B36` | decorative |
| `--input` | Input/slider/stepper boundary | `#8F8B81` | `#6B6860` | 3.40 / 3.16 (passes 1.4.11) |
| `--fg` | Text, headings, postmark ink | `#1C1B18` | `#ECEAE4` | 16.08 on bg (L), 15.59 (D) |
| `--fg-muted` | Second half of two-tone headings, body secondary | `#5E5B53` | `#A8A59C` | 6.33 on bg (L), 7.62 (D) |
| `--fg-subtle` | Captions, "sample data" labels | `#6B6860` | `#8E8B82` | 5.6 on surface (L), 5.16 (D) |
| `--primary` / `--primary-fg` | Ink button | `#1C1B18` / `#FFFFFF` | `#ECEAE4` / `#121210` | 17.22 / 15.59 |
| `--primary-hover` | Ink button hover | `#34322D` | `#D6D3CB` | >= 12:1 |
| `--signal` | Links, focus ring, active rail item marker, active tab underline, chart series 1 | `#0B6F75` | `#45C2C7` | 5.53 on bg (L), 8.75 (D) |
| `--signal-tint` | Selected option, active step background | `#E2F1F1` | `#10302F` | fg 14.83 / 11.75 |
| `--band` **new** | Dark bands (reliability, self-host) background, both themes | `#121210` | `#0E0E0C` | - |
| `--band-fg` **new** | Text on band | `#ECEAE4` | `#ECEAE4` | 15.59 on `#121210` |
| `--band-muted` **new** | Secondary text on band | `#A8A59C` | `#A8A59C` | 7.62 |
| `--band-signal` **new** | Links, focus, active card border on band | `#45C2C7` | `#45C2C7` | 8.75 |
| `--band-line` **new** | Blueprint hairlines on band | `#2E2D29` | `#2A2926` | decorative |
| `--band-surface` **new** | Terminal / cards on band | `#1A1917` | `#1A1917` | band-fg 14.60 |

Semantic pills inside demos use DESIGN_SPEC B2.3 exactly (`--success-fg/-tint/-solid`, `--warning-*`,
`--danger-*`, `--info-*`, `--neutral-*`); copy those 15 tokens (light and dark) verbatim. Charts use
`--chart-1` (sent, teal `#0E8A90` / `#3BB9BF`), `--chart-2` (replied, `#5363D6` / `#8592F5`), `--chart-grid`
(`#E9E7E1` / `#2A2926`). Rule kept from the app: teal is never a status; round shapes mean state.

### B4.2 Typography

Families (self-hosted WOFF2, latin subset, `font-display: swap`; files in B12): **IBM Plex Sans** 400, 500, 600 and
**IBM Plex Mono** 400, 500 (same as the app, DESIGN_SPEC B2.5). Fallbacks: `ui-sans-serif, system-ui, "Segoe UI",
Roboto, sans-serif` / `ui-monospace, "SFMono-Regular", Consolas, monospace`. Preload only Plex Sans 600 and 400.

Marketing scale (fluid with `clamp()` between 390px and 1440px viewports):

| Role | Family | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `display` | Sans | `clamp(2.25rem, 1.6rem + 2.7vw, 3.75rem)` (36→60px) / 1.05 | 600 | -0.025em | H1 only |
| `h2` | Sans | `clamp(1.75rem, 1.45rem + 1.25vw, 2.5rem)` (28→40px) / 1.15 | 600 | -0.02em | Section titles (two-tone) |
| `h3` | Sans | 20px / 28px (18/26 below 768) | 600 | -0.01em | Step titles, card titles |
| `lead` | Sans | `clamp(1.0625rem, 1rem + 0.35vw, 1.25rem)` (17→20px) / 1.5 | 400 | 0 | Hero sub, section intros |
| `body` | Sans | 17px / 28px (16/26 below 768) | 400 | 0 | Paragraphs, FAQ answers |
| `small` | Sans | 14px / 20px | 400 | 0 | Captions, helper text, footer links |
| `eyebrow` | Mono | 12px / 16px | 500 | 0.08em, UPPERCASE | Section labels, counters `[ 03 / 06 ]` |
| `code` | Mono | 14px / 22px (13/20 below 768) | 400 | 0 | Terminal, code blocks, `.env` |
| `num` | Mono | 14-40px as placed | 500 | 0 | Meter and planner numbers, `tabular-nums` |
| `ui` | Sans | 13-14px | 400/500 | 0 | Text inside demo mocks (matches app body 14/20) |

Two-tone headings (from: attio §12.3, resend §12.2): each H2 is one `<h2>` whose second clause is wrapped in
`<span class="tone">` colored `--fg-muted` (`--band-muted` on bands). Never two elements.

### B4.3 Spacing, layout, radii, shadow, motion

- 4px base; steps 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96, 128.
- Container: `max-width: 1200px`, side gutter `max(16px, 4vw)` capped at 40px (16px at 390). Reading column 680px.
  Hero frame and bands may go to 1320px.
- Section vertical padding: 128px at >= 1024, 96px at 768-1023, 64px below 768. 48px between H2 block and content.
- Blueprint frame (from: lemlist §12.5, calcom §2, appflowy §2.7): at >= 1024 the container has 1px vertical rails
  `--border` at its left and right edge running the full page, and each section top has a 1px rule with a 9px "+"
  mark (two 1px lines) at both rail crossings. On bands the same in `--band-line`. Pure CSS (`::before/::after`),
  hidden below 1024.
- Radii: 6px buttons/inputs/tabs; 8px small cards, chips; 12px cards, code blocks, demo frames; 20px kraft panels and
  bands' inner cards; 28px footer card; 9999px pills, dots, postmark.
- Shadows: static cards none (1px border). Floating hero cards and the screenshot frame: light
  `0 24px 64px -12px rgb(28 27 24 / 0.22), 0 0 0 1px var(--border)`; dark `0 24px 64px -12px rgb(0 0 0 / 0.7), 0 0 0
  1px var(--border-strong)`.
- Motion tokens: `--dur-1` 100ms (hover), `--dur-2` 160ms (tabs, menus), `--dur-3` 220ms (panels), `--dur-4` 600ms
  (one-time reveals, bar fills, wave draw); `--ease-out: cubic-bezier(0.2, 0, 0, 1)`, `--ease-in: cubic-bezier(0.4, 0,
  1, 1)`; stamp uses `--ease-stamp: cubic-bezier(0.3, 1.4, 0.5, 1)` (one small overshoot).
- Reveal rule: sections fade+rise once on first intersection (IntersectionObserver, threshold 0.15): `opacity 0→1`,
  `translateY(12px)→0`, `--dur-4`, `--ease-out`; children stagger 60ms, max 4 children. Content is visible without
  JS (the hidden state is applied only when `html.js` is set by the head script and reduced motion is off).
- `prefers-reduced-motion: reduce`: no reveals, no stamp thunk, no wave draw, no auto-advancing demos, no travelling
  dots; every piece renders its final state; transitions limited to color/opacity at 0.01ms.

## B5. Logo and brand marks

- Source: `apps/web/public/rightnow-logo.svg` (1000x1000 viewBox, a dark mark on a white square, embedded raster).
  Copy it unchanged to `site/assets/img/rightnow-logo.svg`. The app inverts it per theme (`invert dark:invert-0`,
  `apps/web/components/app-shell.tsx`): light mark on ink in light mode, ink mark on paper in dark mode. The site
  does the same: `.logo { filter: invert(1); border-radius: 4px }` in light, `filter: none` in dark (both theme
  selectors). Sizes: 28px in nav, 40px in footer.
- Wordmark: text, not image: `rightnow` in Plex Sans 600 18px `--fg` followed by `-ai` in `--fg-muted`. The link's
  accessible name is "rightnow-ai home" (the image has `alt=""`).
- Favicons (generated once from the logo with the invert applied, committed): `assets/img/favicon-32.png`,
  `assets/img/apple-touch-icon.png` (180), and `favicon.ico` (32) at `site/` root. `<link rel="icon"
  href="assets/img/favicon-32.png" sizes="32x32">`, `<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png">`.
- **Postmark** component (B7.9) and **cancellation wave** (B7.10) are the two brand devices. Use the postmark at most
  4 times per page.

## B6. Homepage, section by section

Breakpoints: `sm` < 768, `md` 768-1023, `lg` >= 1024, `xl` >= 1280. "Mobile" means 390px wide unless stated.

### B6.0 Skip link and nav

- Skip link: first focusable element, "Skip to content" → `#main`, visually hidden until focused, then a 40px ink
  pill at top-left 8px, `z-index: 100`.
- Nav: `position: sticky; top: 0`, 64px tall, `--bg` at 88% opacity with `backdrop-filter: blur(8px)` (solid `--bg`
  when `prefers-reduced-transparency` or no support), 1px `--border` bottom once scrolled > 8px (class toggled by
  a passive scroll listener / IntersectionObserver on a sentinel).
- Desktop (>= 1024): logo+wordmark left; links centre (14px/500 `--fg-muted`, hover `--fg`, current page
  `aria-current="page"` `--fg` with 2px `--signal` underline offset 6px); right: star pill (B7.4), theme toggle
  (36px icon button, sun/moon, `aria-label="Switch to dark theme"` / "Switch to light theme", `aria-pressed`
  reflecting dark), ink button "View on GitHub" (GitHub mark icon + text, 36px).
- Below 1024: logo+wordmark, then right: GitHub icon button (44x44, `aria-label="View rightnow-ai on GitHub"`),
  menu button (44x44, "Menu" icon, `aria-expanded`, `aria-controls="nav-menu"`). The menu is a disclosure panel
  under the bar (not a modal): full width, `--surface`, links stacked 48px tall, then the star pill, theme toggle
  row "Theme: System / Light / Dark" (3-way segmented), and a full-width ink "View on GitHub". Opens with height/
  opacity `--dur-3`; Esc and link click close it and return focus to the button.
- Theme: three states, stored per viewer in `localStorage["rn-theme"]` (`light`/`dark`, absent = system) inside
  try/catch; the tiny sync head script `assets/js/theme-init.js` sets `data-theme` and `html.js` before paint. The
  desktop toggle flips between light and dark relative to the current effective theme.

### B6.1 Hero (`#top`)

**Layout, desktop (>= 1024):** centred text column 880px: eyebrow, H1 (2 lines), lead (max 680px), CTA row, command
box. 64px below: the hero frame, 1120px wide, overlapping into the next section by 120px (the section's bottom 50%
is `--kraft`, top 50% `--bg`, so the frame straddles two tones; from: plausible §3). Top padding 96px below the nav.
**Mobile:** left-aligned text, H1 at 36px over 3 lines, CTAs stacked full width (48px tall), command box full width
with horizontal scroll inside the code line only, frame full width minus gutters showing the mobile screenshot.

**Copy (exact):**
- Eyebrow (mono, `--fg-muted`): `SELF-HOSTED · MIT LICENSED · NO ACCOUNT TO CREATE`
- H1: `Open-source cold email you run yourself.` with the cancellation wave (B7.10) under "run yourself".
- Lead: `Connect your own Gmail, Microsoft 365 or IMAP/SMTP mailboxes, warm them up, run multi-step campaigns,
  answer every reply in one inbox and track deals in a built-in CRM. A self-hosted alternative to Instantly that
  runs on your laptop or your own server, so your leads and replies never leave your database.`
- Primary CTA (ink button, GitHub icon): `View the code on GitHub` → `https://github.com/AnalyticDog13/rightnow-ai`
- Secondary CTA (outline button): `Set it up in 4 commands` → `#self-host`
- Under the CTAs, one `small` line `--fg-subtle`: `Free and MIT licensed. You pay only for your own server, if
  any, and your own mailboxes.`
- Command box (B7.6 single-line variant), caption above it in `small` `--fg-muted` (from: n8n §6): `Don't want to
  read the docs yet? You need Docker and git:` and the line
  `git clone https://github.com/AnalyticDog13/rightnow-ai.git && cd rightnow-ai && cp .env.example .env`
  with a Copy button. Below, `small`: `Then add three secrets to .env and run scripts/start.sh.` (the words
  "three secrets" link to `#self-host`).

**Hero frame:** a screenshot frame (B7.7) holding `dashboard` (desktop) / `dashboard-mobile` (< 768) via
`<picture>`. Caption under the frame, `small` `--fg-subtle`, left: `Sample data. The dashboard of a running
install.` Overlapping the frame (>= 1024 only; on mobile they stack below the frame as normal cards, full width):
1. **Postage meter card** at bottom-left, offset -40px x / +32px y outside the frame, 280px wide (replica of
   DESIGN_SPEC B4.17, built in HTML): mono eyebrow `SENT TODAY`, pill right `Sending` (success dot), number
   `142 / 300` (Plex Mono 28px 500, tabular), 6px bar (track `--surface-sunken`, fill `--chart-1` at 47.3%),
   footnote `small` `--fg-subtle`: `Sample. Each mailbox's allowance is reserved before every send.`
2. **Reply card** at top-right, offset +40px x / -24px y, 300px: a single inbox row: avatar initials "DR", `Dana
   Reyes`, `Re: Quick question about Harbor Ops`, pill `Interested` (success), meta `via maya@outreach-one.example
   · step 2, variant B`.
3. **Postmark** (B7.9, 112px) overlapping the frame's top-left corner, rotated -8deg, ring text `SENT FROM YOUR OWN
   SERVER · RIGHTNOW-AI ·`, centre: today's date `30 OCT 2026` (client clock, uppercase `DD MON YYYY`; without JS:
   `SELF-HOSTED`).

**Motion (load, once):** wave draws (stroke-dashoffset, 700ms, `--ease-out`, 300ms delay); frame fades/rises
(`--dur-4`); meter bar fills 0→47.3% (600ms, `--ease-out`, starts when the frame is visible; the number is static
from the start, never counts); reply card slides 12px from the right + fades (220ms, 400ms delay); postmark thunks
(B7.9) at 900ms. Reduced motion: all final, no delays. Nothing loops in the hero.

### B6.2 Proof ledger (`#proof`)

A single row (wraps to a 2-column grid on md, 1 column on sm) of five facts, between 1px `--border` rules top and
bottom, 24px vertical padding, items separated by 1px vertical rules (lg). Each item: mono eyebrow + one `small`
line. These are the only "stats" on the page; no counters, no count-up.

| Eyebrow | Line | Link |
|---|---|---|
| `MIT LICENSE` | Read it, fork it, run it. No paid edition. | `LICENSE` on GitHub |
| `~1,290 TESTS IN CI` | Unit, integration and browser tests run on every push. | GitHub Actions page |
| `LIVE-VERIFIED SENDING` | Checked against real Gmail, Microsoft and SMTP mailboxes. | `docs/ops/LIVE_VERIFICATION.md` on GitHub |
| `POSTGRESQL ONLY` | One database holds the data and the job queue. No Redis. | `docs/DECISIONS.md` on GitHub |
| `ENCRYPTED CREDENTIALS` | OAuth tokens and SMTP passwords are encrypted at rest (AES-256-GCM). | The repo README (no anchor) |

Source of the test count: README "about 1,290 automated tests and the browser tests pass in CI". The live-verified
item may say "Gmail, Microsoft and SMTP" only if `docs/ops/LIVE_VERIFICATION.md` lists all three as passed at build
time; otherwise the builder writes exactly the providers it lists.

### B6.3 How it works (`#how`)

**Copy:**
- Eyebrow: `HOW IT WORKS`
- H2: `From mailbox to closed deal.` `<span class="tone">Six steps, all in one app on your server.</span>`
- Intro (lead, max 680px): `This is the whole loop rightnow-ai runs for you. Each step is a page in the app.`

**Layout, lg:** a sticky rail (from: attio §2.5, §12.2; n8n §12.2) in a two-column grid 360px / 1fr. Left column:
`position: sticky; top: 96px` list of six step buttons (counter `[ 01 / 06 ]` mono, title 16px/600; inactive
`--fg-muted`, active `--fg` with a 2px `--signal` bar on its left edge and `--signal-tint` background). Right column:
six step panels stacked in normal flow, each `min-height: 480px`, each a kraft panel (20px radius, 40px padding)
with: the two-tone step statement (h3 size 24/32: bold sentence `--fg` + continuation `--fg-muted`), then the
screenshot frame (B7.7) bleeding 40px off the panel's right edge (clipped by the panel, `overflow: hidden`) and
fading out at the bottom 64px (mask gradient; from: attio §4). Scroll-spy (IntersectionObserver on panels,
`rootMargin: "-40% 0px -55% 0px"`) sets the active rail item; clicking a rail item scrolls its panel into view
(`scrollIntoView({behavior: reduced ? "auto" : "smooth", block: "start"})` with `scroll-margin-top: 96px`). No
scroll-jacking: the panels are ordinary content. **md/sm:** the rail is hidden; each panel is a normal block with its
counter, h3, text, then the image (no bleed, full width, `aspect-ratio` kept, no fade). Total height at lg ~3,000px.

Each panel has an `<h3>` (the rail button's text is the same title, but the rail is `aria-hidden="true"` with
`tabindex="-1"` buttons, and a visually identical `<nav aria-label="Steps">` of in-page links is what keyboard users
reach; this keeps one heading per step and no duplicate headings).

**Steps (exact copy, screenshot):**

1. `[ 01 / 06 ]` h3 `Connect your mailboxes`
   Statement: **Gmail, Microsoft 365 and any IMAP/SMTP host.** `Gmail and Google Workspace connect with your own
   Google OAuth client, Microsoft 365 and Outlook with your own Entra app, everything else with a host, username
   and app password. Logins are encrypted before they are stored.`
   Link: `Google setup →` (GOOGLE_SETUP.md on GitHub) · `Microsoft setup →` (MICROSOFT_SETUP.md).
   Screenshot: `accounts`.
2. `[ 02 / 06 ]` h3 `Fix your DNS`
   **SPF, DKIM and DMARC, checked for you.** `The Deliverability page checks each sending domain's records, MX and
   spam blacklists, and tells you what to fix. A missing or broken SPF record blocks launch.`
   Screenshot: `deliverability`.
3. `[ 03 / 06 ]` h3 `Warm up, or re-warm`
   **Two to four weeks before real volume.** `Turn on warm-up per mailbox: your mailboxes send short, plainly
   labelled messages to each other and record whether they land in the inbox or in spam. A mailbox that sat idle
   for 30 days is re-warmed automatically.`
   Link: `How warm-up works →` (`#warmup`). Screenshot: `warmup`.
   (Sources: README "How warm-up works"; 30 days = `Workspace.inactivityDays @default(30)` and `autoRewarm
   @default(AUTO)` in `packages/db/prisma/schema.prisma`.)
4. `[ 04 / 06 ]` h3 `Import your leads`
   **CSV in, duplicates out.** `Map your CSV's columns to names, companies and custom fields. You confirm you have
   the right to contact the list and record a lawful basis before the import starts. Anyone on the blocklist is
   never emailed.`
   Screenshots: `leads` and `csv-import` as a two-tab image switcher inside the panel (B7.5 small tabs "Leads" /
   "CSV import"). (Source: COMPLIANCE.md "Authorized lists".)
5. `[ 05 / 06 ]` h3 `Build the campaign`
   **Steps, delays, A/B variants and a schedule.** `Write step 1 and the follow-ups with merge fields like
   {{firstName}} and spintax like {{RANDOM | Hi | Hello}}. Set sending days and hours, the time zone, the daily
   limit and which mailboxes send. Send yourself a test, then launch.`
   Screenshots: `sequence` / `schedule` tabs ("Sequence" / "Schedule").
6. `[ 06 / 06 ]` h3 `Work the replies`
   **One inbox, a CRM, analytics and automations.** `Replies from every mailbox land in one threaded inbox,
   labelled interested, out of office, unsubscribe and more. Interested leads become deals on a Kanban board, with
   revenue tracked back to the campaign that found them.`
   Screenshots: four tabs "Inbox" / "CRM" / "Analytics" / "Automations" (`inbox`, `crm`, `analytics`,
   `automations`). Under the image: secondary link `Set it up →` (`#self-host`).

### B6.4 Signature 1: sequence simulator (`#simulator`)

Specced in B8.1. Section copy:
- Eyebrow: `TRY IT · RUNS IN YOUR BROWSER`
- H2: `Follow one lead through a campaign.` `<span class="tone">Pick what the lead does and watch the rules the app
  applies.</span>`
- Layout: one `--surface` card, 12px radius, 1px border, max 1120px. Desktop: scenario picker left (320px), timeline
  + ledger right. Mobile: picker as a horizontally scrollable chip row (inside the card; the page does not scroll
  sideways), timeline vertical, ledger below.

### B6.5 Signature 2: unified inbox + CRM demo (`#inbox`)

Specced in B8.2. Section copy:
- Eyebrow: `UNIFIED INBOX · CRM`
- H2: `Every reply in one inbox.` `<span class="tone">The good ones become deals.</span>`
- Lead: `rightnow-ai labels each reply with rules first (interested, out of office, unsubscribe, automated), and
  you can always correct it. Below is a working copy of the idea with sample threads. It is also a small
  open-source CRM: deals, stages, tasks and revenue, on your own server.`
- Desktop: demo (inbox list 360px + thread 1fr + CRM strip below spanning both) beside `inbox-mobile` screenshot
  (240px wide, phone frame radius 28px, only at >= 1280). Mobile: list, then thread opens in place (list hides,
  "Back to inbox" button), CRM strip below as horizontally scrollable columns inside the demo card.

### B6.6 Features (`#features`) and reliability band

**Part 1: feature grid (light).**
- Eyebrow: `FEATURES`
- H2: `Everything a cold email platform needs.` `<span class="tone">On your server, with no plan to upgrade
  to.</span>`
- Grid: 3 columns at lg, 2 at md, 1 at sm; 12 cards, each: 20px line icon (1.5px stroke, `--fg`), h3 (16px/600 in
  this grid), one `body` paragraph (15px/24px), no links. 1px border, 12px radius, 24px padding, no shadow. Cards
  (exact copy; every claim is in README's feature table or PRODUCT_SPEC):

| h3 | Text |
|---|---|
| Email accounts | Gmail API, Microsoft Graph and any IMAP/SMTP host. Per-mailbox daily limits, health and encrypted logins. |
| Warm-up and re-warm-up | Gradual ramp-up between your own mailboxes, inbox-placement tracking, and automatic re-warming after a break. |
| Deliverability checks | SPF, DKIM, DMARC, MX and blacklist checks, inbox placement tests, bounce monitoring and automatic slow-down. |
| Campaigns and sequences | Unlimited steps and delays, A/B variants, spintax, merge fields with fallbacks, schedules per time zone and mailbox rotation. |
| Leads | CSV import with column mapping and dedupe, lists, custom fields, tags, a blocklist and optional email verification. |
| Unified inbox | Every mailbox threaded in one place, with reply labels, notes, reminders and rich-text replies from the original mailbox. |
| CRM | A Kanban pipeline with deal values, tasks and activity history. Revenue is attributed to the campaign, step and mailbox. |
| Analytics | Sends, replies, bounces, clicks, opportunities and revenue by campaign, step, variant and mailbox, with CSV export. Opens are marked as estimates. |
| Automations | Event rules like "when a lead replies interested, move it to this stage", plus signed webhooks. |
| REST API | Scoped API keys for accounts, campaigns, leads, inbox and analytics. |
| Optional AI drafting | Bring your own OpenAI-compatible endpoint (including local models). Drafts wait for a human to approve them. Off by default. |
| Team and security | Invites and roles, two-factor sign-in, an audit log, rate limits, GDPR export and erasure. |

**Part 2: reliability band (dark `--band`, full-bleed with 20px inner radius card inset 16px from viewport edges at
lg, from: appflowy §2.7, attio §12.4).**
- Eyebrow (band-muted): `RELIABLE SENDING`
- H2: `Built not to burn your domain.` `<span class="tone">Or send the same email twice.</span>`
- Lead: `Sending runs on a PostgreSQL-backed queue. These rules are enforced in code and covered by tests.`
- Left (lg 5/12 columns): five selectable mono cards (from: appflowy §2.7), each a `<button>` in a `role="tablist"`
  (vertical, `aria-orientation="vertical"`); active card: 1px `--band-signal` border + `--band-surface` fill; others
  1px `--band-line`. Right (7/12): the pipeline diagram (below) and a text panel (`role="tabpanel"`) that changes
  with the card. No auto-advance. Mobile: cards become an accordion (each `<button aria-expanded>` with its panel
  text below it); the diagram sits above the accordion with all gates visible.

| Card (mono) | Panel title | Panel text | Source |
|---|---|---|---|
| `quota.reserve()` → "Reserved before sending" | Limits that cannot be overshot | Each mailbox's daily allowance is reserved in the same database transaction that claims a send, so parallel workers cannot exceed it. | CLAUDE.md architecture; `packages/core/src/quota.ts` |
| `sync → then send` → "Sync before send" | Fresh mailboxes only | A mailbox may send only if it synced in the last 5 minutes, so replies, bounces and unsubscribes that arrived while you were offline are seen first. | `SYNC_MAX_STALENESS_SEC=300` in `.env.example`; LOCAL.md "While the laptop sleeps" |
| `no burst` → "No backlog bursts" | Late, never all at once | After downtime, missed sends go out inside their schedule window at the normal pace, or wait for the next window. Never as a burst. | LOCAL.md "While the laptop sleeps" |
| `HELD` → "Unknown means held" | Never resent on a guess | A send whose outcome is unknown is looked for in the Sent folder. If it isn't found twice, 15 minutes apart, it is held until you release or cancel it. | LOCAL.md (SEND_LEASE_SEC) |
| `same mailbox` → "Follow-ups stay in thread" | One sender per lead | Follow-ups always go from the mailbox that sent step 1. A reply, bounce or unsubscribe stops the lead's sequence. | README §5 |

**Pipeline diagram** (inline SVG, 640x220 viewBox, from: coolify §12.3): five nodes left→right connected by 1px
dashed `--band-line` paths: `Leads` → `Planner` → `Send queue (PostgreSQL)` → gate `Fresh sync? · Quota left? ·
In schedule?` (a hexagon node) → `Your mailboxes`. Nodes: 1px `--band-line` boxes, mono 12px `--band-fg` labels.
The node related to the active card gets a `--band-signal` border. Animation: one 4px `--band-signal` dot travels
the path every 3.2s (`offset-path` or SMIL `animateMotion`, linear), pausing for 400ms at the gate; it runs only
while the band is in view; a "Pause animation" text button (band-muted, bottom-right of the diagram) toggles it.
Reduced motion: no dot. Caption under the diagram, `small` band-muted: `Illustration of the send path. Not live
data.`

### B6.7 Warm-up and the capacity planner (`#warmup`)

Background `--kraft` full-bleed.
- Eyebrow: `WARM-UP`
- H2: `Email warm-up, open source and honest about it.` `<span class="tone">It builds reputation slowly and never
  fakes engagement.</span>`
- Two columns at lg (5/12 text, 7/12 screenshot `warmup` in a frame); stacked on mobile.
- Text (exact, from README "How warm-up works"):
  - `Built-in warm-up uses only your own mailboxes. Every mailbox with warm-up on sends short, plainly labelled
    messages to the others, and some of them reply. Volume starts small and grows each day, and the app records
    whether each message landed in the inbox or in spam. That inbox rate feeds each mailbox's health score.`
  - Checklist (success check icons, `body`):
    - `It never fakes opens, rescues mail from spam or marks messages important.`
    - `One mailbox can't warm up on its own. It needs others to talk to.`
    - `It works best with several mailboxes on different domains, mixed across Gmail and Outlook.`
    - `With only a few mailboxes it builds little reputation. Treat it mainly as an inbox-placement monitor.`
  - `small`: `Want a bigger warm-up network? Connect the same mailboxes to an outside warm-up service, turn this
    app's warm-up off for them, and lower their daily campaign limit to leave room.` link `Details on GitHub →`
    (README#how-warm-up-works).
- Below, full width: **the capacity planner** (B8.3) introduced by h3 `How much can you send?` and `small`:
  `Plan it with the same defaults the app uses. Nothing here leaves your browser.`

### B6.8 (no section: the planner lives inside B6.7; numbering kept so B6.9+ match the IA table order)

### B6.9 Self-host band (`#self-host`)

Dark `--band`, full-bleed card like B6.6 part 2, blueprint hairlines and a dotted grid (1px dots `--band-line`,
24px pitch) behind the terminal only (from: appflowy §2.7).
- Eyebrow: `SELF-HOST`
- H2: `Your mailboxes. Your server. Your leads.` `<span class="tone">Running in four commands.</span>`
- Lead: `rightnow-ai is only self-hosted. There is no rightnow account and no rightnow server: you run the same
  Docker Compose stack on a laptop or a Linux VPS.`
- **Deployment cards** (2 columns at md+, stacked on sm; from: chatwoot §12.2), selecting a card switches the
  terminal tab (same state):

| | Laptop (Docker Desktop) | VPS (Compose + Caddy HTTPS) |
|---|---|---|
| Best for | Trying it, small campaigns while you work | Always-on sending, open and click tracking |
| You need | Docker Desktop and git (Windows, macOS or Linux) | A Linux VPS with Docker Engine + Compose and git; 1 vCPU / 2 GB RAM is enough to start; a domain |
| Sends when | Only while the machine is awake | Around the clock, inside your schedules |
| Tracking | Not available on localhost (unsubscribe falls back to mailto) | Opens, clicks and one-click unsubscribe over HTTPS |
| Upkeep | `scripts/backup.sh`, `scripts/upgrade.sh` | Same, plus a nightly backup cron and off-server copies |

  (Sources: LOCAL.md "Prerequisites", "While the laptop sleeps", "Limitation: tracking links"; VPS.md §1, §3.)
- **Step-through terminal** (B8.4) with tabs `Laptop` / `VPS`, and the `.env` generator.
- **Key warning callout** (from: twenty §12.2), warning-tint card on the band (`--warning-tint` dark `#2D2210`,
  text `--warning-fg` dark `#F1B24A` 8.31:1, icon), exact text: `Back up ENCRYPTION_KEY with your database. Your
  mailbox logins are encrypted with it; a backup restored without the same key cannot read them.`
- **What you own** list (from: firecrawl §12.3, plausible §12.3, posthog §6), h3 `Self-hosting means you are the
  sysadmin.` then 5 lines with a `·` bullet in band-muted:
  - `Updates: scripts/upgrade.sh backs up, pulls, rebuilds, migrates and restarts.`
  - `Backups: scripts/backup.sh writes a dump. Copy it off the server, with the key stored separately.`
  - `Mailbox apps: Gmail and Microsoft need your own OAuth app. Step-by-step guides are in the repo.`
  - `Uptime: a laptop sends only while it is awake. A VPS is the always-on option.`
  - `Support: it is an open-source project. Issues and pull requests on GitHub, no SLA.`
- CTAs: ink-on-band button (band uses inverted primary: `--band-fg` fill, `#121210` text, 15.59:1) `View the code
  on GitHub`; outline link `Read the full setup guide →` (`self-host/`).

### B6.10 Deploy it yourself from GitHub (`#deploy`)

- Eyebrow: `DEPLOY IT YOURSELF`
- H2: `Deploy it yourself from GitHub.` `<span class="tone">Fork it, configure it, start it.</span>`
- Three numbered cards in a row (lg), stacked (sm), from: calcom §12.3, each with a mono counter and a small code
  block (B7.6):
  1. `01` h3 `Fork or clone` text `Fork the repo to keep your own changes, or clone it as is.` code
     `git clone https://github.com/<you>/rightnow-ai.git` with the hint `small`: `Replace <you> with your GitHub
     name, or use AnalyticDog13 to clone the original.`
  2. `02` h3 `Fill in .env` text `Copy the example file and set three secrets (and, on a VPS, your domain and a
     database password).` code `cp .env.example .env`
  3. `03` h3 `Start it` text `Build and start the stack, then create the owner account with your SETUP_TOKEN.` code
     `scripts/start.sh` with `small` `Windows: scripts\start.ps1. Then open http://localhost:3000/sign-up.`
- **The Vercel note** (a `--surface` card with an info icon, full width, below the three cards), h3 `Why there is
  no "Deploy to Vercel" button`, text: `rightnow-ai needs a PostgreSQL database and a background worker that runs
  all the time to sync mailboxes, warm up and send on schedule. Vercel runs short-lived functions and static files,
  so it cannot host the app. Use Docker Compose on your own machine or a VPS. This page is the only part deployed to
  Vercel: it is plain HTML in the repo's site/ folder.` (Source: `docker-compose.yml` services postgres, migrate,
  web, worker, caddy.)
- Small strip under it: `api-keys` screenshot thumbnail (320px, frame) + text `Once it runs, everything in the app is
  also available over a REST API with scoped keys.`

### B6.11 Compare (`#compare`)

- Eyebrow: `COMPARE`
- H2: `An open-source alternative to Instantly.` `<span class="tone">And to Smartlead and lemlist, if you'd rather
  host it yourself.</span>`
- Table (B7.8), 3 columns: (row label) · `rightnow-ai` · `Hosted cold-email tools (Instantly, Smartlead, lemlist)`.
  Restrained: it compares the model, not competitor internals or prices.

| | rightnow-ai | Hosted cold-email tools |
|---|---|---|
| Who runs it | You, on your laptop or server | The vendor, as a SaaS |
| Source code | Public, MIT license | Not public |
| Where leads and replies live | Your own PostgreSQL database | The vendor's systems |
| Cost model | Free software. You pay for your server (if any), mailboxes and domains | Subscription; see each vendor's pricing page |
| Mailboxes | Your own Gmail, Microsoft 365 and IMAP/SMTP | Typically your own mailboxes; some vendors also sell mailboxes |
| Warm-up network | Your own mailboxes only | Vendor-run shared networks are common |
| Lead database | None. Bring your own lists | Some vendors include one |
| Setup work | Docker, DNS, and your own Google/Microsoft OAuth app | Sign up and connect |

  Under the table, `small` `--fg-subtle`: `Based on each product's public website as of October 2026. Check the
  vendors' own pages for current details.` Then a text link `Read the full comparison →`
  (`instantly-alternative/`).
  (Decision: every "Hosted" cell is either a hosting-model fact or hedged with "typically / some / common"; these
  hedges are deliberate and must not be sharpened. Sources: instantly §8 nav shows Lead Database, Email Accounts,
  warm-up; lemlist §1 is SaaS; PRODUCT_SPEC §19 items 1, 4, 5.)

### B6.12 Responsible use (`#responsible-use`)

A kraft callout card (20px radius, 32px padding, max 880px, centred), no eyebrow, h2 `Use it responsibly.` (single
tone; it is a real H2 for the outline). Text (exact, adapted from README "Responsible use"):
- `You are responsible for how you use this software. Before you email anyone you need a lawful basis to do so (for
  example CAN-SPAM in the US, GDPR and PECR in the EU and UK, CASL in Canada, as they apply to you and your
  recipients). Send only as your own, honestly identified sender.`
- `Every campaign email carries a List-Unsubscribe header and an unsubscribe link or opt-out line, and unsubscribes
  are always honored: the address is suppressed and the lead's sequences stop. Your mailbox providers' terms also
  apply and can restrict cold email. Nothing here is legal advice.`
- `rightnow-ai is an independent open-source project. It is not affiliated with or endorsed by Instantly,
  Smartlead, lemlist or any other email-outreach vendor. Product names are trademarks of their owners.`
- Links: `Compliance notes →` (docs/COMPLIANCE.md on GitHub) · `Provider rules →` (docs/PROVIDER_COMPLIANCE.md).

### B6.13 FAQ (`#faq`)

- Eyebrow: `FAQ`, H2 `Questions about rightnow-ai.` (single tone).
- 10 items as `<details>`/`<summary>` (B7.11). The JSON-LD FAQPage repeats these questions and answers verbatim
  (plain text). Exact copy:

1. **Is rightnow-ai really free?** Yes. It is MIT-licensed open-source software with no paid edition, no plans and
   no account to create. You pay only for what you run it on (nothing extra on your own computer, or a small VPS)
   and for your own mailboxes and domains.
2. **Is there a hosted version or an online demo?** No. rightnow-ai is only self-hosted and the maintainer runs no
   servers. To try it without real mail, set `MAIL_PROVIDER_FAKE=1` in `.env`: every provider is replaced by a fake
   in-process mailbox and the whole pipeline runs without sending anything.
3. **What do I need to run it?** Docker Desktop (or Docker Engine with Compose) and git. For always-on sending, a
   Linux VPS with 1 vCPU and 2 GB RAM is enough to start, plus a domain for HTTPS.
4. **Can I deploy it on Vercel or Netlify?** Not the app. It needs PostgreSQL and a background worker that runs all
   the time, so it runs with Docker Compose on your machine or a VPS. Only this marketing page is a static site.
5. **Which mailboxes can I connect?** Gmail and Google Workspace (through your own Google OAuth client), Microsoft
   365 and Outlook (through your own Microsoft Entra app), and any other provider over IMAP/SMTP with an app
   password where required.
6. **How does warm-up work? Does it guarantee the inbox?** Warm-up sends labelled messages between your own
   mailboxes, ramps volume up daily and records inbox versus spam placement. Nothing can guarantee inbox placement,
   and rightnow-ai never fakes opens or rescues mail from spam. For a larger network you can use an outside warm-up
   service alongside it.
7. **Is it a full Instantly alternative?** It covers mailboxes, warm-up, campaigns, a unified inbox, a CRM,
   analytics, automations and an API. It does not include a lead database, done-for-you mailboxes, a shared warm-up
   network or autonomous AI agents.
8. **Where is my data stored?** In your own PostgreSQL database. Mailbox logins and tokens are encrypted at rest
   with AES-256-GCM using your `ENCRYPTION_KEY`. There is no rightnow account and no rightnow server for your data
   to go to.
9. **What happens if my laptop sleeps mid-campaign?** Nothing sends while it sleeps. On wake, each mailbox syncs
   first, so replies and unsubscribes that came in are seen before anything is sent; missed sends go out inside
   their schedule window, never as a burst. A send whose outcome is unknown is held, not resent.
10. **Can I use it for my team?** Yes. Invite teammates with roles, protect sign-in with two-factor authentication,
    and review the audit log. One workspace per install today.

(Sources: README, LOCAL.md, VPS.md, PRODUCT_SPEC §19, CLAUDE.md "Every query is scoped by workspaceId (multi-tenant
ready, single owner today)". Q10's "one workspace per install" follows that line.)

### B6.14 Final CTA and footer

- Final CTA block (paper, centred, 96px padding): postmark (B7.9, 96px, thunk on enter) above h2 `Clone it. Run it.
  It's yours.` (single tone), `lead` `MIT licensed, self-hosted, no account to create.`, ink button `View the code on
  GitHub`, text link `Set it up →` (`#self-host`).
- Footer: an ink card (`--primary` bg, `--primary-fg` text; in dark mode `--band-surface` with `--band-fg`) inset
  16px from viewport edges, 28px radius, 48px padding (from: appflowy §2.15). Top row: logo (40px) + wordmark +
  `small` `Open-source, self-hosted cold email.`; GitHub icon link. Columns (`small`, 14px links, 32px row gap on
  mobile):
  - **Product**: How it works · Features · Warm-up · Inbox and CRM · FAQ (homepage anchors)
  - **Self-host**: Setup guide (`self-host/`) · Run on a laptop (`self-host/#laptop`) · Run on a VPS
    (`self-host/#vps`) · Backups and upgrades (`self-host/#upkeep`)
  - **Compare** (from: appflowy §8, dub §12.3): Instantly alternative (`instantly-alternative/`) · Smartlead
    alternative (`instantly-alternative/#smartlead`) · lemlist alternative (`instantly-alternative/#lemlist`)
  - **Code**: GitHub repository · README · License (MIT) · Contributing · Decisions
- Bottom row (`small`, 70% opacity text still >= 4.5:1: use `--fg-subtle` equivalents): `MIT licensed · Not
  affiliated with any email-outreach vendor · This page sets no cookies and uses no analytics.` Right: `© 2026
  rightnow-ai contributors` (from LICENSE).

## B7. Components

### B7.1 Buttons

| Variant | Spec |
|---|---|
| Ink (primary) | 44px tall (hero 48px), padding 0 20px, radius 6px, `--primary` bg, `--primary-fg` text 15px/500, icon 18px gap 8px. Hover `--primary-hover` (`--dur-1`). Active `translateY(1px)`. On bands: `--band-fg` bg, `#121210` text. |
| Outline | Same size, transparent bg, 1px `--border-strong`, `--fg` text. Hover `--hover` bg. On bands: `--band-line` border, `--band-fg` text, hover `--band-surface`. |
| Text link | `--signal` (band: `--band-signal`), underline on hover and always inside paragraphs (`text-underline-offset: 3px`). Trailing `→` is decorative (`aria-hidden`). |
| Icon button | 36px (44px below 1024), radius 6px, transparent, hover `--hover`, requires `aria-label`. |
| Copy button | 32px tall, `small` mono "Copy", 1px border; on success text becomes "Copied" with a check for 1600ms and an `aria-live="polite"` region announces "Copied to clipboard". Uses `navigator.clipboard.writeText`; on failure selects the text and shows "Press Ctrl+C". |
- Focus (all): `outline: 2px solid var(--signal); outline-offset: 2px` on `:focus-visible` (band: `--band-signal`).
- External links (GitHub) open in the same tab (no `target=_blank`).

### B7.2 Section heading block

Eyebrow (mono 12px, `--fg-muted`, preceded by a 6px `--signal` square), 12px gap, H2 two-tone, 16px gap, lead
(max 680px). Left-aligned at all sizes except the hero and final CTA (centred).

### B7.3 Cards

`--surface`, 1px `--border`, 12px radius, 24px padding (20px on sm), no shadow. Kraft panels: `--kraft`, no border,
20px radius, 40px padding (20px sm). Band cards: `--band-surface`, 1px `--band-line`.

### B7.4 GitHub star pill

Nav pill: 32px tall, 1px `--border-strong`, radius 9999px, GitHub mark 16px + `Star` + count in mono. The count is
fetched once per page view from `https://api.github.com/repos/AnalyticDog13/rightnow-ai` (`stargazers_count`), with
a 3s timeout, cached in `sessionStorage` for 1 hour (try/catch). Shown as e.g. `★ 42` with `title="GitHub stars,
fetched live"` and accessible name "Star rightnow-ai on GitHub, 42 stars". On any failure, or while loading, the pill
shows only `Star on GitHub` (no number, no placeholder number). Link → repo. This is the only third-party request on
the page.

### B7.5 Tabs

WAI-ARIA tabs: `role="tablist"` / `tab` / `tabpanel`, roving tabindex, Left/Right arrows move and activate, Home/End.
Visual: 36px tall text tabs, 14px/500, inactive `--fg-muted`, active `--fg` with a 2px `--signal` underline that
slides between tabs (`--dur-2`, `--ease-out`; transform on a single indicator element). Small image-switcher tabs in
step panels use the same component at 32px. Panels crossfade (opacity `--dur-2`). Reduced motion: instant.

### B7.6 Code blocks

- Block: `--surface-sunken` body (band: `#0E0E0C` body inside a `--band-surface` card), 12px radius, header row 36px
  with a mono label (e.g. `bash`, `.env`) and the Copy button right. Code `code` style, padding 16px 20px,
  `overflow-x: auto` on the `<pre>` only, `tabindex="0"` and `aria-label` on scrollable pre. Comments in
  `--fg-subtle`, prompt `$ ` rendered via CSS `::before` (not copied). Copy copies exactly the commands, without
  prompts or comments-only lines.
- Single-line variant (hero): 48px tall input-like box, 1px `--input` border, 8px radius, `$` prefix, line in mono
  14px, Copy button inside right. On mobile the line scrolls inside the box; the box never widens the page.

### B7.7 Screenshot frame

`--surface`, 1px `--border`, 12px radius, `overflow: hidden`, title bar 32px `--surface-sunken` with three 8px hollow
circles (1px `--border-strong`; neutral, not traffic-light colors) and a centred mono 11px `--fg-subtle` label
(`localhost:3000/dashboard` for local shots). The image fills the rest at its intrinsic aspect ratio
(`aspect-ratio` set from width/height). Placeholder background `--surface-sunken` while loading. Shadow per B4.3 only
for the hero frame. Inside kraft panels the frame has no shadow.

### B7.8 Comparison table

Full-width table, `small`-size body 15px, header row mono eyebrow style, row header `<th scope="row">` 600, 1px
`--border` rows, first data column has `--signal-tint` background (L) / `--signal-tint` (D). Below 768: the table
sits in a `div role="region" aria-label="Comparison table" tabindex="0"` with `overflow-x: auto` and a min-width of
560px; the page itself never scrolls sideways.

### B7.9 Postmark

Inline SVG, 112px (hero), 96px (final CTA), 56px (simulator "sent" nodes). Two concentric circles (2px and 1px,
`--fg`), ring text on a `<textPath>` (Plex Mono 500, 9px at 112px scale, letter-spacing 0.12em), centre date in mono
13px/600 over a 1px rule. Rough ink edge via a tiny `feTurbulence` + `feDisplacementMap` filter (scale 1.5) and
`opacity: 0.88`. Decorative: `aria-hidden="true"` (the date is not information). **Thunk**: on first intersection,
`transform: scale(1.25) rotate(-14deg); opacity: 0` → `scale(1) rotate(-8deg); opacity: .88`, 260ms
`--ease-stamp`; at 240ms the element it sits on gets a 120ms `translateY(1px)` and back (the "press"). Never loops.
Reduced motion: final state.

### B7.10 Cancellation wave

Inline SVG `viewBox="0 0 240 24"`, five sine paths (amplitude 2.5, wavelength 24, 4px apart vertically), stroke
`--signal` 1.5px, `preserveAspectRatio="none"`, positioned under the phrase with `position:absolute; inset-inline:0;
bottom: -0.18em; height: 0.32em`. Draw-in: `stroke-dasharray` = path length, offset → 0, 700ms `--ease-out`, each
path 60ms later. Also used as a 1px-tall section divider variant (one path, `--border-strong`) between B6.2 and B6.3
and above the footer. `aria-hidden`.

### B7.11 FAQ item

`<details>` with `<summary>` as a 56px row (plain summary text styled 17px/600; no heading element inside the
summary, so the outline stays clean), a plus icon that rotates 45deg on open (`--dur-2`), 1px `--border` between
items, answer `body` with 24px bottom padding, max 720px. All closed by default; multiple can be open. Native
keyboard behaviour; no JS.

### B7.12 Sample-data label

Wherever simulated or sample data appears: a chip `SAMPLE DATA` (mono 11px 500, 0.06em, `--neutral-tint` bg,
`--neutral-fg` text 7.80:1, radius 4px, 2px 6px padding) in the top-right of the demo card, plus the visible caption
text specified per section. Required on: hero meter and reply card (caption), simulator, inbox demo, planner chart
("Your inputs × the app's defaults" chip instead), pipeline diagram (caption).

## B8. Signature interactive pieces

All four are vanilla JS ES modules, progressively enhanced: without JS, each shows a static, complete fallback (the
final state or a table) so the page is never empty. Each lives in its own file (B12) and initialises when its
section is within 600px of the viewport (IntersectionObserver), so the hero is not delayed. None makes any network
request.

### B8.1 Sequence simulator: "Follow one lead through a campaign"

**Purpose:** teach the real stop rules, same-mailbox follow-ups, the freshness gate and unsubscribe handling, by
playing them out. Honest framing visible in the card footer: `A simulation of rightnow-ai's rules with sample
data. In the app these happen on your schedule, minutes or days apart.`

**Sample campaign (fixed):** name `Harbor Ops intro (sample)`, mailbox `maya@outreach-one.example`, lead `Dana Reyes
· Harbor Ops · dana@harbor-ops.example`, schedule `Mon-Fri 09:00-17:00` (the app's default office hours,
`packages/core/src/campaigns/schema.ts` `officeHours: { days: 62, from: "09:00", to: "17:00" }`).
Steps (timeline nodes):
- Step 1, Day 0: subject `Quick question about Harbor Ops`, body preview `{{RANDOM | Hi | Hello}} {{firstName}},`
  rendered as `Hi Dana,` (variant A) or `Hello Dana,` (variant B; chosen at random each play and shown).
- Wait 3 days.
- Step 2, Day 3: `Re: Quick question about Harbor Ops` (same thread).
- Wait 4 days.
- Step 3, Day 7: `Re: Quick question about Harbor Ops`.
Delays are sample values (in the app every delay is set by you).

**Controls:** scenario radio group (`role="radiogroup"`, label "What does Dana do?"), buttons `Play` (ink) /
`Pause` (toggles), `Step` (outline, advance one event), `Reset` (text). Default scenario: "Replies interested".

**Scenarios and their event scripts** (each line is one event; `t` is the simulated clock shown in the ledger):

| Scenario (label) | Events |
|---|---|
| No reply | D0 09:41 Step 1 sent from maya@… (quota reserved: 1 of 30) · D3 10:12 Step 2 sent from maya@… (same mailbox, same thread) · D7 09:58 Step 3 sent from maya@… · D7 Sequence complete. Lead status: Completed. |
| Replies "interested" | D0 09:41 Step 1 sent · D3 10:12 Step 2 sent · D4 08:03 Reply received ("Sounds good, can you send times for next week?") · D4 08:04 Mailbox synced → reply matched to the thread · Labelled **Interested** by the rule classifier · Step 3 cancelled (stop on reply) · Deal opened in CRM: stage **Interested**, campaign Harbor Ops intro · Automation "When a lead replies interested" can move the stage or call a webhook (`lead_interested`). |
| Out-of-office | D0 09:41 Step 1 sent · D0 09:42 Auto-reply received ("I'm away until Monday") · Labelled **Out of office**, counted apart from real replies · Sequence continues (stop on auto-reply is off by default; you can turn it on per campaign) · D3 10:12 Step 2 sent · D7 09:58 Step 3 sent · Complete. |
| Hard bounce | D0 09:41 Step 1 sent · D0 09:43 Bounce received (550 5.1.1 user unknown) · Classified **hard bounce** · Lead stopped; remaining steps cancelled · Counts toward the mailbox's bounce rate. If bounces pass the workspace threshold (3% by default) the mailbox slows down automatically. |
| Asks to unsubscribe | D0 09:41 Step 1 sent · D3 10:12 Step 2 sent · D3 13:20 Reply "please unsubscribe me" · Labelled **Unsubscribe** · Address suppressed and sequences stopped in the same transaction · Dana is never emailed again from this workspace. |
| Laptop asleep | D0 09:41 Step 1 sent · D2 18:00 Laptop sleeps (nothing syncs or sends) · D3 Step 2 is due, but the app is asleep · D3 11:30 Dana replies while the laptop is asleep · D4 09:05 Laptop wakes · Mailbox must sync before it can send (last sync is older than 5 minutes) · D4 09:06 Sync finds Dana's reply → labelled **Interested** · Step 2 cancelled: nothing was sent late or twice. |

Sources: stop on reply `Campaign.stopOnReply @default(true)`, stop on auto-reply `stopOnAutoReply @default(false)`
(`packages/db/prisma/schema.prisma`); reply categories `ReplyCategory` enum (INTERESTED, MEETING_REQUESTED,
NOT_INTERESTED, WRONG_PERSON, NEUTRAL, OUT_OF_OFFICE, UNSUBSCRIBE, AUTOMATED, UNCERTAIN); auto deal
`Workspace.crmAutoOpportunity @default(true)` and PS-CRM-03/07; bounce threshold `bounceThresholdPct @default(3)`,
`healthSlowdownPct @default(50)`; unsubscribe same-transaction: COMPLIANCE.md; freshness gate
`SYNC_MAX_STALENESS_SEC=300`; daily limit 30 = new-account default (`open-account.ts` `Math.min(30, max)`).
The quota text "1 of 30" appears only on step 1 in "No reply" to show reservation once; do not repeat it.

**Visual:** horizontal timeline at lg (3 step nodes as 160px cards connected by a 1px `--border-strong` line with
"wait 3 days" / "wait 4 days" mono labels on the line); vertical at sm. Node states: `planned` (dashed border,
`--fg-subtle` text), `sent` (solid border, 56px postmark thunks onto the node's corner, mono "sent 10:12"), `cancelled`
(neutral pill "Cancelled", text struck through with `text-decoration-thickness: 1px`), `due while asleep` (warning
pill "Due, app asleep"). A lead token (24px circle, initials "DR", `--signal` ring) moves along the line to the
current event's node (transform, 400ms `--ease-out`). Right/below: the **ledger**, an `<ol>` of events, each a row
with mono timestamp (`D3 10:12`), text, and a pill when labelled; new rows fade in (160ms). Final row gets a
summary chip (e.g. `Outcome: deal opened, 1 step cancelled`). A small CRM card appears under the timeline in the
"interested" outcomes (stage pill `Interested`, value `—`).

**Timing:** Play advances one event every 1100ms; Pause stops; reaching the end shows `Play again`. Auto-play
starts once when the section first becomes 50% visible and only for the default scenario; changing scenario resets
and waits for Play. Reduced motion: no auto-play; Play renders all events at once with the final state; token jumps.

**Accessibility:** the ledger is `aria-live="polite"` (`aria-atomic="false"`) so each new event is announced once;
controls are real buttons; the radio group uses native `<input type="radio">`. Timeline nodes are `<li>` with
visually hidden state text ("Step 2, cancelled").

**No-JS fallback:** the default scenario's full ledger as a static `<ol>` and the timeline in its final state.

### B8.2 Unified inbox + CRM demo

**Purpose:** show one inbox across mailboxes, rule labels, manual correction and the hand-off to the CRM.
Footer line: `Sample threads. In the app, replies arrive through each mailbox's sync and the labels come from
rules you can correct; optional AI labelling is off by default.`

**Data (6 sample threads, fictional, `.example` domains):**

| # | From | Company | Via mailbox | Subject | Snippet | Initial label | Step/variant |
|---|---|---|---|---|---|---|---|
| 1 | Dana Reyes | Harbor Ops | maya@outreach-one.example | Re: Quick question about Harbor Ops | Sounds good, can you send times for next week? | Interested | step 2 · B |
| 2 | Tomás Okafor | Fernway Logistics | jon@outreach-two.example | Re: Shipping audits | I'm out of the office until Monday 3 Nov. | Out of office | step 1 · A |
| 3 | Priya Nair | Lattice Dental | maya@outreach-one.example | Re: Front desk follow-ups | Not for us right now, thanks. | Not interested | step 3 · A |
| 4 | Sam Whitlock | Northgate Studio | ops@mail.outreach-three.example | Re: Studio bookings | Please remove me from your list. | Unsubscribe | step 2 · A |
| 5 | Lena Fischer | Brightwater Labs | jon@outreach-two.example | Re: Lab scheduling | Can we do a call Thursday at 2? | Meeting requested | step 2 · B |
| 6 | Auto-notify | Kestrel Freight | maya@outreach-one.example | Automatic reply: Kestrel Freight | Thanks for your message. This mailbox is not monitored. | Automated | step 1 · B |

**Inbox list:** filter chips (`All 6`, `Interested`, `Meeting requested`, `Out of office`, `Unsubscribe`, `Other`),
rows 64px: avatar initials, name 14/500, subject 13 `--fg-muted` (one line, ellipsis), label pill (semantic colors:
Interested and Meeting requested `success`, Out of office `info`, Not interested and Automated `neutral`,
Unsubscribe `danger`), mailbox meta mono 11px. Unread rows have a 6px `--signal` dot and 600 name. Selected row:
`--signal-tint` + 3px `--signal` left stripe (DESIGN_SPEC B2.8 signal stripe).

**Arrival:** the list starts with threads 3, 6 (read). When the demo is 50% visible, threads 1, 2, 4, 5 arrive one by
one every 2400ms at the top (slide down 8px + fade, 220ms), each with a mono toast-like line above the list:
`Synced maya@outreach-one.example · 1 new reply`. After all 6, arrival stops (no loop). A `Pause` button (top right)
stops arrival; hovering or focusing inside the demo pauses it too. Reduced motion: all 6 present at load, no
arrival.

**Thread view:** header with subject, label pill and a `Label` menu button (menu of the categories `Interested`,
`Meeting requested`, `Not interested`, `Wrong person`, `Neutral`, `Out of office`, `Unsubscribe`, `Automated`;
`role="menu"`, arrow keys, Esc); lead panel line: `Dana Reyes · Harbor Ops · from step 2, variant B · sent by
maya@outreach-one.example`; message bubbles: our sent step (ink outline) and their reply (surface); a disabled-looking
composer with placeholder `Reply from maya@outreach-one.example` and a `Reply` button that, in the demo, shows an
inline note `In the app this sends from the same mailbox, in the same thread.` (it does not pretend to send).

**CRM strip:** five Kanban columns (from the app's default stages, PS-CRM-02, the middle of the pipeline): `Replied`,
`Interested`, `Meeting Scheduled`, `Proposal Sent`, `Closed Won`. Initially thread 1's card sits in `Interested`.
Rules (from the mapping in PS-CRM-03): relabelling a thread to `Interested` creates/moves its card to `Interested`;
`Meeting requested` → `Meeting Scheduled`; `Not interested`, `Unsubscribe`, `Wrong person`, `Out of office`,
`Automated`, `Neutral` → no card (a card that existed is removed with a 160ms fade and a note `Not interested: no
deal`). Thread 5 starts with a card in `Meeting Scheduled` once it arrives. Cards: name, company, mono `from Harbor
Ops intro`, value `—`. Cards are also draggable between columns with pointer and by keyboard (focus card, Space to
lift, Left/Right to move, Space to drop, Esc cancels; `aria-live` announces "Moved to Proposal Sent").
Column headers show count. Unsubscribe relabel also shows a note `Unsubscribe: address suppressed, sequences
stopped.`

**No-JS fallback:** the 6 threads as a static list with labels and the CRM strip with the two cards.

### B8.3 Postage-meter capacity planner: "How much can you send?"

**Purpose:** let the reader plan volume from their own inputs with the app's real defaults. It is the AppFlowy
calculator idea (appflowy §12.5) with honest numbers.

**Constants (decisions, from the code):**

| Constant | Value | Source |
|---|---|---|
| Default provider cap per tier | Google Workspace 1500, Gmail 400, Microsoft 365 5000, Outlook.com 250, SMTP 100 | `packages/core/src/accounts/factory.ts` `TIER_CAP` |
| Highest daily limit per mailbox | `floor(cap / 2)`: 750, 200, 2500, 125, 50 | `factory.ts` `maxDailyLimit`; LOCAL.md table |
| New mailbox daily limit | `min(30, highest)` → 30 for all tiers | `packages/core/src/accounts/open-account.ts` |
| Slow ramp-up (optional, off by default) | `2 + 2 × days since connect` | `schema.prisma` `slowRamp @default(false)`, `rampStartVolume @default(2)`, `rampIncrementPerDay @default(2)`; `packages/core/src/quota.ts` `effectiveAllowance` |
| Gap between sends (per mailbox, campaign defaults) | at least 540 s plus 0-300 s random (average 690 s) | `schema.prisma` Campaign `minGapSec @default(540)`, `randomGapSec @default(300)`; `packages/core/src/dispatch.ts` |
| Default schedule | Mon-Fri 09:00-17:00 | `packages/core/src/campaigns/schema.ts` `officeHours` |
| Warm-up defaults (off until you enable it) | start 1 a day, +1 a day, up to 10 a day; never above 50 or `floor(cap / 10)`; every day (weekdays-only off) | `packages/core/src/deliverability/warmup-settings.ts` `WARMUP_DEFAULTS`; `warmup.ts` (`Math.min(v, 50, Math.floor(a.providerCap / 10))`) |

**Inputs (with defaults):**
1. Mailboxes by type: five steppers (− n +, 0-50, `<input type="number">` with buttons): Google Workspace **3**, Gmail
   (gmail.com) 0, Microsoft 365 0, Outlook.com 0, Other IMAP/SMTP 0.
2. Daily limit per mailbox: range slider 1-200, default **30**, value shown in mono; helper `The app starts new
   mailboxes at 30 a day.` When the value exceeds a selected tier's highest daily limit, that tier is clamped and a
   note appears: `Clamped to 50 for SMTP: the app never allows more than half the provider's cap.` (exact per tier).
3. Slow ramp-up: switch, default **off**, helper `Optional per mailbox in the app: 2 on day one, then +2 a day.`
4. Sending days: seven toggle chips (Mon-Sun), default **Mon-Fri**.
5. Sending hours: two selects (00:00-24:00 in 30-min steps), default **09:00** to **17:00**. If `to <= from`, show
   inline error `End time must be after start time` and keep the last valid result.
6. Warm-up before launch: segmented `None / 2 weeks / 3 weeks / 4 weeks`, default **2 weeks** (README: "give it 2 to 4
   weeks").
7. Campaign size: leads (number input, default **1,000**, 1-1,000,000) and steps per lead (stepper 1-10, default **3**).

**Formulas** (day `d = 0` is the day you connect; launch day `L = 7 × weeks of warm-up`; days are the reader's local
calendar days starting today):
- `windowSec = (to − from)` in seconds; `pace = floor(windowSec / 690)`.
- For tier `t`: `limit_t = min(dailyLimit, floor(TIER_CAP[t] / 2))`.
- `ramp(d) = slowRamp ? 2 + 2 × d : ∞`.
- `campaignCap_t(d) = isSendingDay(d) && d ≥ L ? min(limit_t, ramp(d), pace) : 0`.
- `campaign(d) = Σ_t count_t × campaignCap_t(d)`.
- `warmup_t(d) = min(10, 1 + d, 50, floor(TIER_CAP[t] / 10))` (every day; shown as a separate series, not added to
  campaign volume).
- `warmupTotal(d) = Σ_t count_t × warmup_t(d)`.
- Total campaign sends needed `N = leads × steps`. Finish estimate: the first day `D` where `Σ_{d=L}^{D}
  campaign(d) ≥ N`; show as a date (`Thu 4 Dec`) and as "N sending days". If no mailboxes or `pace = 0`: show `Add a
  mailbox and a sending window to see a plan.` Cap the search at 3 years and show `More than 3 years at this
  volume.` beyond that.

**Outputs:**
- The **meter**: big mono number `campaign(L)` (`/ day on launch day`), and `at full pace` = max over the 60-day
  horizon, rendered as the app's send-meter bar: `campaign(L) / maxCampaign`.
- Three mono stat tiles: `Launch day` (date + sends), `Day 30` (sends), `Per week at full pace` (sum of a 7-day
  window once all ramps are complete).
- `Your campaign: 1,000 leads × 3 steps = 3,000 emails` → `about N sending days, done around <date>` and the
  honest note in `small`: `A lower bound: follow-up delays, replies (which stop sequences), bounces, health
  slow-downs and provider limits change the real pace.`
- **Chart:** inline SVG bar chart, 60 days, one bar per day (`--chart-1`, 0 on non-sending days shown as a 1px
  baseline tick), warm-up as a stepped line (`--chart-2`, 1.5px, with square markers every 7 days so it works
  without color), a vertical dashed `--fg-muted` line at launch day labelled `Launch`. Axis ticks every 7 days
  (mono 11px). Height 200px (160 on sm). Hover/focus a bar (bars are not focusable; a range slider "Inspect day"
  under the chart, keyboard friendly) shows `Day 12 · Fri 14 Nov · campaign 90 · warm-up 30`. A visually hidden
  `<table>` (and a `Show as table` toggle) lists the same 60 rows.
- **"Right now" line** (the brand joke, top of the planner, mono `small`): `Right now it's Thu 14:32 where you are:
  inside your sending window.` / `... outside your sending window. Next window opens Mon 09:00.` computed from the
  reader's clock and the chosen days/hours. Updates every 60s while visible.
- Chip `YOUR INPUTS × THE APP'S DEFAULTS` (B7.12 style) at the card's top right. Footer `small`: `Defaults are read
  from the rightnow-ai source (factory.ts, quota.ts, warmup-settings.ts). The app also applies health and re-warm
  limits you can't see here.` with links to those files on GitHub.

**Behaviour:** recompute on every `input` event (debounced 50ms), no layout shift (fixed heights), numbers update
instantly (no count-up), the bar width transitions 160ms. Inputs keep their state in the URL hash? No (decision: not
needed). Reduced motion: no bar transition.

**Layout:** one `--surface` card on the kraft background, 12px radius, 32px padding. lg: inputs left (380px), outputs
right. sm: inputs first, outputs after, chart full width; steppers 44px touch targets; the 7 day chips wrap in two
rows if needed.

**Self-check (required, small):** `site/assets/js/planner.js` exports a pure `plan(inputs, today)` function
(`today` is a `Date`; the UI passes the current date), and `site/tests/planner.test.html` (not linked, `noindex`,
disallowed in robots) runs `console.assert` checks when opened, all with `today = Monday 2026-11-02`:
(a) defaults (3 Workspace, 30, ramp off, Mon-Fri 09-17, 2 weeks, 1,000 × 3) give `L = 14`, `campaign(14) = 90` and
`N = 3000` finishing after 34 sending days; (b) SMTP with limit 200 clamps to 50; (c) ramp on gives
`campaignCap(0) = 2` with `L = 0`; (d) 09:00-10:00 gives `pace = 5`; (e) warm-up for Outlook.com day 20 is 10, for SMTP
is 10 (cap 100/10). Pass = no assertion errors in the console.

**No-JS fallback:** a static result for the defaults ("3 Google Workspace mailboxes at 30 a day: 90 emails per
sending day after a 2-week warm-up. 3,000 emails take about 34 sending days.") and the constants table above as a
visible `<table>`.

### B8.4 Step-through setup terminal and `.env` generator

**Purpose:** let an engineer judge the effort and copy the exact commands (from: appflowy §2.7, §12.2; resend
§12.1; firecrawl §12.1). It is a scripted walkthrough, not a shell: header label `Walkthrough, not a live terminal`.

**Frame:** `--band-surface` card, 12px radius, title bar with three hollow dots and tabs `Laptop` / `VPS` (B7.5 on
band colors), body `#0E0E0C` on a dotted grid, mono 14px. Left of the body (lg) a step list (`01 Clone`, `02
Configure`, `03 Start`, `04 Sign up`; VPS adds `00 Server and DNS` first and `05 Back up nightly`) as buttons; on sm
the list becomes a "Step 2 of 4" header with Prev/Next buttons.

**Laptop steps (exact):**
1. Clone:
   ```
   git clone https://github.com/AnalyticDog13/rightnow-ai.git
   cd rightnow-ai
   ```
2. Configure: `cp .env.example .env` then the `.env` panel (below) showing:
   ```
   MODE=local
   APP_URL=http://localhost:3000
   ENCRYPTION_KEY=<openssl rand -base64 32>
   BETTER_AUTH_SECRET=<openssl rand -base64 32>
   SETUP_TOKEN=<16+ random characters>
   ```
   comment line: `# Back up ENCRYPTION_KEY with your database.`
3. Start: `scripts/start.sh` with a sibling line `# Windows (PowerShell): scripts\start.ps1` and `# The first build
   takes a few minutes.`
4. Sign up: `# Open http://localhost:3000/sign-up and create the owner with your SETUP_TOKEN.` and `# Always use
   the exact host in APP_URL (localhost, not 127.0.0.1).` Finish state: a 96px postmark thunks onto the terminal's
   corner with centre text `RUNNING` (instead of the date) and the line `# Next: connect a mailbox under Accounts.`

**VPS steps (exact):**
0. Server and DNS: `# A Linux VPS with Docker Engine + Compose and git (1 vCPU / 2 GB RAM).` `# Point an A record
   for app.example.com at the server, then:` and `ufw allow 22,80,443/tcp && ufw enable`
1. Clone: same as laptop.
2. Configure: `cp .env.example .env` and:
   ```
   MODE=vps
   DOMAIN=app.example.com
   APP_URL=https://app.example.com
   ENCRYPTION_KEY=<openssl rand -base64 32>
   BETTER_AUTH_SECRET=<openssl rand -base64 32>
   SETUP_TOKEN=<16+ random characters>
   POSTGRES_PASSWORD=<openssl rand -hex 24>   # set before the first start
   ```
3. Start: `scripts/start.sh` + `# MODE=vps adds Caddy, which gets a Let's Encrypt certificate automatically.`
4. Sign up: `# Open https://app.example.com/sign-up and create the owner with your SETUP_TOKEN.`
5. Back up nightly:
   ```
   0 3 * * * cd /home/you/rightnow-ai && mkdir -p backups && scripts/backup.sh >> backups/cron.log 2>&1 && find backups -name '*.dump' -mtime +14 -delete
   ```
   + `# Copy backups/ off the server and keep ENCRYPTION_KEY somewhere separate.`
(Sources: README §1, LOCAL.md First run, VPS.md §1-§3, `.env.example`, `scripts/start.sh`, `docker-compose.yml`
caddy `profiles: ["vps"]`.)

**Typing:** when a step becomes active, its command lines type at 14ms per character (max 900ms per step; longer
lines appear in chunks), comments appear instantly; a blinking block caret (1s steps) at the end, stopping when
typing ends. Next/Prev or clicking a step jumps instantly (typing is skipped if the user navigates). No auto-advance
between steps. Reduced motion: no typing, no caret blink. Each step has its own Copy button (copies that step's
commands only, no comments) and the tab has `Copy all steps`.

**`.env` generator** (in step 2): a button `Generate secrets in this browser` that fills `ENCRYPTION_KEY` and
`BETTER_AUTH_SECRET` (each: base64 of 32 bytes from `crypto.getRandomValues`), `SETUP_TOKEN` (24 hex chars from 12
random bytes) and, on the VPS tab, `POSTGRES_PASSWORD` (48 hex chars from 24 bytes, URL-safe as `.env.example`
requires). A text field `Your domain` (VPS only, default `app.example.com`, validated as a hostname) fills `DOMAIN`
and `APP_URL`. Then `Copy .env` copies the full block. Microcopy under it (`small` band-muted): `Generated with your
browser's crypto.getRandomValues. Nothing is sent anywhere; this page has no server. Prefer the terminal? Run
openssl rand -base64 32.` Secrets are never written to storage, the URL or the console; generating again replaces
them; leaving the tab clears nothing (no persistence anyway). Self-check in `site/tests/planner.test.html` (same
file, second block): generated base64 decodes to 32 bytes; token lengths 24 and 48.

**No-JS fallback:** the Laptop steps as four static code blocks; no generator.

## B9. Motion inventory (all of it)

| Element | Trigger | Animation | Duration / easing | Loops | Pause | Reduced motion |
|---|---|---|---|---|---|---|
| Section reveal | first 15% intersection | fade + 12px rise, 60ms stagger | 600ms / ease-out | no | - | none, visible |
| H1 wave | load | stroke draw | 700ms / ease-out, +300ms | no | - | drawn |
| Hero meter bar | frame visible | width 0→47.3% | 600ms / ease-out | no | - | final |
| Postmarks | first intersection | thunk + press | 260ms + 120ms / ease-stamp | no | - | final |
| Tabs indicator | tab change | translateX/width | 160ms / ease-out | no | - | instant |
| Rail active marker | scroll-spy | color + bar | 160ms | no | - | instant |
| Pipeline dot | band in view | moves along path | 3.2s linear, 400ms dwell | yes, while in view | "Pause animation" button | no dot |
| Simulator | Play / once on 50% view (default scenario) | token move, rows fade | 1100ms per event; 400ms move | no | Pause button | all at once |
| Inbox arrivals | 50% view | slide 8px + fade | 2400ms apart, 220ms each | no (4 arrivals) | Pause button, hover/focus | all present |
| Terminal typing | step activation | characters | 14ms/char, max 900ms | caret only while typing | navigate to skip | none |
| Planner bar | input | width | 160ms | no | - | instant |
| Menu (mobile) | button | height + opacity | 220ms / ease-out, close 154ms ease-in | no | - | instant |

Only the pipeline dot loops, and it has a pause control and runs only in view (WCAG 2.2.2). All animation uses
`transform`/`opacity`/`stroke-dashoffset` (no layout properties). Off-screen work stops (IntersectionObserver).

## B10. SEO

### B10.1 Origin constant

The site origin is the placeholder `https://rightnow-ai.vercel.app` (no trailing slash in the constant; URLs add
`/`). It is written literally (no build step) in: every page's `<link rel="canonical">`, `og:url`, `og:image`,
`twitter:image`, the JSON-LD `@id`/`url` fields, `sitemap.xml` and `robots.txt`. `site/README.md` documents it as the
one value to change, with the command:
`grep -rl "https://rightnow-ai.vercel.app" site | xargs sed -i "s#https://rightnow-ai.vercel.app#https://YOUR-ORIGIN#g"`
(PowerShell equivalent also given). Asset paths in HTML are relative (`assets/...`, `../assets/...`) so the site
works when copied into another site's subfolder; only the SEO URLs above are absolute (they must be).

### B10.2 Per-page head

`<html lang="en">`, `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`,
`<meta name="theme-color" content="#F8F7F4" media="(prefers-color-scheme: light)">` and `#121210` for dark,
`<meta name="robots" content="index, follow">` (404 and tests: `noindex, nofollow`), `<meta name="color-scheme"
content="light dark">`.

| Page | `<title>` (chars) | Meta description (chars) | Canonical |
|---|---|---|---|
| `/` | `Self-Hosted Cold Email Software, Open Source \| rightnow-ai` (57) | `rightnow-ai is free, open-source (MIT) cold email software you self-host: mailbox warm-up, campaigns, a unified inbox and a CRM. An Instantly alternative.` (156) | `https://rightnow-ai.vercel.app/` |
| `/self-host/` | `Self-Host rightnow-ai: Docker and VPS Setup Guide` (49) | `Run rightnow-ai, the open-source cold email platform, on your laptop with Docker Compose or on a VPS with Caddy HTTPS. Requirements, .env, backups, upgrades.` (157) | `https://rightnow-ai.vercel.app/self-host/` |
| `/instantly-alternative/` | `Open-Source Instantly Alternative, Self-Hosted \| rightnow-ai` (60) | `Compare rightnow-ai, a free self-hosted cold email platform, with hosted tools like Instantly, Smartlead and lemlist: hosting, data, cost model and features.` (157) | `https://rightnow-ai.vercel.app/instantly-alternative/` |

Open Graph / Twitter on every indexable page: `og:type website`, `og:site_name rightnow-ai`, `og:title` = title
without the `| rightnow-ai` suffix, `og:description` = meta description, `og:url` = canonical, `og:image
https://rightnow-ai.vercel.app/assets/og.png`, `og:image:width 1200`, `og:image:height 630`, `og:image:alt
"rightnow-ai: open-source cold email you run yourself"`, `og:locale en_US`; `twitter:card summary_large_image`,
`twitter:title`, `twitter:description`, `twitter:image`, `twitter:image:alt` (same). No `twitter:site` (no account).

### B10.3 OG image

`site/assets/og.png`, 1200x630, PNG, <= 150KB. Generated once from `site/tools/og-template.html` (a 1200x630 page
using the site CSS tokens and fonts) with Playwright: `npx playwright screenshot --viewport-size=1200,630
site/tools/og-template.html site/assets/og.png` (served via a local static server so fonts load), committed.
Design: `--bg` paper, 64px padding, blueprint rails; top-left logo (inverted, 56px) + wordmark; H1 `Open-source cold
email you run yourself.` at 64px/600 over two lines with the teal wave under "run yourself"; below, mono 22px
`--fg-muted`: `SELF-HOSTED · MIT · GMAIL · MICROSOFT 365 · IMAP/SMTP`; right side: the postage-meter card (`SENT
TODAY 142 / 300`, labelled `sample`) and a 160px postmark with `SELF-HOSTED` in the centre; bottom-left mono 20px:
`github.com/AnalyticDog13/rightnow-ai`. `tools/` is disallowed in robots and the template has `noindex`.

### B10.4 JSON-LD

One `<script type="application/ld+json">` per page with an `@graph`. Homepage:

```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": "https://rightnow-ai.vercel.app/#website", "url": "https://rightnow-ai.vercel.app/",
      "name": "rightnow-ai", "inLanguage": "en", "publisher": { "@id": "https://rightnow-ai.vercel.app/#maintainer" } },
    { "@type": "Person", "@id": "https://rightnow-ai.vercel.app/#maintainer", "name": "AnalyticDog13",
      "url": "https://github.com/AnalyticDog13" },
    { "@type": "SoftwareApplication", "@id": "https://rightnow-ai.vercel.app/#software", "name": "rightnow-ai",
      "description": "Open-source, self-hosted cold email software: mailbox warm-up, multi-step campaigns, a unified inbox, a CRM, analytics and automations.",
      "applicationCategory": "BusinessApplication", "applicationSubCategory": "Cold email and sales engagement",
      "operatingSystem": "Linux, macOS, Windows (Docker)", "isAccessibleForFree": true,
      "license": "https://opensource.org/licenses/MIT",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      "downloadUrl": "https://github.com/AnalyticDog13/rightnow-ai",
      "softwareHelp": "https://rightnow-ai.vercel.app/self-host/",
      "featureList": ["Gmail, Microsoft 365 and IMAP/SMTP mailboxes", "Email warm-up and re-warm-up", "SPF, DKIM, DMARC and blacklist checks", "Multi-step campaigns with A/B variants", "Unified inbox", "CRM pipeline", "Analytics", "Automations, webhooks and REST API"],
      "screenshot": "https://rightnow-ai.vercel.app/assets/screens/dashboard-light-1600.webp",
      "author": { "@id": "https://rightnow-ai.vercel.app/#maintainer" } },
    { "@type": "SoftwareSourceCode", "@id": "https://rightnow-ai.vercel.app/#code", "name": "rightnow-ai",
      "codeRepository": "https://github.com/AnalyticDog13/rightnow-ai", "programmingLanguage": "TypeScript",
      "runtimePlatform": "Node.js, Docker", "license": "https://opensource.org/licenses/MIT",
      "targetProduct": { "@id": "https://rightnow-ai.vercel.app/#software" } },
    { "@type": "FAQPage", "@id": "https://rightnow-ai.vercel.app/#faq", "mainEntity": [ "... the 10 B6.13 Q&As as Question/acceptedAnswer Answer, text identical to the visible answers ..." ] }
  ]
}
```

No `aggregateRating`, `review` or `Organization` logo claims (none exist). `/self-host/`: `WebPage` + `HowTo`
(name `Self-host rightnow-ai with Docker Compose`, steps = the laptop steps, `tool` Docker, git) + the `Person`.
`/instantly-alternative/`: `WebPage` (`about` → SoftwareApplication `@id` reference) + its own FAQPage (its 4 FAQs).
`BreadcrumbList` on both subpages (Home → page). Validate with the Rich Results test and validator.schema.org
(acceptance).

### B10.5 Heading outline and keyword placement

Homepage (one H1; every H2 once; H3s per card/step):
- H1 `Open-source cold email you run yourself.` (open source cold email, self-hosted intent)
- H2 `From mailbox to closed deal. Six steps, all in one app on your server.` → H3 ×6 (`Connect your mailboxes`, `Fix
  your DNS`, `Warm up, or re-warm`, `Import your leads`, `Build the campaign`, `Work the replies`)
- H2 `Follow one lead through a campaign. ...`
- H2 `Every reply in one inbox. The good ones become deals.` (unified inbox, CRM)
- H2 `Everything a cold email platform needs. ...` → H3 ×12 (feature names incl. `CRM`, `Unified inbox`, `Leads`)
- H2 `Built not to burn your domain. ...`
- H2 `Email warm-up, open source and honest about it. ...` (email warm-up open source) → H3 `How much can you send?`
- H2 `Your mailboxes. Your server. Your leads. Running in four commands.` → H3 `Self-hosting means you are the sysadmin.`
- H2 `Deploy it yourself from GitHub. ...` → H3 ×3 + `Why there is no "Deploy to Vercel" button`
- H2 `An open-source alternative to Instantly. And to Smartlead and lemlist, ...` (instantly / smartlead / lemlist
  alternative)
- H2 `Use it responsibly.`
- H2 `Questions about rightnow-ai.`
- H2 `Clone it. Run it. It's yours.`

Keyword placement (natural, no stuffing):
- "self-hosted cold email": title, meta, hero lead ("self-hosted alternative"), B6.9 lead, `/self-host/` title.
- "open source cold email" / "open-source Instantly alternative": H1, title, meta, B6.11 H2, subpage H1.
- "email warm-up open source": B6.7 H2.
- "open-source CRM / self-hosted CRM": B6.5 lead's last sentence (`It is also a small open-source CRM: deals,
  stages, tasks and revenue, on your own server.`) and the CRM feature card h3.
- "Smartlead / lemlist alternative": B6.11 H2 tone span, `/instantly-alternative/#smartlead` and `#lemlist` H2s,
  footer Compare links.
- "lead generation tool open source": deliberately not targeted. rightnow-ai has no lead database, and claiming the
  term would mislead. The `/instantly-alternative/` "What you give up" list says so plainly, which is the only place
  the phrase "lead generation" appears (`rightnow-ai is not a lead generation database`).
- Alt text uses "rightnow-ai <page name>" phrasing.

### B10.6 robots.txt and sitemap.xml

`site/robots.txt`:
```
User-agent: *
Allow: /
Disallow: /tools/
Disallow: /tests/
Sitemap: https://rightnow-ai.vercel.app/sitemap.xml
```
`site/sitemap.xml`: the three indexable URLs with `<lastmod>` = build date (YYYY-MM-DD), no priority/changefreq.

### B10.7 Subpage content (substantive, honest)

**`/self-host/`** (reading column 760px, left sticky TOC at lg, from: firecrawl §6, supabase §12.2): H1 `Self-host
rightnow-ai`. Lead: `rightnow-ai runs only on hardware you control. This guide covers both supported ways: Docker
Compose on your own computer, and the same stack on a Linux VPS with Caddy for HTTPS.` Sections (H2, ids): `Before
you begin` (`#requirements`, a "Section / Check" table, from: coolify §12.2: Docker or Docker Engine + Compose; git;
`openssl` or this page's generator; for VPS: 1 vCPU / 2 GB RAM, a domain, ports 22/80/443; for Gmail/Microsoft: your
own OAuth app), `Run it on your laptop` (`#laptop`, the laptop steps as code blocks + the sleep behaviour + the
tracking limitation + dry-run mode `MAIL_PROVIDER_FAKE=1`), `Run it on a VPS` (`#vps`, VPS.md §1-2 + private hosts
note), `Connect Gmail and Microsoft` (`#mailboxes`, five-line summary per provider with the redirect URIs
`${APP_URL}/api/v1/oauth/google/callback` and `.../microsoft/callback` from `.env.example`, links to the guides; plus
"run `npx tsx scripts/live-verify.ts --account <id> --to <another address of yours>` before the first real
campaign"), `Sending limits per mailbox` (`#limits`, the LOCAL.md table verbatim), `Backups, restore and upgrades`
(`#upkeep`, LOCAL.md daily-use table + key warning + VPS cron + restore pauses campaigns), `Moving from a laptop to a
VPS` (`#move`, VPS.md §3c checklist condensed to the 9 items), `Why not Vercel, Netlify or serverless?` (`#vercel`,
the B6.10 note expanded with the five compose services named), and the reused generator + terminal component (B8.4)
at the top under the lead. CTA at end: `View the code on GitHub`.

**`/instantly-alternative/`** (reading column, from: plausible §12.1, §12.4): H1 `An open-source Instantly
alternative you host yourself`. Lead: `If you like how Instantly, Smartlead or lemlist work but want the software,
the mailboxes' logins and every reply on your own server, rightnow-ai is built for that. Here is an honest look at
what is the same, what is different and what you give up.` Sections: `What rightnow-ai covers` (feature list mapped
to the familiar categories: email accounts, warm-up, campaigns and sequences, leads, unified inbox, CRM, analytics,
automations and API), `What is different` (the B6.11 table + `Free software, your costs` paragraph: server optional
on a laptop, a small VPS otherwise, your mailboxes and domains), `What you give up` (exact list from PRODUCT_SPEC
§19: `No lead database or enrichment: bring your own lists.` · `No done-for-you mailboxes, pre-warmed domains or
domain purchase.` · `No large shared warm-up network: warm-up runs between your own mailboxes; you can add an
outside service.` · `No autonomous AI agents: optional AI only drafts, and a human approves.` · `You run and back up
the server yourself.`), `Smartlead alternative` (`#smartlead`) and `lemlist alternative` (`#lemlist`): two short
sections (2-3 sentences each) stating only that rightnow-ai is a self-hosted option for the same email-outreach job,
that lemlist's multichannel steps (it markets LinkedIn and other channels, lemlist §1) are not in rightnow-ai, which
is email only, and pointing back to the table; `Migrating` (CSV export from your current tool → CSV import with
column mapping and dedupe; no direct importer is claimed), FAQ (4: `Is rightnow-ai affiliated with Instantly?` No,
independent; `Can I import my leads?` CSV; `Will my deliverability be the same?` Depends on your mailboxes, DNS and
sending habits; no tool can guarantee inbox placement; `What does it cost?` The software is free). Non-affiliation
line at the end (B6.12 third paragraph verbatim).

## B11. Accessibility

- WCAG 2.2 AA. All text pairs in B4.1 meet 4.5:1 (body) and 3:1 (large/UI); semantic pills reuse the app's measured
  pairs. Never color alone: pills carry words, the chart has markers and a table, state changes have text.
- Landmarks: `header` (nav), `main#main`, `footer`; each section is a `<section aria-labelledby="<h2 id>">`.
- Keyboard: every control reachable in visual order; tabs, radio groups, menus and the Kanban follow WAI-ARIA APG
  patterns as specced; no keyboard traps; Esc closes menus. Focus visible everywhere (B7.1), never removed;
  `scroll-margin-top: 88px` on targets so the sticky nav does not hide focused anchors.
- Motion: `prefers-reduced-motion` per B9; the one looping animation has a pause button; nothing flashes.
- Screen readers: decorative SVGs `aria-hidden`; meaningful images have the B3 alt; live regions only for the
  simulator ledger, copy confirmations, Kanban moves and planner summary (`aria-live="polite"`, summary text only,
  not every number).
- Touch targets >= 44x44 below 1024px. Text resizes to 200% without loss; layout reflows at 320px wide without
  horizontal scroll (WCAG 1.4.10), even though the design target is 390.
- Language and copy: `lang="en"`, link text describes the destination (no "click here").
- No-JS: every section readable; interactive pieces show their fallbacks (B8).

## B12. Performance budget

| Item | Budget |
|---|---|
| `index.html` | <= 90KB uncompressed (JSON-LD included) |
| CSS (`site.css`, one file) | <= 40KB uncompressed |
| JS total | <= 40KB uncompressed across `theme-init.js` (<= 0.5KB, sync in head), `site.js`, `simulator.js`, `inbox-demo.js`, `planner.js`, `terminal.js` (all `type="module"`, deferred, each lazy-initialised) |
| Fonts | 5 WOFF2 files, latin subset, <= 120KB total; 2 preloaded |
| Hero image | `dashboard-light-1600.webp` <= 140KB, `dashboard-mobile-light-780.webp` <= 70KB |
| Initial transfer (first view, mobile) | <= 400KB |
| Full page (all lazy images) | <= 2.0MB |
| Libraries | None. No framework, no animation or chart library: everything is CSS, inline SVG and small vanilla JS. |
| Third-party requests | Only `api.github.com` for the star count (after load, non-blocking). |
| Lighthouse (mobile, simulated) | Performance >= 95, Accessibility 100, Best Practices >= 95, SEO 100 |
| Core Web Vitals (lab) | LCP <= 2.0s, CLS <= 0.02, INP/TBT: TBT <= 100ms |

Fonts: obtain from `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` (jsDelivr, version 5.x, latin
subset files `*-latin-400-normal.woff2` etc.), commit under `site/assets/fonts/`; IBM Plex is under the SIL Open
Font License: include `site/assets/fonts/OFL.txt`.

Caching (`site/vercel.json`, used only when deployed on Vercel; harmless elsewhere):
```json
{
  "trailingSlash": true,
  "headers": [
    { "source": "/assets/fonts/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=86400" }] },
    { "source": "/(.*)", "headers": [
      { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.github.com; frame-ancestors 'none'; base-uri 'self'; form-action 'none'" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" } ] }
  ]
}
```
Consequence of the CSP: no inline `<script>` (JSON-LD data blocks are allowed), no inline `style=""` attributes and
no `<style>` blocks; everything in `site.css`. SVG `filter` and presentation attributes are fine.

## B13. File and folder structure (`site/`)

```
site/
  index.html
  self-host/index.html
  instantly-alternative/index.html
  404.html
  robots.txt
  sitemap.xml
  vercel.json
  .vercelignore                  assets/screens/*.png and unsuffixed full-size screen WebPs, tools/ is kept (noindex)
  favicon.ico
  README.md                      how to preview locally, deploy to Vercel (root directory: site), change the origin
  assets/
    css/site.css
    js/theme-init.js  site.js  simulator.js  inbox-demo.js  planner.js  terminal.js
    fonts/ibm-plex-sans-latin-{400,500,600}-normal.woff2  ibm-plex-mono-latin-{400,500}-normal.woff2  OFL.txt
    img/rightnow-logo.svg  favicon-32.png  apple-touch-icon.png  icons.svg (sprite: github, copy, check, sun, moon, menu, plus, arrow, feature icons)
    screens/README.md  <source>-1600.webp  <source>-800.webp  (mobile: -780/-390)  (B3; PNG originals excluded by .vercelignore)
    og.png
  tools/og-template.html         noindex, disallowed
  tests/planner.test.html        noindex, disallowed (B8.3, B8.4 self-checks)
```
- Paths inside HTML are relative (`assets/...` on `/`, `../assets/...` on subpages); internal links use relative
  folder links (`self-host/`, `../`, `../#faq`). Preview with any static server from `site/` (e.g. `npx serve site`).
- Vercel: project root directory `site`, framework preset "Other", no build command, output directory `.`.
- Nothing in `site/` is imported by the app; the app's build and tests are unaffected.

## B14. Acceptance checklist (builder and reviewer verify each)

Content and honesty
- [ ] No pricing, plans, trials, "sign up", "start free", "contact sales", waitlist or hosted-demo wording anywhere
      (grep `-i "pricing\|free trial\|sign up\|start free\|contact sales\|waitlist\|book a demo"` returns only the
      FAQ's "no paid edition/plans" sentences and the app's own `/sign-up` path in setup steps).
- [ ] No customer logos, testimonials, user counts, ratings or compliance badges. The only count shown is the live,
      labelled GitHub star count, hidden on failure (test with network blocked).
- [ ] Every number on the page is either sourced in this spec (tests count, defaults) or labelled sample / your input.
- [ ] Every feature mentioned exists in README's feature table or PRODUCT_SPEC; the comparison uses only the
      hedged cells in B6.11 and the "as of October 2026" note.
- [ ] Responsible-use section present with lawful basis, unsubscribe always honored, providers' terms, not legal
      advice, and the non-affiliation sentence; also on `/instantly-alternative/`.
- [ ] Brand appears only as `rightnow` / `rightnow-ai` (grep `-i "rightnow"` and inspect capitals: zero "RightNow",
      zero "rightnow.ai").
- [ ] The Vercel note says the app cannot run on Vercel and why; only `site/` is deployed there.
- [ ] Copy matches B6 verbatim (spot-check H1, hero lead, six step statements, FAQ).

Interactive pieces
- [ ] Simulator: all six scenarios play to the scripted end; Pause/Step/Reset work; ledger announced by a screen
      reader once per event; reduced motion shows the final state instantly.
- [ ] Inbox demo: arrivals stop after 4; relabelling moves/removes CRM cards per the mapping; keyboard drag works;
      Pause and hover-pause work.
- [ ] Planner: `site/tests/planner.test.html` shows no assertion errors; clamp notes appear for each tier; invalid
      hours show the error; the "right now" line matches the device clock; no network requests (DevTools).
- [ ] Terminal: both tabs, every step copyable, copied text has no prompts/comments; generator output passes the
      self-checks; nothing written to storage (DevTools Application tab empty except `rn-theme`).

Responsive (Chrome DevTools at 390x844, 768x1024, 1024x768, 1440x900, 1920x1080)
- [ ] `document.documentElement.scrollWidth === window.innerWidth` at every width, including with the mobile menu open,
      the comparison table, code blocks, the CRM strip and the planner (they scroll inside their own regions only).
- [ ] 390px: H1 at 36px in <= 3 lines; hero CTAs full width and 48px; mobile hero screenshot used; rail hidden and
      steps stacked; all touch targets >= 44px.
- [ ] 320px reflow: no clipped text or controls.

Accessibility
- [ ] Lighthouse Accessibility 100 on all three pages; axe DevTools: 0 violations.
- [ ] Full keyboard pass: skip link, nav, menu, tabs, rail links, simulator, inbox (incl. Label menu and Kanban),
      planner, terminal, FAQ, footer; focus always visible.
- [ ] Contrast spot-checks in both themes for: two-tone H2 grey, captions, band text, warning callout, pills.
- [ ] `prefers-reduced-motion: reduce` (DevTools rendering emulation): no movement anywhere; the pipeline dot absent.
- [ ] Works with JavaScript disabled: all text present, fallbacks shown, no blank sections.

SEO
- [ ] Titles, meta descriptions, canonicals, OG/Twitter tags exactly as B10.2 on each page; `og.png` is 1200x630 and
      <= 150KB; previews render in a social card debugger.
- [ ] JSON-LD validates (validator.schema.org, Google Rich Results: FAQ detected); FAQ JSON-LD text equals the visible
      FAQ text.
- [ ] One H1 per page; outline matches B10.5; no duplicate heading text in the DOM.
- [ ] `robots.txt` and `sitemap.xml` reachable; sitemap lists exactly three URLs; tools/tests pages `noindex`.
- [ ] The origin string `https://rightnow-ai.vercel.app` appears only in the files listed in B10.1 and README.

Performance and tech
- [ ] No build step, no framework, no library files; only `api.github.com` as an external request.
- [ ] Budgets in B12 met (DevTools Network, mobile throttling); Lighthouse mobile Performance >= 95; CLS <= 0.02.
- [ ] All images have width/height, WebP, lazy except the hero; no blur placeholders.
- [ ] Site works served from a subfolder (copy `site/` to `/tmp/x/sub/` and serve `/tmp/x`): all assets load.
- [ ] CSP from `vercel.json` produces no console violations (preview with `vercel dev` or by adding the header in the
      local server).
- [ ] Light and dark themes both correct; the toggle persists per viewer; system preference followed when unset;
      logo inverted correctly in each theme (light mark on ink in light, ink on paper in dark).
- [ ] Screenshots: every B3 shot present and mapped in `site/assets/screens/README.md`, or its acceptance item left
      open with the dashed placeholder frame shown.
