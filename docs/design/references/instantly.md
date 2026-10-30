# Instantly.ai - UI reference

Scope note: the real app requires login and was not opened. Everything below comes from the in-app screenshots embedded in Instantly's help-center articles (cropped, mostly light-theme, on pale-blue backdrops) plus the live marketing page. Values read from images are marked "(est.)"; values read from live CSS on instantly.ai (marketing site, not the app) are marked "(site)".

## 1. Sources

Pages viewed:
- https://help.instantly.ai/en/articles/11991261-getting-started-with-the-email-accounts-dashboard (13 images)
- https://help.instantly.ai/en/articles/7988514-warmup-settings (4 images)
- https://help.instantly.ai/en/articles/6602310-analytics (Analytics & Report; 8 images)
- https://help.instantly.ai/en/articles/6576561-how-to-manage-unibox-best-practices-for-replying-to-leads (8 images)
- https://help.instantly.ai/en/articles/7251329-subsequences (8 images)
- https://instantly.ai (marketing page, live CSS only)

Screenshots (in `C:\Users\willi\AppData\Local\Temp\claude\C--Users-willi-OneDrive-Desktop-GitHub-Repositories-rightnow-ai\f8a7d979-9487-46fe-b300-dcca3fab7b2a\scratchpad\screenshots\instantly\`): `acc00.png` (Email Accounts table + rail tooltip), `acc02.png` (empty state + Add or Buy modal), `acc04.png` (Type dropdown), `acc10.png` (Account Details drawer, Warmup tab), `ana00.png` (Reports > Outreach), `ana01.png` (Campaigns/Accounts tables), `uni00.png` (Unibox filter sidebar), `uni03.png` (thread + Reply split button), `sub01.png` (Duplicate subsequence modal), `sub03.png` (subsequence editor wait delay), `sub04.png` (subsequence settings, daily limit), `wu00.png` and `wu02.png` (warmup settings tab), `home.png` (marketing hero), `accounts-full.png` (full help article).

Not observed: the campaign sequence editor main view, leads table, CRM/pipeline (Opportunities) view, automations canvas, dark mode, mobile layout.

## 2. Information architecture and navigation

- App shell: a narrow icon-only left rail (about 40px wide (est.)) with the lightning-bolt logo at the top, then icon buttons; a content area to the right with a 56-64px (est.) header that holds the page title on the left and horizontal tabs next to it, separated from the title by a vertical hairline.
- Rail items seen, top to bottom (icons only, label appears in a black tooltip on hover/selected, e.g. "Email Accounts"): sparkle (AI / Copilot), magnifier (search / lead finder), paper plane (Campaigns), robot (AI agents), lightning bolt (automations / flows), envelope (Email Accounts), speech bubble (Unibox), pie chart (Analytics/Reports). Pinned at the bottom: rocket, refresh/loop, and a black rounded-square avatar with initial "I" (workspace / account switcher).
- Active rail item gets a pale-blue rounded-square fill with a blue icon.
- Secondary navigation is per-page: Email Accounts has top tabs "Accounts | Deliverability Tests"; a campaign has tabs "Analytics | Editor | Leads | Subsequences | Settings" with a back arrow and the campaign name ("Test") at left; Reports has its own left sub-sidebar (Overview, Outreach, Sales, AI Agents, Automation, Workspaces) with a collapse icon; Unibox has a collapsible filter sidebar.
- Breadcrumb: "Test > My Subsequence" in a thin strip below the header inside a subsequence.
- Workspace switcher: bottom-left avatar (a Workspaces report exists, so multi-workspace is supported). Search: magnifier in the rail and magnifier in the Unibox list header; no command palette observed.
- Marketing site nav (site): Instantly logo, "AI Agents, Products, Use Cases, Resources" dropdowns, Pricing, Login, outlined "Get A Demo" pill, black filled "Get Started" pill.

## 3. Visual language

- Overall: light, airy, near-white (#FAFAFA-ish (est.)) panels with white cards; hairline borders instead of shadows; one saturated blue accent. Marketing body background rgb(247,248,251) = #F7F8FB (site).
- Palette (est. from screenshots): primary blue ~#0A6CFF-#1A73F5 (primary buttons, active tab underline, logo); active nav fill ~#D6E6FF; success green text ~#1E8E3E on pale green pill ~#E3F5E8; warning amber/yellow pill (Paused) text ~#B7791F on ~#FFF4D6; error red ~#E5484D; chart blue ~#2F54EB, light blue ~#3B82F6, spam-red ~#F26B5E, yellow ~#FACC15, purple ~#A78BFA, green ~#22C55E; near-black text ~#111; muted labels ~#6B7280; hairline ~#E5E7EB. Black is used for tooltips, avatar and the marketing "Get Started" button.
- Dark mode: not observed (the warmup drawer screenshot dims the page with a near-black overlay, which is a modal scrim, not a theme).
- Typography: Averta Std (site headings/buttons), fallback Arial; body face on site "Geliat". The app UI looks like a geometric humanist sans in the same family (Averta-like). Site scale: h1/h2 40px/600, lead paragraph 20px/700, buttons 14px/600, body 16px/400 (site). App scale (est.): page title 18-20px/600; table header 11px uppercase letter-spaced /600 muted gray; table body 14px/400-500; helper text 12px.
- Density: medium-compact. Table rows ~44-48px (est.), header row ~36px; toolbar controls 36-40px tall; consistent 8px grid.
- Radii: inputs/buttons 8px (est.); cards and tables 12px (est.); outer app frame ~16-20px; status pills fully round; marketing buttons 100px (site).
- Borders vs shadows: 1px light-gray borders everywhere; shadow only on floating layers (dropdowns, tooltips, modals).
- Iconography: thin outline icons (about 1.5px stroke, Lucide-like), 16-20px; flame icon = warmup; colored emoji-like icons for lead statuses (green thumbs-up, calendar-clock, confetti, palm tree, red thumbs-down).
- Illustration: none inside the app; soft blurred blue gradients used as thumbnail art on the Add or Buy cards and as the marketing hero background.

## 4. Components

- Table (Email Accounts): columns [checkbox] EMAIL, TAGS, TYPE, STATUS, DAILY SENT, HEALTH SCORE (sortable arrows + info icon), then a flame icon (warmup quick toggle) and a "..." row menu at the right. Outer rounded border, header row on a slightly tinted background, row separators 1px. Status is a pale-green pill with a leading dot ("Active"), amber for "Paused". Daily sent is "0/0" with a small "% used" line beneath. Bulk action: select checkboxes, then a "..." menu top-right ("Unpause selected", "Bulk edit settings").
- Filters: a search input (leading magnifier, 8px radius) followed by plain-text dropdown triggers "Type v / Status v / Tags v" (no border, chevron). Menus have an icon per option, selected row has a blue-tinted fill and checkmark. Type: All, SMTP, Google, Microsoft, AWS, AirMail. Status has about 11 options (Active, Paused, Connection error, Soft bounce error, Sending error, Has errors, No custom tracking domain, Warmup active, DFY/Pre-warmed, DFY setup pending).
- Column chooser: a small square icon button (list-with-checks) left of the primary button.
- Buttons: primary solid blue with leading "+" ("+ Add or Buy Accounts", "Reply", "Launch" with rocket); secondary white with 1px border and icon ("Pause" with pause glyph, "Duplicate" with copy glyph); icon-only square outline button (warmup flame); disabled primary = washed-out blue; split button "Reply v" with a "Reply All" popover menu next to outline "Forward".
- Tabs: text tabs with a 2px blue underline on the active tab, running along the header bottom border; also pill-style segmented "Campaigns | Accounts" in analytics (small bordered toggle).
- Drawer: "Account Details" right-side panel about 55% of the viewport width (est.), with title, X close, tabs "Warmup | Settings | Campaigns" and Pause / flame buttons on the same row; background scrimmed dark.
- Modals: centered card, 12px radius, title 18px/600, descriptive line, select, right-aligned primary button ("Duplicate Existing Subsequence"; "Add or Buy Accounts" is a 2x2 grid of option cards with gradient thumbnail, title, 1-line description, "New" black badge).
- Cards: white, 1px border, 12px radius; KPI cards have a small colored square legend, label, info icon, then big number. Collapsible accordion cards in settings ("General", "Schedule", "Daily Limit") with chevron.
- Forms: label with "Suggested 1, Max 4" helper under it, input with right-aligned unit text ("warmups/day"), toggle switch with info icon ("Disable slow warmup"), text input plus regenerate icon button and example hint ("golden-pineapples"), radio group (Inherit from campaign / Custom limit / No limit), green toggle plus yellow warning callout (triangle icon, amber background, brown text) for risky option.
- Badges: "New" black pill; status pills; Draft/Active/Paused shown as dot + text in the header.
- Charts: warmup bar chart (dashed horizontal gridlines, 6px-ish blue bars, red bar for spam, dark-gray tooltip with date and series value, legend below); analytics line charts in a 2x2 grid, smoothed lines with light gradient fill below, end-point dot, tiny axis labels.
- Empty states: centered bold title "No accounts found" plus one-line hint "Add or buy accounts to get started", inside the table frame.
- Inbox list: item with status icon, date right-aligned, bold subject, 2-line preview, "Load more" bordered full-width button (no infinite scroll).
- Editor: subject input with a lightning (variable/AI) icon and an "A" black square (variant A/B) at right; rich-text body beneath; "Wait [0] [Days v]" pill centered on a horizontal rule between steps (Days/Hours/Minutes).
- Toasts: not observed.

## 5. Key screens

**Email Accounts dashboard** (`acc00`, `acc02`, `acc04`): header "Email Accounts" + tabs Accounts / Deliverability Tests. Toolbar row: search (about 200px), Type, Status, Tags, spacer, column-chooser icon, primary "+ Add or Buy Accounts". Full-width table below. Primary action: add accounts. Health Score (e.g. 100%) and the flame icon make warmup a first-class column rather than a separate page. Empty state routes to the Add or Buy modal with four options: Pre-Warmed Accounts, Instantly Airmail Accounts (New), DFY Google Accounts, Connect Existing.

**Account Details drawer - Warmup tab** (`acc10`): header; row of "Warmup | Settings | Campaigns" tabs with Pause and flame buttons at right. First card: flame icon in a pale blue tile, "Warmup / Started on Feb 03, 2026 - 4 months ago", toggle at right. Second card "Summary For Past Week": three big numbers (48 Warmup emails received, 22 Warmup emails sent, 1 Saved from spam). Third card "Warmup Emails Sent": daily bar chart with legend (Landed in spam red, Warmup emails sent blue). Hierarchy: status toggle, then totals, then trend.

**Warmup settings** (`wu00`, `wu02`): in the drawer's Settings tab, card "Warmup Settings Basics" with three columns: Increase per day (Suggested 1, Max 4; default 1), Daily warmup limit (Suggested 20, Max 200; 10 warmups/day), Reply rate % (Suggested 30; 30). Toggle "Disable slow warmup". Below, "Warmup Filter Tag" with custom tag input + regenerate button. Help text adds an Advanced section: Weekdays only, Read Emulation, Warm custom tracking domain, Open Rate, Spam Protection. Defaults are prefilled with "Suggested/Max" helper text under each label.

**Reports / Analytics** (`ana00`, `ana01`): left sub-sidebar (Overview, Outreach, Sales, AI Agents, Automation, Workspaces; active item has pale-blue fill). Top filter bar: "All Campaigns v", "All v" (Active/Completed), "Last 7 days v", and a "Settings" gear button at the far right that opens a searchable checklist of metrics (Include auto-replies, Total sent, Sequence started, Reply Rate, Open Rate, Click Rate, Positive reply rate, Opportunities, Conversions). KPI card row (Total sent, Sequence started, Reply rate, Open rate, Opportunities...) with colored square legend dots, then a 2x2 chart grid (Total sent, Total opens, Unique opens, Total replies). Below: "Campaigns | Accounts" toggle, table "Campaigns that sent in this period - Open a campaign to investigate its performance in the selected dates" with Sent / Opened / Replied columns; Accounts view shows Contacted, Opened, Replied, Combined score.

**Unibox** (`uni00`, `uni03`): three-column layout: rail, filter sidebar (~230px), message list (~280px), conversation pane. Sidebar: collapsible "Status" group with "+" to add custom labels, search box, items with colored icons (Lead, Interested, Meeting booked, Meeting completed, Won, Out of office, Wrong person, Not interested), then collapsible selectors "All Campaigns", "AI Sales Agents", "All Inboxes", and a "More" group (Primary, Unread only, Reminders only, Scheduled emails, Sent, Others). Active filter has blue fill. List row: status icon + sparkle, date at right, bold subject, quoted preview with reply arrow. Conversation pane: sender avatar (purple circle with initial) + address + info icon; large subject (about 24px/700) "Re: Hello", From/To block, email body rendered on white; sticky bottom bar with blue "Reply v" split button and outline "Forward". Checking rows reveals an action bar (Mark unread/read, Update lead status, Add to blocklist, Delete). Search offers quick filter chips (Has attachment, Unread, Sent, Received, Last 7 days), advanced filters, recent searches.

**Campaign page + Subsequences** (`sub01`, `sub03`, `sub04`): campaign header with back arrow, name, tabs Analytics / Editor / Leads / Subsequences / Settings. Subsequences tab: intro sentence, "Duplicate" outline button and "+ Create Subsequence" blue button right-aligned, list rows with name, tiny sent/open counters, amber "Paused" pill and "..." menu. A subsequence has its own Editor/Settings tabs, status dot (Draft/Active) and Launch/Pause button. Triggers (from text): status-based, activity-based (opened, clicked, completed without reply), keyword phrases separated by ";". Step delay is the "Wait N Days/Hours/Minutes" pill. Settings are accordions: General, Schedule ("1 schedule", "Never Stop sending" chips), Daily Limit (radio: Inherit from campaign / Custom limit / No limit, plus "Ignore Account Daily Limits" with a yellow warning).

**Marketing home** (`home`): blue gradient hero with rounded 24px-ish corners, centered "Find Clients [logo] Instantly", prompt box "Ask Co-pilot to Build a Winning Lead List" with blue arrow send button, pill chips "Create Sales Agent / Create Reply Agent / Find Leads". Shows the product leans on an AI chat-first entry point.

## 6. Interaction patterns

- Setup: empty Email Accounts table steers to Add or Buy modal; copy recommends warming at least 2 weeks before launching.
- Sensible defaults: warmup values pre-filled and labeled "Suggested ... Max ...", article advises keeping defaults.
- Progressive disclosure: warmup Basics vs Advanced; subsequence settings in accordions; "More" group in Unibox; Subsequences tab appears only after a campaign launches.
- Risky options carry an inline amber warning callout.
- Real-time feedback: status pills (Active/Paused/error variants), daily sent "x/y" with % used, health score, warmup state color-coded flame (gray paused, green active, orange/red for caution per text), chart tooltips on hover.
- Hover: rail icons show black tooltips; chart bars show a tooltip card; rows show a hover tint (est.).
- Inline row actions: flame toggle and "..." menu per row; bulk via checkboxes.
- Keyboard shortcuts: not documented in the pages viewed.
- Tag-based organization: tags column and filter with search inside the dropdown.

## 7. Responsive / mobile behavior

Not observed (no mobile app screenshots in the viewed articles). The marketing site collapses nav to a hamburger presumably but this was not checked.

## 8. Ideas worth borrowing for rightnow-ai

- Icon-only left rail with tooltip labels and a pale-blue active state; bottom-pinned workspace avatar.
- Page header = title + underline tabs (Accounts | Deliverability tests; Analytics | Editor | Leads | Subsequences | Settings) to avoid a deep sidebar.
- Mailbox table with Health Score, Daily Sent "x/y + % used", status pill, and a flame icon as a one-click warmup toggle; Type/Status/Tags dropdown filters with an icon per option.
- Right drawer "Account Details" with Warmup / Settings / Campaigns tabs: toggle card, "Summary for past week" three-number card, small bar chart with spam in red.
- Warmup settings fields with "Suggested X, Max Y" helper text under each label and unit suffix inside the input.
- Unibox: three-pane layout with a status filter sidebar (colored icons, "+" to add custom labels), "Load more" button, split Reply / Reply All button, selection action bar.
- Analytics: top filter bar (campaign, status, date range) plus a "Settings" popover checklist to show/hide KPI metrics; 2x2 mini line charts; Campaigns | Accounts toggle table.
- Subsequence triggers (status, activity, keyword phrases) and "Wait N days/hours/minutes" pill between steps; "Inherit from campaign / Custom / No limit" daily-limit radios with an amber warning for overriding account limits.
- Empty states with one bold line + one hint line and a single obvious primary action.
- Hairline borders, 12px radii, one blue accent: cheap to implement and looks polished.

## 9. Why it works

Instantly's UI looks good because it is restrained: near-white surfaces, 1px hairline borders, one saturated blue for every primary action and active state, and small color-coded pills for status, so the eye goes first to what can be clicked and second to what state things are in. Each page does one job with a consistent skeleton (title and underline tabs, a toolbar of search plus filters on the left and the single primary button on the right, then a table or cards), which means once a user has learned the Email Accounts page they already know how Campaigns, Unibox and Reports behave. The vocabulary is the job itself (Email Accounts, Warmup, Campaigns, Subsequences, Unibox, Lead status labels like Interested and Meeting booked), and the icon rail is short enough to read as a map of the cold-email workflow: connect mailboxes, warm them, build campaigns, handle replies, measure. Complexity is deferred: sensible defaults with "Suggested/Max" hints, Basics before Advanced, accordions for settings, and warnings only where a choice can hurt deliverability, so beginners can accept defaults while power users still find every knob.
