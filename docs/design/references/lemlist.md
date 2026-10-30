# lemlist UI reference

Observed from lemlist help-center screenshots (real app captures, 3152x1808 at 2x) plus the marketing site. No login was used; the live app was not entered. Values marked (est.) are estimated from images.

## 1. Sources

Pages viewed (Chrome DevTools, isolated context "lemlist"):
- https://help.lemlist.com/en/articles/13751256-monitor-deliverability-with-lemlist-deliverability-hub (26 screenshots)
- https://help.lemlist.com/en/articles/8178427-set-up-lemwarm-and-start-warming-your-inbox (9 screenshots)
- https://help.lemlist.com/en/articles/4452772-auto-launch-leads-into-campaigns (7 screenshots)
- https://help.lemlist.com/en/articles/4452793-how-to-add-follow-up-emails-to-a-sequence (7 screenshots)
- https://www.lemlist.com (marketing site; computed CSS read)
- https://help.lemlist.com/en/?q=sequence+editor (article list only)

Screenshots are saved under `C:\Users\willi\AppData\Local\Temp\claude\C--Users-willi-OneDrive-Desktop-GitHub-Repositories-rightnow-ai\f8a7d979-9487-46fe-b300-dcca3fab7b2a\scratchpad\screenshots\lemlist\`:
- dh00.png Deliverability > Outreach; dh07.png Inbox placements; dh16.png Warm-up tab; dh18.png Mailbox Warm-up Summary table; dh21.png alert-creation modal; dh24.png Alerts tab (dh01-dh25 are the rest of the series)
- lw00.png lemwarm onboarding dashboard; lw06.png lemwarm Warm up settings table (lw01-lw08 rest)
- al00.png campaign General settings > Schedules & launch; al03.png Auto launch modal over the Launch step (al01-al06 rest)
- sq00.png Campaigns list; sq03.png sequence editor with wait-step popover (sq01-sq06 rest)
- home.png marketing homepage

Not seen: the unified Inbox screen, Reports/campaign-report screens, People database, Contacts table, any dark mode, any mobile app view. Sections below say "not observed" where relevant.

## 2. Information architecture & navigation

App shell (main lemlist app, from dh00/sq00):
- Left sidebar, about 175px wide at 1x (est.; 350px in the 2x screenshot), white/very light, thin right border. Collapsible via a panel-toggle icon at the top right of the sidebar.
- Top of sidebar: lemlist logo (blue rounded-square "E" mark + lowercase wordmark) with a chevron = workspace/team switcher dropdown.
- Below it: a "Search for anything" field with a Cmd-K hint (global search / command palette).
- Nav is grouped under small grey section labels:
  - (ungrouped) Home, lemAgent (AI assistant, round robot avatar)
  - Find & Manage: People database, Enrichment, Signal agents, Contacts, Companies
  - Engage: Campaigns, Tasks (red count badge "4"), Inbox, Calls
  - Analyze: Reports, Deliverability, Meetings
- Bottom of sidebar: credits balance ("1.1k credits" with coin icon) and the user row (colored circle avatar + name).
- Active item: light grey rounded pill background (Deliverability in dh07) or, in the campaigns screenshot, blue icon + bold label (sq00).
- Each nav item = 16px line icon + 14-15px label (est.).
- Page-level navigation uses horizontal tabs at the top, not breadcrumbs. Examples: Campaigns | Outreach queue; Deliverability: Warm-up | Outreach | Inbox placements | Alerts | Settings.
- Inside a campaign the shell changes to a focused full-screen editor with a stepper in the top bar: Sequence > Leads list > Launch (count) > Performance, a primary "Next step" button, and an X to close. A collapsible lemAgent chat panel sits on the left of the campaign editor ("How can I help you?" with suggested prompts).
- lemwarm (separate sister app, lw00/lw06): its own small sidebar (Dashboard, Warm up, DNS checks, My templates), same Cmd-K search, orange accent instead of blue.
- A floating round chat/support launcher with a red dot sits at bottom right of every screen.

## 3. Visual language

- Light theme only observed. Page background white (app) / off-white (~#F8F8F8 est., lemwarm). Cards white with 1px light grey border (~#E5E7EB est.) and small radius.
- Primary accent: saturated blue (~#2563EB est.) for primary buttons ("Run inbox placement test", "Create", "Next step", "Save auto launch settings"), links, active step text, and template variables ({{Contact > firstName}} shown as a light-blue chip).
- lemwarm accent: warm orange/peach (~#F5B461 est.) with a peach selected-nav background (~#FDF1E6 est.).
- Semantic: green (~#22C55E est.) for good/positive deltas, progress bars and the "Inbox" series; red (~#EF4444 est.) for negative deltas, errors, the Tasks badge; amber for warnings ("Warning" severity, Microsoft series); pale blue info banner ("All metrics in this tab are sourced directly from lemwarm").
- Charts: pastel mint bars (~#8EDDBA est.) for inbox, salmon for spam, light grey for "to send", blue line for score. Hollow ring-dot legend markers.
- Typography (measured on lemlist.com): body Inter 16px/400; H1 Manrope 56px/600, color rgb(24,24,26); nav buttons Inter 14px/500, radius 10px; "Start free trial" is a near-black rounded rectangle with white text. In-app UI appears to be an Inter-like sans; table/body text about 14px, section labels 12-13px grey, card titles 13-14px medium, KPI numbers about 24px semibold (est.).
- Density: comfortable-compact. Table rows about 32px at 1x (est.); KPI cards ~60px tall; 12-16px gaps between cards.
- Radii: cards 8px, inputs 8px, buttons 8px, pills fully rounded, modals 12px (est.).
- Elevation: borders do most of the work; shadows only on modals (soft, large); marketing nav is a floating white pill with shadow.
- Icons: thin outline line icons (Lucide/Phosphor-like), grey, with colored icons only for step types (green envelope for email, blue for chat/voice).
- Illustration: marketing site uses a photorealistic LEGO-style Mars-base hero (playful, brand-differentiating) with orange sunset palette; the app itself is illustration-free; emojis are used as campaign icons (angel, trophy, fire, cake).

## 4. Components

Tables/lists
- Campaigns table (sq00): columns Active (checkbox + blue toggle), Name (emoji icon + title), Favorite star, Leads (thin 2-tone progress bar + count), Reply (count + % in grey), Sender (round letter avatar), Tags (grey chips, "+1" overflow), Created (relative "9 days ago", sortable with caret), "..." column menu. Header cells have a small icon before the label (T, bars, #, person, tag, calendar). Row height ~32px at 1x (est.); 1px row dividers; "..." row menu at right.
- Filter bar above the table: search input, dropdown chips "Status: All", "Sender: All", "Tags: All", "Creators: All", a "Favorites only" toggle, and a right-aligned blue split button "+ Create" with a chevron.
- Deliverability tables (dh18/dh24): header row on a light tint, 14px cells, numeric columns centered, green number for good avg score (97.7), "Min / Max" as "88 / 100", row settings gear, footer "Rows per page [10 v]  1 - 1 of 1" with first/prev/page/next/last icons.
- lemwarm table (lw06): grouped by user (avatar + name + gear), child rows per mailbox with provider label in caps ("GOOGLE") + address, stepper cells [-] 15 [+] for warm-up/day and ramp-up increment, circular score ring (84) for deliverability, Start (orange filled) / Stop (grey outlined with square icon) button per row, header select-all checkbox, "Load more users", top bulk bar "Change settings for all users in team [-10+] [-1+] Apply" and "Reset by default". Tabs "By users | By domains".
- Alerts table: toggle, severity icon + word (Warning), Metric, Target, Thresholds ("Inbox rate < 85%" with sub-line "Over a rolling 3-day window"), notification bell button, "..." menu. Empty tables show a centered grey sentence ("No alerts configured. Create your first alert to monitor your deliverability.").
- Inbox placement table: Date (sortable), Campaign, Step, User (avatar), Mailbox (provider logo + masked address), Lead test data, Score (circular ring with number), Source (blue "Campaign" pill).

Cards
- KPI stat cards in a row of 4: title with (i) tooltip icon, big number, delta line "-100.0% vs. prev period" with a red/green circle-arrow icon, or a grey caption; Warm-up cards add a small sparkline at top right. Inbox-placement cards add a provider logo (Google, Microsoft, SMTP/IMAP) and a big score.
- Chart cards: title + (i), chart, hollow-dot legend centered below. Two charts side by side at 50/50, wide chart full width.
- Onboarding cards (lw00): four equal step cards in a row (1 Verify your email address - green tint with check, 2 Choose a lemwarm plan - peach active with orange CTA, 3/4 greyed "Not connected" / "You need to choose a plan first").

Forms/inputs
- Filter dropdowns with chevrons, ~36px tall, grey text when "All".
- Modal form (dh21): grouped sections with sub-card headers ("Configure alert type", "Configure alert threshold", "Configure alert notifications *"), labels above fields with red asterisks, helper text under each field ("Below, above or equal"), 3 or 4 fields per row, Save greyed until valid, Cancel as text at left.
- Toggles: iOS-style, blue when on; channel toggles Email / In-app / Webhook / Slack in one row.
- Number stepper [-] n [+]. Date range field with calendar icon; "Daily" granularity select.
- Template variable chip and a "{}" insert button at the right of subject/title inputs.

Buttons
- Primary: solid blue, white text, 8px radius, optional leading icon (play icon on "Run inbox placement test") or split chevron.
- Secondary: white, 1px border, dark text ("Schedule test" with clock, "+ Create an alert", "Preview" with eye).
- Ghost/text: "Cancel"; "Next step" is grey while disabled.
- lemwarm: orange primary; disabled = pale grey.
- The blue boxes and arrows in the help screenshots are the docs' own callouts, not product UI.

Tabs
- Underline tabs, 14px; active has dark text, a 2px underline and a faint grey pill background; inactive grey-blue text. Used at page level (Deliverability) and in-card (Alerts logs: All | Active | Resolved; To launch | Launched; Sequence A | Sequence B).

Drawers / modals / side panels
- Modal: centered, white, ~12px radius, dimmed grey overlay, title 18-20px semibold + subtitle, X at top right, footer actions. The General settings modal (al00) is two-pane: left list (Automation, Tracking, Senders, Schedules & launch, CRM integration, General), right content pane, ~75% of screen width.
- Sequence editor is a split pane: left flow canvas, right step inspector with a collapse arrow at top right.

Badges
- Count badge: red rounded rectangle with white number. Status pills: "Draft" with pencil icon, "In progress" with spinner and chevron (campaign status dropdown). Tag chips grey. Source pill light-blue "Campaign". Lead-action chips "FIND PHONE" blue outline uppercase ~11px. "Warning" severity = amber circle-exclamation icon.

Toasts: not observed.

Empty states: single grey centered sentence inside the table body; charts show zeroed axes rather than a placeholder.

Charts
- Line (score), stacked bar (cold emails landing: To Send / Inbox / Internal conversations / Internal spams / Spams), bar (replies landing), multi-series dots (placement score by provider), sparklines in KPI cards, circular score rings in tables. Thin grey gridlines, ~12px grey axis labels, shared date x-axis (MM/DD).

Editors
- Email step editor: Forced sender dropdown, Task title, Subject line (with {} variable button and "Add Cc:"), Message rich-text area with variable chips, bottom toolbar: "+ Add", AI sparkle button, then icons for image/text/format/link/signature/code. Top row: step type icon + name, "Manual step" dropdown, "None" select, Preview, gear, collapse.

## 5. Key screens

Campaigns list (sq00): Tabs "Campaigns | Outreach queue", "Send feedback" at top right. Filter row, then a table filling the width. Primary action: "+ Create" (blue split button, top right). Hierarchy: name column is widest; progress bars give an at-a-glance lead completion; sender avatar and tags are quiet.

Sequence editor (sq03): top bar: emoji + campaign name, Draft pill, star, gear, "...", then the Sequence > Leads list > Launch > Performance stepper (Sequence has a red warning dot because of validation errors) and a "Next step" button. Below: tabs "Sequence A | Sequence B" (A/B variants). Canvas (dot-grid background, zoom in/out/fit controls bottom-left): a header node "Senders [avatar] / Schedules Default sch... +1", then vertical steps connected by lines with "+" insert buttons. Step card: top strip "Send immediately" (blue) or "Wait for 1 day" (number in blue), body with colored icon + name (Email, Voice message, Chat message) and "...", footer label "Manual step". Selected step has a blue outline glow; invalid step has a red outline plus warning triangle. Clicking the wait strip opens a small popover: "Wait for [-] 1 [+] days / or / [toggle] Send immediately". Right pane (about 45% of width) is the step editor. "+ Add step" pill at the bottom of the flow. Primary action: Next step.

Leads / launch step (al03): Tabs "To launch | Launched", search with Cmd-K hint, filter icon button, "..." menu, "0 leads selected" select-all row, lead cards with name, email with a verification sparkle icon, blue "FIND PHONE" chips, per-row "...". The sequence preview stays visible at right (three panes: lemAgent, leads, sequence). Auto launch modal: toggle "Enable auto launch for this campaign" and a 2x2 checkbox grid of lead email statuses (Not verified, Undeliverable, Risky, Deliverable), button "Save auto launch settings".

Schedules & launch settings (al00): modal sections: Auto launch toggle; "Your campaign schedules" with a Timezone-based schedule toggle; schedule rows as inline definition tables (Name, Days 5/7 (i), Start at 9:00 AM, End at 6:00 PM, Send every 20 min., Timezone) with "..." menu; "Create a new schedule" button; team templates list; "Pause during holidays" with US / France / UK checkboxes and "13 days / year" subtext.

Deliverability hub (dh00, dh07, dh16, dh18, dh24): five tabs. Shared filter bar: date range "Sep 27, 2026 -> Oct 27, 2026", "Daily", "N mailboxes", "All providers", "All domains".
- Outreach: 4 KPI cards (Total Email Sent in Period, Delivered, Not delivered (Bounced), Avg Daily Sent), two charts (Sent vs Delivered vs Bounced; Delivery & Bounce Rate Over Time), Bounce breakdown, then Performance by Email Provider / Mailbox / Recipient Domain tables.
- Inbox placements: blue "Run inbox placement test" button plus "Schedule test"; 4 score cards (Global 78 +15.0%, Google 95, Microsoft 50 -48.0%, SMTP/IMAP 100); weighted-average chart; "Inbox Placement" table with score rings.
- Warm-up: info banner; KPI cards with sparklines (Warmup Score 100.0, Inbox Rate 99.9%, Inbox Count 711, Spam Count 1); "Where are your cold emails landing?" stacked bars; "Where are your replies landing?"; Warmup Score by Mailbox / by Domain line charts with dropdown selectors; Mailbox Warm-up Summary table (Mailbox, Domain, Provider, Avg Score, Min / Max, Inbox, Spam, Daily Limit, Ramp-up, Tips, gear).
- Alerts: two sections (Warm-up alerts, Outreach alerts), each a table with "+ Create an alert"; "Alerts logs" with All/Active/Resolved tabs and table (Email / Domain, Severity, Alert info, Date); "Recovery history" with "Enable self-recovery". Modal fields: Alert type, Monitoring target, Severity level, Operator, Threshold (%), Period (days), Period (mode: rolling or consecutive), notification channels Email / In-app / Webhook / Slack.

lemwarm (lw00, lw06): onboarding dashboard (welcome headline, 4 step cards, a video tile "Watch video (5m36s)" at left ~2/3 and a "Chat with support" card at right ~1/3). Warm up screen: page title, search field, "Reset by default", "..." menu, "Other settings", bulk apply bar, tabs By users / By domains, table described above.

Inbox, CRM/pipeline, analytics reports, leads database: not observed; the sidebar only shows they exist (Inbox, Contacts, Companies, Reports, Tasks).

## 6. Interaction patterns

- Setup checklist: lemwarm shows a 4-step linear stepper where finished steps go green, the current step is highlighted with a single CTA and later steps are greyed and disabled with a reason ("You need to choose a plan first"). Plus a 5-minute video and chat support.
- Campaign creation is a guided stepper (Sequence, Leads list, Launch, Performance); errors are flagged on the step (red dot on Sequence tab, red outline + triangle on a step).
- Inline editing: wait time is edited in a popover on the flow node; table cells hold steppers and toggles (Active toggle in the campaigns table, warm-up count steppers); alerts are enabled by an inline toggle.
- Cmd-K "Search for anything" in both lemlist and lemwarm.
- Real-time status: Draft / In progress pills, per-row Start/Stop, score rings, vs-previous-period deltas, alert logs with Active/Resolved states, "self-recovery" setting.
- Progressive disclosure: advanced settings in a modal behind a gear; "Forced sender ... Switch here" link; "+1" chip overflow; collapsible right inspector; collapsible sidebar.
- Info tooltips (i) beside nearly every metric title.
- AI assist: lemAgent chat docked left in the campaign editor with suggested prompts (e.g. "Audit my sequence and suggest improvements", "Help me fix the errors on my sequence"); sparkle button in the message editor.
- Hover states and keyboard shortcuts beyond Cmd-K: not observed in static images.

## 7. Responsive / mobile behavior

Not observed. The help screenshots are all desktop width and the app itself was not opened. The marketing site was only viewed at desktop width (floating pill nav over a full-bleed hero).

## 8. Ideas worth borrowing for rightnow-ai

- A single "Deliverability" hub with tabs (Warm-up, Outreach, Inbox placements, Alerts, Settings) and one shared filter bar (date range, granularity, mailboxes, providers, domains) that persists across tabs. Fits mailbox + warm-up + analytics in one place.
- KPI card pattern: title + (i) tooltip, big number, vs-previous-period delta with red/green icon, optional sparkline.
- Circular score ring (0-100) in table cells for warm-up score and inbox placement.
- Stacked-bar "Where are your cold emails landing" (To send / Inbox / Internal / Spam) per day; maps to our warm-up outcomes.
- Mailbox warm-up table with steppers [-] n [+] for daily limit and ramp-up, per-row Start/Stop, plus a top bulk-apply bar ("Apply", "Reset by default"). Matches our quota model.
- Alert-rule builder: metric, target (all or one mailbox/domain), severity, operator, threshold %, period days, rolling vs consecutive, channels (Email, In-app, Webhook, Slack); alert log with Active/Resolved tabs.
- Campaign list table: Active toggle, progress bar for leads, reply count with %, sender avatar, tag chips with "+N", relative created date; filter chips row with a split "Create" button.
- Sequence builder as a vertical flow canvas: header node (Senders, Schedules), step cards with "Send immediately" / "Wait for N days" strip, "+" connectors, A/B tabs, right-hand inspector; validation shown as red outline + warning icon; wait popover with stepper and "Send immediately" toggle.
- Variable chips (blue) in the editor and a "{}" insert button on inputs.
- Schedule rows as compact definition tables (Days, Start, End, Send every N min, Timezone) plus "Pause during holidays" checkboxes; fits our no-burst-sending rules.
- Auto-launch by lead verification status (Not verified / Undeliverable / Risky / Deliverable) as a 2x2 checkbox grid.
- Campaign top-bar stepper (Sequence > Leads list > Launch > Performance) with a single "Next step" CTA.
- Onboarding row of 4 numbered cards, future steps greyed with a reason line.
- Sidebar groups (Find & Manage / Engage / Analyze), small count badge on Tasks, Cmd-K search at top.
- Footer pagination "Rows per page [10]  1 - N of N" on every table.
- Plain centered-sentence empty states that name the next action.

## 9. Why it works

lemlist's in-app UI looks good because it uses very little: a near-white canvas, hairline borders instead of shadows, a single saturated blue for every primary action and one neutral grey scale, with green, red and amber reserved purely for meaning (good, bad, warning). The type is one clean sans at a consistent small size, with weight rather than color doing the hierarchy, so dense data screens such as the Deliverability hub stay calm. It is clearly presented because every screen follows the same grammar: tabs on top, a shared filter bar, a row of KPI cards (label, number, change vs previous period), then charts, then tables with identical headers and pagination, and every metric carries an (i) tooltip so jargon is explained in place. Users can see what the software is for from the sidebar alone, which is grouped by the job to be done (Find & Manage, Engage, Analyze) and mirrored by the campaign stepper (Sequence, Leads list, Launch, Performance), so the path from finding leads to sending to measuring is always visible. Setup is guided by numbered cards that grey out what is not yet possible and say why, and invalid or risky states (red outline, warning triangle, alert severity) appear exactly where the problem is, which keeps a complex cold-email workflow understandable without reading documentation.
