# Customer.io - UI reference

Scope note: the app itself requires login and was not opened. Everything below comes from in-app screenshots embedded in docs.customer.io (images opened at full size) plus computed styles of the docs site. App measurements are estimates from images, marked "(est.)".

## 1. Sources

Pages viewed (docs.customer.io): `/journeys/campaign-metrics/` (redirected to `/messaging/metrics/automation-metrics/`), `/journeys/campaigns-in-customerio/` (redirected to `/messaging/send/automations/overview/`), `/journeys/run-reports/` (redirected to `/messaging/metrics/run-reports/`). Not opened: customer.io product page, people/segment tables, message editor pages.

Full-size screenshots (all in `C:\Users\willi\AppData\Local\Temp\claude\C--Users-willi-OneDrive-Desktop-GitHub-Repositories-rightnow-ai\f8a7d979-9487-46fe-b300-dcca3fab7b2a\scratchpad\screenshots\customerio\`):
- `campaign-overview.png` (source `/images/campaign-overview-may-2025.png`, 2810x1558): automation Overview tab.
- `workflow-metrics.png` (`/images/workflow_metrics.png`): workflow node with metrics plus bottom toolbar.
- `workflow-builder.png` (`/images/campaign-workflow-builder.png`, 1920x1324): builder canvas with the Add panel.
- `analysis-chart.png` (`/images/analysis_chart_view.png`): Reports chart view.
- `analysis-table.png` (`/images/analysis_table_view_3.png`): Reports table view.
- Opened but not studied: `leaderboard.png`.

## 2. Information architecture and navigation

Seen in the builder screenshot (top bar only; the left sidebar was not visible in any image):
- Top bar: breadcrumb `Automations / Re-engage inactive users / Workflow`, then a wide global search field "Search automations, people, docs" with a `⌘K` hint chip (command palette), then "Need help?", a notification bell with a green unread dot, and a settings gear.
- Product vocabulary: the docs call these "Automations" (older URLs say "campaigns"). Channels: Email, Survey, In-App, Inbox, Push, Web Push, SMS, Slack.
- Automation detail page has a back-arrow button, status pill, inline-editable title (pencil), `Follow` dropdown, `Actions` dropdown, and a tab row: Overview, Metrics, Workflow, A/B Tests, Drafts (with a dot indicator for unpublished changes), Sent, Journeys. A right-aligned "Last saved 5 months ago".
- Workspace switcher and the left nav: not observed.

## 3. Visual language

Docs site (measured): font Inter with system fallbacks; h1 30px; page background white (`oklch(1 0 0)`); link colour a warm neutral grey (`oklch(0.51 0.0054 80)`).

App (from images):
- Light theme only seen. Page canvas very light grey (`#F7F8FA` est.) with white cards, 1px light-grey borders (`#E5E7EB` est.), almost no shadow on cards; floating toolbars and panels get a soft shadow.
- Accent: reports use indigo/violet (`#4F3FD6` est.) for active tab underline, links, "Percentage" segmented toggle, sort headers. Builder uses teal for primary (`#2A8C8C` est. for "Start automation" and the Review badge) and teal links.
- Status colours: Running = green dot pill; Draft = grey dot pill; delta chips are yellow circle with down arrow, green circle with up arrow; "Live" banner is pale green (`#D9F7D0` est.) with dark green text; "Most sent" highlight row is lime-tinted.
- Node left edge accent stripes colour-code node type: purple for messages, orange for delays, teal for branches, pink for AI.
- Chart palette: bright saturated teal-green, orange, amber yellow, plus blue sparklines.
- Type: sans (Inter-like), uppercase 11-12px small-caps labels with letter spacing for section/metric labels (SENT, OPENED, CAMPAIGN NAME); big KPI numerals about 30px semibold (est.); body 14px (est.).
- Radii about 6px on buttons/inputs/cards (est.), full pill for tags and status. Dotted-grid canvas background in the builder.
- Icons: thin outline icons (envelope, chat bubble, document, globe for channels; stopwatch, branch, lightning for flow nodes). Illustration: none seen.

## 4. Components

- KPI card (Overview): white card, ~210px wide x 160px tall each (est.), four in a row with equal gutters. Content: uppercase label + help "?" icon, a row of channel icons at top-right showing which channels contribute, big value (1,912), a coloured delta chip with text "-190 from last day", and a sparkline filling the lower half with min/max annotations on the curve.
- Filter bar above KPIs: date range button with calendar icon ("Apr 14, 2025 - May 13, 2025"), granularity select ("Daily"), channel select ("All channels"). Outlined 36px-high controls (est.).
- Tags: grey pill chips with an x ("growth-marketing", "adoption"), right aligned under a "TAGS" label; description is inline-editable with a pencil ("No description").
- Results table (Reports): header row in uppercase violet sortable labels with chevrons; first row is a shaded totals row ("178 of 178 results (total)"); rows ~85px tall (est.) with two-line numeric cells (percentage bold on top, raw count in grey below); first column is a violet link with a type icon (event-trigger, newsletter, segment-based). A "+" square button at the far right of the header adds columns. "Showing 178 of 178 results. Limit results" in the corner; "Definitions ?" link top right. Table/Chart toggle as underlined tabs with icons.
- Chart view: control row of selects ("Individual", Count|Percentage segmented toggle, "Weekly", "Email" with icon), a metric select ("Opened"), line chart with horizontal gridlines only, y-axis 0-100%, and a right-hand scrollable checklist legend where each series has its own coloured checkbox; unchecked items show an empty outlined box in a faint colour.
- Message Leaderboard card: title with date range and "5 channels" badge, metric tabs (Sent / Opened / Clicked / Converted), a "Most sends" sort label with icon, and ranked rows; rank 1 is highlighted green with a trophy and "MOST SENT" caption.
- Details card: header with created/started dates, then a "Trigger" section with a plain-language sentence ("People will enter this campaign **the first time** they meet the following conditions:") and condition blocks joined by AND chips; "View >" link in teal.
- Buttons: outlined white (Follow, Actions, back arrow), split/dropdown (carets), primary filled teal (Start automation, disabled state is a lighter teal), icon-only "..." overflow button, "Review" with a numeric badge (2) for outstanding issues.
- Add panel (right drawer, ~360px wide at 1920 scale (est.)): header "Add" with X, search field, "Import from...", grouped lists with small headings (Messages, AI, Delays), each item an icon + label with a coloured left stripe matching node type.
- Node cards on canvas: ~260px wide (est.), title + one-line summary ("Wait 15 days"), tiny person icon with the live count in the corner. Message nodes show a thumbnail, subject, preview line, and (when live) a metrics strip "Delivered 1,279 / Converted 0.2% / Opened 41.1% / Clicked 1.4%". Empty message node offers: an AI prompt input with "Generate email" button, then "Start from template", "Start from existing", "Start blank", and a "Use classic editors" link. Branch edges are labelled with pill chips ("Path A: 20%", "Path B: 80%").
- Canvas toolbar (floating, bottom center): `Measure` toggle, `+ Add`, zoom out, "100%" or "75% v", zoom in, an eye-slash toggle and a sticky-note stack icon for notes.
- Status banner: pale green bar with pulsing dot "Live  Any changes you make will be instantly live." attached above the toolbar.

## 5. Key screens

### Automation Overview (`campaign-overview.png`)
Header band (back, status pill, title, Follow, Actions) / tab row / description + tags / filter row / 4 KPI sparkline cards / two-column lower area: Details (trigger conditions) left (~48%), Message Leaderboard right (~48%). Primary action: toggling date/channel to re-slice the KPIs. Hierarchy: big numbers first, then trend, then configuration. Maps to rightnow-ai campaign detail page (Sent, Opened, Replied, Converted).

### Workflow builder (`workflow-builder.png`, `workflow-metrics.png`)
Vertical flow on a dotted grid: Time Delay -> Random Cohort Branch (Path A 20 percent / Path B 80 percent) -> message nodes, joined by thin grey orthogonal connectors with arrowheads. Header holds title, Draft pill, one-line description, `...`, `Review (2)`, and `Start automation`. Add panel slides over the right side without shifting the canvas. Maps to rightnow-ai sequences and automations: a linear step list with delay nodes between emails, plus branching later.

### Reports (`analysis-table.png`, `analysis-chart.png`)
Title "Results" with date range and channel filter inline, Table/Chart tabs, "Refine results" link. Table sorted by Sent; chart view with series picker. Maps to rightnow-ai analytics.

### Not seen
People/segments tables, message editor, mailbox/warm-up, inbox, pipeline/kanban: no screenshots reviewed (Customer.io has no CRM pipeline or unified inbox of this kind).

## 6. Interaction patterns

- Real-time status: "Live - any changes you make will be instantly live" banner; per-node live person counts; delta chips versus the previous period; "Last saved N ago".
- Draft/publish gating: Draft pill, `Review` button with issue count badge before `Start automation` is enabled (disabled-lighter look until valid).
- Progressive disclosure: empty message node shows creation options (AI, template, existing, blank) and tucks the old editor behind a "Use classic editors" link; metrics overlay toggled with `Measure` instead of always on.
- Inline editing: title and description via pencil icons; tags removable with x.
- Search: global `⌘K` palette across automations, people, docs.
- Hover/keyboard shortcuts beyond `⌘K`: not observed.

## 7. Responsive / mobile

Not observed; only desktop-width screenshots were reviewed.

## 8. Ideas worth borrowing for rightnow-ai

- Campaign page header: back arrow, status pill (Running/Paused/Draft), inline-editable name, tabs Overview / Metrics / Sequence / Leads / Sent / Drafts with a dot on tabs holding unpublished changes.
- Four KPI sparkline cards with a delta chip versus prior period and min/max annotations; shared date-range + granularity + filter row above them.
- Leaderboard card (best-performing step/subject lines) with metric tabs and a highlighted #1 row.
- Sequence canvas option: vertical step nodes with left colour stripe by type (email, wait, condition), inline live counts, and a `Measure` toggle that overlays Delivered/Opened/Replied per step.
- "Review (n)" button that lists blocking problems (missing mailbox, empty step, unverified domain) before enabling Start.
- Reports table: totals row on top, two-line numeric cells (percent over count), "+" column adder, Table/Chart tabs, checklist legend for choosing chart series.
- Trigger/enrolment rules written as plain sentences with AND chips.
- Add panel as right drawer with search and grouped steps; empty step offers "Generate with AI / Template / Existing / Blank".
- Global `⌘K` search covering campaigns, leads, docs.
- Percentage branch labels ("Path A: 20%") for A/B variants.

## 9. Why it works

Customer.io's UI looks good because it is restrained: white cards on a pale canvas, hairline borders, one accent colour for interactive things, and colour reserved for meaning (status, node type, delta direction). It is clearly presented because every screen follows the same order, a header that says what and whether it is running, then the headline numbers with trend, then the detail beneath, and numbers are always paired (percentage plus raw count) so they can be trusted at a glance. Users understand what the software is for because the builder literally draws the journey: triggers, delays, branches and messages are visible nodes with live counts on them, written in plain-language sentences, and safety rails ("Live" banner, Draft state, Review count) make the consequences of each action obvious before they happen.
