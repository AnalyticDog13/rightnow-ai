# Close (close.com) UI reference

Observed 2026-10-30 via Chrome DevTools. Values marked "(measured)" come from computed styles of the live HTML tour at demo.close.com (the tour renders the real app DOM in an iframe, viewport 1280 wide). "(est.)" = read off a GIF/PNG. The real logged-in app was not accessed.

## 1. Sources

URLs viewed:
- https://help.close.com/feature-guide/workflows (text + GIFs)
- https://help.close.com/docs/opportunities (redirects to /feature-guide/opportunities)
- https://help.close.com/feature-guide/inbox
- https://help.close.com/feature-guide/lead-filtering-and-smart-views
- https://help.close.com/feature-guide/reports
- https://www.close.com (marketing page, computed styles)
- https://demo.close.com/psl/interactive (Navattic tour, 17 steps, no form required; steps 1, 2, 5, 8, 12, 15, 16 viewed; step via `?g=cm1phte5t000003l186vvgtn4&s=N`)

Screenshots (all in `C:\Users\willi\AppData\Local\Temp\claude\C--Users-willi-OneDrive-Desktop-GitHub-Repositories-rightnow-ai\f8a7d979-9487-46fe-b300-dcca3fab7b2a\scratchpad\screenshots\close\`):
`wf1.png` (workflow trigger card), `wf-editor.png` (workflow canvas), `wf-list.png` (workflows list), `wf-runs.png` (runs history), `pipeline.png` (opportunity kanban), `lead-sidebar.png`, `inbox-items.png`, `inbox-sidebar.png`, `leads-filter.png`, `leads-list.png`, `report1.png` (smart views sidebar), `report2.png` (row menu), `home.png`, `demo.png`, `demo2.png` (leads table), `demo-s4.png` (lead page), `demo-s7.png` (Chloe AI page), `demo-s11.png`, `demo-s14.png`, `demo-s15.png`.

Not seen: a real Close Email/sequence template editor, the reporting charts themselves (help page only shows sidebar crops), the opportunity list view, settings screens, any mobile layout. Close has no warm-up or mailbox-health UI because it is a CRM, not a cold-email deliverability tool.

## 2. Information architecture and navigation

App shell: fixed dark left sidebar + light content area with a top search bar. No separate topbar nav.
- Sidebar width 224px (measured, at 1280 viewport), background `#191919`, full height. Collapsible via a "Collapse" button pinned at the bottom (collapsed state is an icon-only rail, visible in the Runs GIF at ~44px wide).
- Top of sidebar: account switcher button showing avatar, name ("Sam Wild") and org subtitle ("Close Tour Guide"), with a caret (dropdown for org/account).
- Primary nav (exact labels, in order): Inbox (with unread count badge, e.g. 4 / 10, blue pill), Opportunities, Leads (with a "+" add button on hover), Contacts, Workflows (also "+"), Conversations (expands to History, Live Calls), Reports. A newer variant adds a "CHLOE" AI group at top (labels "Chat" with the shortcut chip `Cmd J`, "Voice Agents", "Add a new agent", "NEW" pill) and an "Activities" item.
- Inbox expands to sub-items "Done" and "Future" with a thin vertical rail and a blue active tick (`inbox-sidebar.png`).
- Divider, then "SMART VIEWS" section header (uppercase, small, muted) with search icon and "View all Saved Views" list icon; saved filters listed beneath with a building icon + optional emoji (e.g. "High Priority Leads" with fire emoji, "Leads Never Emailed", "No Contact > 7 Days"). Users can pin/remove a view from the sidebar; views are drag-sortable; "Show all" link at the end.
- Bottom group: Support & FAQs (external-link icon), Integrations, Settings, Collapse.
- Global search: a large rounded input at top of the content area, placeholder "Search...", width ~750px of 1280 (est.), with a keyboard hint (Cmd Shift F) and AI search (natural-language queries return filtered leads). Right of it: phone/dialer dropdown and a help (?) dropdown. Browser-style back/forward arrows appear in the desktop app.
- Breadcrumb: only one level, a small "<- Workflows" back link above a page title on detail pages (workflow editor, run history).
- Page-level tabs sit under the title: Workflow = Overview / Edit / Report / Runs; Lead = Details / Files; Inbox = filter tabs (All, Emails, Calls, SMS, Tasks, Opportunities, Potential Contacts).
- No workspace switcher beyond the account menu; filters "All Users" and "All Leads" act as scope selectors in lists.

## 3. Visual language

Palette (measured from tour DOM unless noted):
- Content background `#F9F9F9`; cards/table/panels `#FFFFFF`; sidebar `#191919`; active nav pill `#2E2E2E` (radius 32px, height 32px); hover/subtle fill `#F1F1F1`; hairline borders `#E2E2E2`.
- Text `#2E2E2E`; sidebar inactive text `#C6C6C6`, active `#FFFFFF`; muted text gray (est. `#7A7A7A`).
- Links and lead names `#3781B8` (muted blue) in tables. Primary action blue `#1463FF` (marketing site, `rgb(20,99,255)`), same blue on tour "Start demo / Next" pills (est.).
- Status pills (from GIFs, est.): Won = green fill `#7FD48A`-ish with dark green text; "DEMO SCHEDULED" = yellow `#FFD21F` with black text; neutral gray chip for operators ("MORE THAN"); filter chips are light blue `#E6EFFF` with an x. Status label "ACTIVE" is blue text, "GOAL MET" green text on green tint, "FINISHED" gray, tiny uppercase bold.
- Activity type colors on icon discs: call = green tint, email = blue tint, task = orange tint, SMS = teal tint, opportunity = green trophy, note = gray.
- Light theme only observed; sidebar is dark in both. No dark content theme seen.
- Marketing page: text `#0F0D1F`, page bg `#EEF0F6`-ish (est.), soft blue/yellow/green flowing gradient ribbons behind hero; logo is three interlocking colored rings (blue/green/yellow).

Typography:
- App: system stack `-apple-system, system-ui, "Segoe UI", Roboto` (measured). Base 14px/400; table cells 13px/400; table header 14px/600; nav labels 14px/600; page title ("Leads") 24px/700; section labels uppercase ~11-12px letter-spaced (est.).
- Marketing: "Innovator Grotesk" variable (fallback Inter); body 15px/400, h1 60px/600 ("The CRM that sells with you"), h2 64-80px/500-700.
- Docs: system sans, buttons 14px.

Spacing and density: compact CRM density. Table row height 33px (measured) with 13px text; list rows in Runs history ~48px (est.); sidebar nav rows 32px high. Page gutters ~24-32px. Inner cards use ~12-16px padding.

Radii: pills 32px; small action buttons 16px (25px high, padding 4px 12px, measured); docs/marketing buttons 8px/14px; cards ~8px; kanban cards ~6px (est.); tooltips ~8px.

Borders vs shadows: borders first. Tables use 1px hairline row separators; sections in the lead sidebar are bordered rounded cards. Shadows only for floating things: dropdown menus and tour tooltip (`rgba(0,0,0,0.05) 0 5px 25px`, measured), dragged kanban card (soft drop shadow).

Iconography: monoline outline icons, ~18-20px, consistent stroke ~1.5px. Building icon = Lead, trophy = Opportunity, person = Contact, lightning = Trigger, clock = Wait, phone/envelope/chat/check = call/email/SMS/task. Emoji used for user-named smart views. Company logos/letter avatars (gray circle with initial) precede lead names.

Illustration: sparse. Chloe AI page uses a pointillist iridescent sphere; empty/"No matching opportunities" is plain gray text.

## 4. Components

Tables/lists (Leads list, `demo2.png`, `leads-filter.png`):
- Header row: title "Leads" with caret (dropdown of object types, i.e. switch Leads/Contacts), under it a building icon + count ("5", "386", "7,890") + underlined "Set limit" link.
- Toolbar right: icon buttons for Email (bulk), Call, list/dialer menu, "+", link/copy, "..." More.
- Filter row: "Add Filter" (circled plus) left; "Sort" and "Customize columns" (columns icon) right. With filters on: a collapsible "Filters [1]" bar -> "Find Leads matching [all of v]" -> "Where: [all of v]" -> blue chips (`Direction: "Outgoing" x`) -> "AND" chip, "Add Filter", "Add Group" (nested boolean logic).
- Columns (Leads): Name (logo/initial avatar + blue link; a hover arrow marks the current/next lead), call icon, email icon (quick-action columns, dimmed when no phone/email), Contacts ("Name +4"), Status (plain text; "Interested", "Customer", "Qualified"), Latest email date, # Emails, Latest call date, # Calls. Column headers have "..." menus and are drag-reorderable (dnd-kit). Horizontal scroll bar at bottom.
- Row select: checkbox appears left; selection reveals a bulk bar replacing the filters: "X  1 Workflow selected | Set Blackout Dates | Archive | Delete (red)" (`wf-list.png`).
- Workflow list row (~70px, est.): checkbox, blue name link, row of small colored step-type icons beneath (what the workflow does), then metric columns "0 Active / 0% Bounced / 33% Goal Met / 24d 14h Goal Met in" (big number over tiny label), date, owner avatar, pencil icon, "..." menu. Tabs "Active | Archived", search box, "All Users" filter, blue "+ New Workflow" pill top right.
- Row "..." menu: Edit / Remove from Sidebar / Copy link / divider / Delete view (red, trash icon) (`report2.png`).
- Inbox row (`inbox-items.png`): checkbox, circular icon disc (red for voicemail/missed), lead name blue + contact gray, gray "NO LEAD" chip, message summary, right-aligned outline pills "+ Create" and "Assign". Hover row gets very light gray fill.

Cards/panels: lead detail left column is a stack of collapsible sections, each a bordered rounded card with chevron, icon, UPPERCASE label, count chip, optional search icon, and "+" on the right (TASKS 1, OPPORTUNITIES 0, CONTACTS 1, CUSTOM FIELDS 0, custom-object sections like SCHOOL DISTRICTS) (`lead-sidebar.png`). Header band is slightly gray `#F3F3F3`-ish (est.).

Forms/inputs: search inputs are filled light gray (no border) with leading magnifier; selects inline as underlined text with caret ("Trigger: When an Opportunity is [created or updated v]"); sentence-style forms ("Matching: all of v these filters"). Filter picker is a right-hand slide-over: back arrow, title ("Emails"), x, "Find a Filter..." search, checklist of typed fields with type glyphs (`#` number, `T` text, calendar date, toggle boolean, list select), selecting a field expands operator dropdown + value select inline; footer "Cancel" text button + blue "Done" pill.

Buttons: primary = solid blue `#1463FF` pill/rounded, white 14px semibold ("Update", "Done", "+ New Workflow", "Next", "Start your setup call"). Secondary = white pill with 1px gray border and icon ("Note", "Email", "SMS", "Call" split-button with caret, "Activity v" on the lead header). Tertiary = text ("Cancel"). Destructive = red text + trash icon. Icon buttons = round gray disc (the "+" at lead header).

Tabs: underline style, active = dark text with 2px dark underline (Overview / Edit / Report / Runs; Details / Files with a count chip). Secondary activity-feed tabs are pill-ish text chips: All (selected, gray fill), Important, Conversations, Notes & Summaries, plus search field and filter icon.

Drawers/modals: right slide-over for filters; centered modal for assign-lead; small popovers for dropdowns; tour tooltips with arrow, "x" close, "N of 17", Back (red-outlined pill), Next (blue pill).

Badges: count chips (white circle with border, small number), blue unread pill on Inbox, "NEW" blue pill, "BETA" blue-outlined tag, status pill (colored, uppercase, bold 11px), "NO LEAD", "DRAFT" yellow-tinted tag on SMS drafts.

Toasts: bottom-center dark toasts with alt+T hotkey region (from a11y tree; visual not seen).

Empty states: centered gray one-liner ("No matching opportunities") inside the column.

Charts: only referenced; Reports page lists Activity Comparison, Activity Overview, Status Change, Sent Email, Opportunity Pipeline (kanban), Opportunity List, Opportunity Funnels. Chart visuals not observed.

Editors: workflow step cards embed email subject + preview body with merge fields `{{ contact.first_name }}`; template name shown next to type ("Email · Cold - Follow Up"). SMS templates and "snippets" for quick inserts. No rich editor screenshot seen.

## 5. Key screens

Leads list (`demo2.png`): sidebar | title row + toolbar | filter row | full-width table with 5-9 columns. Primary action: "+" (new lead) and Email/Call bulk buttons; secondary: Add Filter. Hierarchy: bold 24px title, muted count, dense data below. Smart views in the sidebar act as saved tabs of this same screen.

Lead detail (`demo-s4.png`, `lead-sidebar.png`): header with logo, name 24px, status dropdown pill ("Potential v"), "..." and, right-aligned, a row of five activity composers: Note, Email, SMS, Call (split with dropdown), Activity v. Below: two columns. Left (~35%, tabs Details | Files 126): collapsible cards ABOUT (address, URL, description + "Show more"), TASKS (task title, red overdue date chip, assignee avatar), OPPORTUNITIES, CONTACTS, CUSTOM FIELDS. Right (~65%): unified activity timeline with filter tabs (All, Important, Conversations, Notes & Summaries), search "Search keywords, people, and ..." and a filter icon. Timeline items are white cards with a colored circular type icon on a vertical rail: "Called Close Sales Team 15m", "SMS with Marcin Grajcar", with avatar and date at right, call summary text, "Show less...". This is the CRM equivalent of a unified inbox thread: every call/email/SMS/note/meeting/task on one lead in time order. Beta feedback bar at the bottom.

Inbox (help-site text + crops): a to-do list of things to react to. Three folders Inbox / Done / Future (snoozed). Tabs filter by type: Emails, Calls, SMS, Tasks, Opportunities, Potential Contacts. Each item shows the Lead Status so you can prioritize. Default sort oldest first. "Next Lead" button steps through the queue; per-lead badge shows count of open inbox items; mark-all-done and snooze-all in bulk. Contact local time with moon icon outside 8:00-18:00. Can view other users' inboxes (hidden under Lead Visibility roles).

Workflows list (`wf-list.png`): described in 4. Primary action "+ New Workflow". Metrics are inline per row (Active, Bounced %, Goal Met %, Goal Met in).

Workflow editor (`wf-editor.png`): header "<- Workflows", name "New Lead Outreach" 24px bold, tabs Overview / Edit / Report / Runs, top-right "..." Cancel (text) and blue "Update". Canvas is light-gray `#EEE`-ish with a single centered vertical column (~440px wide of 1280 total, est.). Pinned pills at canvas corners: "Workflow Goals" (top left) and "Recipient and Schedule" (top right). Flow: Trigger card (lightning disc, "Trigger", "MANUAL" chip, "Trigger manually on Leads") -> thin arrow -> pill "Run once per Contact" -> arrow -> step cards. Each step card has a gray header strip "clock Wait 1 day" then a body row with a colored icon disc and the type ("Call", "Email · Cold - Follow Up") plus a preview of subject/body. Vertical single-lane, no branching canvas. Trigger config card (`wf1.png`): "Trigger: When an Opportunity is [created or updated v]" / "Matching: [all of v] these filters" / chips ("Current status: WON x", "Value: MORE THAN 1000 x") / "+ Add Filter".
Trigger types: Lead, Custom Activity, Opportunity, Contact, Call, Meeting, Form submission events, or manual. Draft state until name + trigger + 1 step. Workflow Goals auto-stop a run (reply received, meeting booked, status changed). Communication windows, blackout-date calendars, timezone handling, run once vs run multiple, email sending limits.

Workflow runs (`wf-runs.png`): two-pane. Left "History" list (~280px, filter "All Runs v") of runs with date + lead name and a status tag (ACTIVE blue, FINISHED gray, GOAL MET green). Right: "Run started Sep 8, 2025 at 4:39:33 pm (21d ago) ACTIVE", lead and owner, "Actions v", then a numbered vertical timeline: "Trigger: Contact", "1 Update Lead", "2 Create Opportunity", "3 Task", "4 Call", each with timestamp, green check (done) or hourglass (pending), chevron to expand. This is a great model for a per-lead sequence progress view.

Opportunities pipeline (`pipeline.png`): title "Sales Pipeline"; filter bar with "Expected: This Year v", pipeline selector "Sales v", "All Leads v", "All Users v". Kanban columns have chevron-arrow-shaped header edges, a status pill (yellow "DEMO SCHEDULED") and "4 OPPORTUNITIES", then a light-blue band "ANNUALIZED VALUE ...... $1,028,600" (label left, dotted leader, value right). Cards: lead logo + blue lead name, divider, then user avatar + "$70,000 monthly" (bold) + "55% on 1/21/2025" (confidence on est. close date). Hover reveals pencil, trash, and "add task/reminder" icons; hovered card lifts with shadow. Empty column: centered "No matching opportunities". Opportunity fields: Status, Confidence, Value (one-time or monthly), Estimated Close, Contact, User, Comments, custom fields. Expected value = Value x Confidence. Also an Opportunity List and Funnel report.

Leads filter slide-over (`leads-filter.png`, `leads-list.png`): detailed above; two-level scoping ("Find Leads where..." vs "Find Emails where...", "Find the latest Email where...").

Smart views: saved filters pinned to sidebar, shareable (Copy link), editable, deletable, with scheduled counts via API; AI search turns natural language into filters.

Conversations > History (`demo-s11`): list of completed calls as cards with AI summary bullets, call recording player (1x speed, Play, Download, Expand Transcript), feedback prompt chips ("No issues" / "I had an issue").

Chloe AI page (`demo-s7.png`): centered hero, "Chloe calls. You close." 40px bold, gray subhead, five uppercase capability chips (CALLS LEADS, RUNS DISCOVERY, HANDLES OBJECTIONS, BOOKS MEETINGS, TRANSFERS TO REPS), blue "Start your setup call", "It only takes 3-5 minutes. What to expect", then a 3-column grid of use-case cards (white, `#F1F1F1` bordered, bold title + 2-line description).

## 6. Interaction patterns

- Onboarding: 17-step guided tour with anchored tooltips, a highlighted blue ring around the target (3px blue outline), "N of 17", Back/Next. Product itself teaches via inline copy in timeline (example call explains "This is how an SMS will appear on your feed").
- Setup checklists: Chloe has "Start your setup call - It only takes 3-5 minutes" as a single guided setup CTA rather than a checklist.
- Inline editing: status pill is a dropdown on the lead header; tasks, opportunities, contacts editable from sidebar cards via pencil icon; "Edit note" inline; hover on kanban card reveals edit/delete.
- Quick actions inside rows: phone and email icons in every Leads row open composers without leaving the list.
- Keyboard shortcuts: Cmd+Shift+F global search, Cmd+J Chloe chat, Alt+T notifications, built-in Inbox shortcuts (documented list for Done/snooze/next). Drag-handles accessible with space/arrow keys.
- Hover states: row light-gray fill; icons brighten; kanban card lifts with shadow plus action icons; tooltips with caret ("View all Saved Views").
- Progressive disclosure: collapsed section cards with counts; "Show more... / Show less..." on text; "Set limit" link; filter groups ("Add Group") only when needed; AI summary collapsed under call.
- Real-time status: unread Inbox badge; workflow rows show live "Active" counts; run timeline shows pending hourglass vs green check; Live Calls page; "Sorry, we're experiencing an issue with our services / See details" status banner at top of app.
- Bulk selection swaps the filter bar for an action bar with a count.

## 7. Responsive / mobile behavior

Not observed in the web app (tour is fixed desktop; help page notes a separate Close Mobile App and Desktop App). The tour iframe at 1280px scrolls horizontally when columns overflow (bottom scrollbar), and the sidebar can collapse to icons. Marketing nav collapses behind "Product" and "Resources" dropdowns; mobile marketing layout not checked.

## 8. Ideas worth borrowing for rightnow-ai

- Dark `#191919` icon+label sidebar (224px, collapsible to ~44px rail) with a lighter `#F9F9F9` content canvas: strong figure/ground and instantly "app-like". Active item = `#2E2E2E` full-pill.
- Inbox as a to-do queue: Inbox / Done / Future (snoozed) sub-nav, type tabs (Replies, Out-of-office, Bounces, Tasks), lead-status shown on each row, oldest-first default, "Next Lead" button to step through, unread count pill in the sidebar.
- Smart Views section in the sidebar: saved lead filters, emoji-prefixed, drag-sortable, pin/unpin, "View all", search. Map to saved lead segments and saved campaign filters.
- Filter builder: "Find Leads matching [all of v]" -> chips -> "AND" -> "Add Filter | Add Group", with a right slide-over field picker grouped by object ("Find Leads where..." / "Find Emails where...") and type glyphs. Strong for sequence-activity filters (opened, replied, bounced).
- Table conventions: 33px rows at 13px text, blue name links, quick-action icon columns, draggable column headers with "..." menus, bulk bar that replaces filters on select ("1 selected | Archive | Delete").
- Automation editor: single vertical lane with Trigger card, "Run once per Contact" pill, and step cards with a "Wait N days" header strip; corner pills for "Goals" and "Recipient and Schedule". Directly matches a sequence builder; add "Workflow Goals" = stop on reply / unsubscribe / meeting booked.
- Runs view: left history list with status tags, right numbered timeline with check/hourglass icons. Use for per-lead sequence progress and for ScheduledMessage status (SENT/HELD/FAILED).
- Per-row automation metrics (Active / Bounced % / Goal Met % / time-to-goal) in a workflow list; use for campaign list (Sent, Bounce %, Reply %).
- Lead detail layout: collapsible count-chip section cards left, unified activity timeline right with type-colored icon discs and filter tabs; composer buttons (Note, Email, Call, Activity) top-right.
- Kanban: arrow-shaped column headers, colored status pill, value rollup band in each column ("ANNUALIZED VALUE ..... $x"), card with avatar + value + confidence on date, hover icons.
- Sentence-style inline selects for configuration ("Trigger: When ... is [created or updated v]") reduce form chrome.
- Communication windows, blackout calendars and email-sending-limit notes are first-class in workflow settings; show them as pills ("Run once per Contact", "Mon-Fri 9-5 ET").

## 9. Why it works

Close looks calm and professional because it uses very few colors: a near-black sidebar, a pale gray canvas, white cards, one saturated blue for the single primary action on a screen, and small bright tints only to encode meaning (status pills, activity-type icon discs). Everything else is hairline borders and 13-14px system-font text at a compact 33px row height, so a lot of data fits without feeling cluttered, and shadows are saved for things that float. Its information architecture mirrors the sales job in the order a rep thinks: what needs me now (Inbox), what's at stake (Opportunities), who (Leads, Contacts), what runs automatically (Workflows), what happened (Conversations), how am I doing (Reports), with saved Smart Views right under that list as one-click work queues. Each screen has one obvious structure: title + count + filters + dense table, or a lead header with action buttons above a timeline, so users learn one pattern and reuse it. The automation builder is a simple top-to-bottom list of cards with plain-language "Wait 3 days / Email / Call" steps, and the run history shows the same steps with timestamps and check marks, which makes a complex system feel like a checklist. Copy is literal ("Set limit", "Add Filter", "Goal Met in") and the product teaches itself with a short guided tour, so a newcomer can tell within seconds that this is one place to call, email, text and track deals for a lead.
