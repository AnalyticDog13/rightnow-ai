# Apollo.io (prospecting + sequences) - UI reference

Method note: the live app requires login and was not accessed. Everything below comes from marketing product renders and the official knowledge-base screenshots (real app captures, downscaled to about 755px wide in my viewer, so small text was read at roughly 40-50% scale). Numbers marked "(est.)" are estimated from images. Only the marketing site's HTML could be measured live.

## 1. Sources

URLs viewed:
- https://www.apollo.io/product/sales-engagement (marketing page; product renders; CSS measured live)
- https://knowledge.apollo.io/hc/en-us/articles/30919852777229-View-and-Respond-to-Emails (text + 13 screenshots)
- https://knowledge.apollo.io/hc/en-us/articles/4425592135821-Access-and-Use-Email-Analytics (text + 6 screenshots)
- https://knowledge.apollo.io/hc/en-us/articles/4409237165837-Sequences-Overview (text + 2 screenshots)

Screenshots (in `C:\Users\willi\AppData\Local\Temp\claude\C--Users-willi-OneDrive-Desktop-GitHub-Repositories-rightnow-ai\f8a7d979-9487-46fe-b300-dcca3fab7b2a\scratchpad\screenshots\apollo\`):
- `hero.png` (AI Assistant launcher render)
- `sequence.png` (stylized sequence-step render with "Add a step" menu)
- `message.png` (Tasks / Email task detail with AI Insights panel render)
- `prioritize.png` (Tasks home render with icon sidebar)
- `emails-i14.png`, `emails-i15.png`, `emails-i17.png` (Emails hub, real app)
- `emails-i21.png` (bulk-action bar, real app)
- `analytics-i8.png` (Emails > Analytics tab: stats + funnel, real app)
- `analytics-i9.png` (Emails filter sidebar, real app)
- `sequence-i65.png` (sequence editor, real app)
- `sequences-overview-i9.png` (sequence Contacts tab with filters, real app)

That is 8 real in-app screens plus 4 high-fidelity product renders, so no fallback to Woodpecker was needed.

Not observed: people search table, mailbox settings screen, CRM/deals board, mobile app.

## 2. Information architecture and navigation

App shell: a narrow, icon-only, fixed left rail (about 30px wide at the screenshot's scale, so roughly 56-64px real (est.)) plus a content area with a page title, tabs, and a toolbar. There is no top bar with global nav. The page header sits inside the content area: title at the left, global-ish actions at the right (Emails page: "Manage mailboxes", "Deliverability stats", both white buttons with a thin border).

Rail, top to bottom (icons only, tooltips presumably; from `prioritize.png` and the real screens):
1. Apollo asterisk logo (top)
2. Search (magnifier, opens a global search)
3. Home
4. divider group: People (two-person icon), Accounts/Companies (building), Lists (bullets icon), a "saved/visited" icon
5. divider group: Sequences (paper-plane, the active item in `sequence-i65.png`), Emails (envelope), Calls (phone)
6. divider group: Calendar/meetings, Conversations (chat bubble), Deals ($)
7. divider group: Tasks (check circle), Workflows/automation (lightning bolt, with a green status dot in one screenshot), Analytics (bar chart)
8. Bottom: a yellow-highlighted icon (admin/enrichment), Settings gear (with an orange notification dot), user avatar "A"

Grouping is by job: find (people/accounts/lists), reach (sequences/emails/calls), manage (calendar/conversations/deals), operate (tasks/workflows/analytics). Dividers separate groups; no text labels.

Active state: the active icon sits in a solid near-black rounded square with a white glyph (see Emails, Sequences, Calls in the three screens). Inactive icons are plain dark gray glyphs.

Workspace switcher: not observed. Breadcrumbs: a minimal one on the sequence page ("Sequences >" above the title). Sub-navigation is tabs under the page title.

Page-level tabs:
- Emails: `All emails | Templates | Analytics [New]` (the "New" badge is a green pill)
- Sequence detail: `Editor | Contacts | Emails | Tasks | Phone Calls | Activity | Report | Settings`. Sequence Contacts view: `Overview | Contacts | Emails | Tasks | Phone Calls | Activity | Report | Settings`.
- Tasks: `All tasks | Email | Calls | Linkedin | +` (underline tabs with a plus to add a filtered tab)

Command palette: a search icon at the top of the rail; AI assistant surface ("I'm your AI Assistant, here to help you get things done") offers five task chips. No keyboard shortcut observed.

## 3. Visual language

Marketing site (measured live): body font "soehne" 14px / 400, rgba(0,0,0,0.87); headings "seasonMix" (a serif) 44px / 550 (h1) and 32px / 550 (h2); paragraphs "abcDiatype" 16px / 400; buttons radius 8px. White page background.

In-app (from images, est.):
- Palette: near-white canvas (#FFFFFF app, #F2F2EE warm gray for tinted panels in renders), near-black ink (#111) for active nav and primary dark buttons, and one brand accent: loud yellow (about #F5FF00 / #FAFF00) used for the single primary CTA per screen ("Add Contacts", "Send now") and in the active rail icon highlight. Tints: soft green (#D8F3DC-ish) for success/positive, soft red/pink (#FBDADA with #B3261E text) for Bounced/Not sent/Highest, soft cyan (#CFF3F8) for info tags ("Medium", "Why now"), soft purple for AI generated text and call step icon.
- Charts use a single muted steel blue (about #457BB0 solid, #E8F0FB light fill for the "lost" portion of each bar).
- Light mode only observed; dark mode not observed.
- Typography in app: a clean grotesque sans for UI, small (table text about 11-12px (est.), column headers about 9-10px uppercase in a monospace-ish face with letter spacing, e.g. "RECIPIENT", "STATUS", "SENT", "SEQUENCE", "MESSAGE", "SENT BY", "ACTIONS"). Render screens use a serif display face for big headings ("Tasks", "Email Michael Smith", card titles), which echoes the marketing site.
- Density: compact-comfortable. Email table rows about 27px tall in the 755px-wide downscale, which is about 40-44px real (est.) with a two-line message cell (bold subject, gray preview).
- Radii: buttons and inputs about 6-8px; cards about 10-12px (est.); pills fully rounded; the sequence step card about 8px.
- Borders over shadows: 1px light gray borders on cards, inputs, buttons; shadows only on floating menus (the "Add a step" popover has a soft large shadow).
- Iconography: thin 1.5px outline icons (Lucide/Feather-like), 16px in content, ~20px in the rail. Status in tables uses small circular filled icon badges in green.
- Illustration: only on marketing renders: saturated gradient backdrops (yellow-to-pink-to-blue, "holographic") behind otherwise austere white UI cards. The app itself uses no illustration in the screens I saw.

## 4. Components

Table / list (Emails hub, `emails-i14.png`):
- Toolbar row above table: saved-view dropdown "My inbox" with table icon, "Show Filters" (sliders icon), inline "Search emails..." input, then right-aligned "Save as new view" button and "View options" (gear).
- Columns: checkbox, RECIPIENT (underlined link name), STATUS (cluster of 3-4 icon badges), SENT (date "16 Dec, 2024"), SEQUENCE (underlined link), MESSAGE (bold subject + gray one-line preview, truncated), SENT BY (small gray circular initials avatar), ACTIONS (three-dot menu).
- Status cell: a row of circle icons in order sent/delivered, opened (eye), clicked (pointer), replied (arrow). Filled green = happened, outline gray = not happened. A first icon can be a ring-progress (partially filled) variant. Exceptions use a text pill: "Bounced" and "Not sent" in pink with red text, and a red eye-off for failed. Hovering a status shows a tooltip with more insight.
- Row hover: light gray fill (est.). Selected rows: light warm-gray fill with checked black checkbox.
- Bulk bar (`emails-i21.png`): appears in place of the toolbar when rows are checked: "Clear 2 selected" then outline buttons with icons: Reschedule, Email from Different User, Delete, Skip, Retry Undelivered Emails, Export. Header checkbox shows an indeterminate dash.
- Filters (`analytics-i9.png`): a left filter panel (about 140px wide in downscale, est. 240-280px real) with collapsible accordions, each with a leading icon: Status, From User, Sentiment, From Email, Sequences, Contact Lists, Date Range, Not Sent Reason, Email Opened (with a help "?"), then a full-width "Clear filters" button. Button toggles to "Hide Filters". Sequence Contacts view uses a similar panel with a header "Filters [1 x]" badge and checkbox tree (Paused (3) > Auto resume date scheduled (1) > Out Of Office (1)), with counts in gray parentheses.
- Saved views: "Save as new view" turns a filter set into a named view in the left dropdown.

Cards: white, 1px border, radius ~12px, generous padding. Task cards (`prioritize.png`) have a pink "Highest" pill, a 2-line large serif headline, and below it a small icon+count list (call tasks, email tasks, action items). Analytics cards have a title at top-left and a settings/overflow icon at top-right.

Stat tiles (`analytics-i8.png`): "Email Stats" card with four metrics in a row separated by vertical hairlines: "# Emails Sent 17,415", "# Emails Opened 4,480", "# Emails Replied 1,563", "% Emails Spam Blocked 0%". Each has a small label, a bold ~14px (est.) number, and a delta chip (green with up arrow "4,722", red with down arrow "386") captioned "From Jun 2".

Funnel chart: five tall vertical bars with percent + count above: 100% 428926 delivered, 47% 199724 opened, 0.5% 2162 clicked, 21% 92190 replied, 1% 5691 interested. Each bar shows solid steel blue for the share and pale blue for the remainder up to the previous stage; labels below ("# Emails Delivered", etc.). No gridlines or axes.

Buttons:
- Primary CTA: yellow fill, dark text, small radius (e.g. "Add Contacts" with a dropdown caret, "Send now" with a send icon).
- Dark: near-black fill white text ("Save changes", "Add a step" with plus).
- Secondary: white fill, 1px border, dark text (Share, Workflows with caret, Manage mailboxes, Deliverability stats).
- Ghost/icon: three-dot overflow (`...`), expand arrows.
- Split buttons: "Schedule and mark complete" with a chevron half; toggles ("Activate" switch with label).

Tabs: text tabs with a 2px dark underline on the active one; muted gray for inactive; small status badge ("New") inline.

Pills/badges: sequence contact row shows "Paused" (gray fill), "Step 2" (dark gray fill, white text), "Cold" (light gray); sentiment/priority use soft tints (cyan "Medium", pink "Highest").

Forms/inputs: search inputs with magnifier at left, 1px border, ~30px high; dropdowns with a caret; AI prompt input at the foot of the composer: "How do you want to update this email?" with a microphone icon.

Menus/popovers: "Add a step" popover lists five items with leading icons: Automatic email, Manual email, Phone call, Action item, Send connection request (first row highlighted gray).

Toasts / modals: not observed. Tooltips: dark rounded tooltip in the Contacts view ("Sequence paused. Auto-resuming on March 10th 2025 based on return date in out-of-office message.").

Empty states: not observed (the Tasks render uses gray skeleton rows as a placeholder).

Editor: email composer with a segmented control above the body: `Assisted | Outreach | Personalize | Default | Context | Guidelines` (black filled pill for the active segment, outline pills for others). Subject line is large serif; AI-generated draft text is rendered in purple to flag it as AI output; a bottom command-style input updates the draft by prompt.

## 5. Key screens

### 5.1 Emails hub (`emails-i14/i15/i17.png`) - inbox/outbox log
Layout: rail + page header (title "Emails", two outline buttons at far right), tabs row, toolbar row, full-width table. No reading pane in the list; clicking a row opens the thread (per the article: shows original email and replies, reply icon, "Reply now" or "Schedule"). This is a sent-mail log, not a conversational inbox: primary object is the email, columns show delivery state. Primary action: open an email / filter. Hierarchy: status icons and sequence are the first thing the eye reads after recipient; message preview is the widest column.
Row action menu (from article): Mark Interested, Edit, Delete, Delete email and finish sequence, Schedule, Reply to thread, Show diagnostics information, CRM sync history, Retry, Skip email and continue sequence, Unmark as reply.
Filter facets (article): Status (drafted, delivered, replied, bounced), From user, Sentiment (auto-analyzed reply sentiment, e.g. willing to meet, unsubscribed), From email, Sequences, Contact lists, Date range, Not sent reason (e.g. missing dynamic variable), Email opened.
Bulk reschedule options: immediately, in 1 hour, 2 hours, 24 hours, next business day, 7 days, 30 days.

### 5.2 Email analytics tab (`analytics-i8.png`)
Top bar: "Select timeframe" dropdown, "+ Add filter" button, and a yellow "Go to Analytics" button at far right (escalates to the full analytics section). Below: stacked full-width cards: Email Stats (4 KPIs with deltas), Email Funnel (5 bars). Each card has a settings icon and the funnel an overflow menu. Primary action: change timeframe/filters. Hierarchy: KPIs first, funnel second. The article states the order of trust: delivered, replied, interested first; opens and clicks are "directional".

### 5.3 Sequence editor (`sequence-i65.png`)
Header: breadcrumb "Sequences >", title "Travel agent owner outreach 2025" with a star (favorite), right side: "Share", "Workflows v", yellow "Add Contacts v", an "Activate" toggle (off by default), overflow `...`. Tabs: Editor | Contacts | Emails | Tasks | Phone Calls | Activity | Report | Settings. Below tabs: a "2 steps" collapse control (left) and "Expand steps" + dark "Save changes" (right).
Canvas: a vertical timeline. Between steps are small pill chips on a thin connector with arrow: "Email sends in 30 minutes" and "Schedules task in 3 days" (each with a pencil icon to edit the delay). Each step is a white bordered card: icon + "Step 1: Automatic email" and, on the right, a row of live count labels: Active, Paused, Not sent, Bounced, Finished. The card's second row contains the email variant: an on/off toggle, an "A" variant letter badge, the subject "Speed Up Analytics, {{first_name}}", and a row of funnel stats: Scheduled, Delivered, Bounce, Spam Blocked, Open, Click, Reply, Interested, Opt out. Step 2: "Phone call" with note "Quick intro call - Share name and service" and counts Scheduled, Unknown. "+ Add a step" button centered at the bottom. The currently selected step is outlined with an orange annotation (doc highlight, not product UI).
Hierarchy: per-step performance lives directly on the editor, so building and measuring is one screen. Step types (from `sequence.png`): Automatic email, Manual email, Phone call, Action item, Send connection request (LinkedIn). Render shows steps with colored circular icon chips: green (email), cyan (connection request), purple (call + voicemail); labels "Day 1", "3 days after" as editable pills above each step.

### 5.4 Sequence Contacts view (`sequences-overview-i9.png`)
Two columns: filter panel at left (Filters header with count chip, search contacts, "Sequence Status" accordion with checkbox tree and counts), list at right. Above the list: a summary strip of stage counters: Total 3, Cold 3, Evaluating O..., Interested, Current Clie..., Meeting Set (each a number over a small label, separated by hairlines). Toolbar of icon-only bulk actions (stop, remove, pause, play, assign, edit, more) and a sort dropdown "Contact Last Activity". Rows: avatar initials, blue contact name link, state pills ("Paused", "Step 2", "Cold"), channel icons (email-sent check, phone, LinkedIn with a count, Salesforce cloud icon, overflow), owner avatar at right. Tooltip on the Paused pill explains the auto-resume reason. Primary action: act on contacts in bulk.

### 5.5 Tasks home (`prioritize.png`, render)
Page title "Tasks" (serif, large). Collapsible "Recent activity this week" row: "28 Tasks completed, 47 Emails sent, 24 Calls made, 4 Positive calls" (number large, label small). Collapsible "Prioritized for you": two cards side by side with pink "Highest" pills, a plain-language headline ("12 tasks from recently created sequence, Target Accounts Q1"; "8 time-sensitive tasks tied to expiring triggers like trial endings, or deadlines.") and icon counts. Below: underline tabs All tasks / Email / Calls / Linkedin / + and a gray skeleton list.

### 5.6 Task email composer with AI Insights (`message.png`, render)
Breadcrumb-style title "< Tasks / Email Michael Smith" with a cyan "Medium" priority tag. Left: composer card with From/To lines, the six-segment mode switcher, Subject, purple AI draft body, a prompt bar ("How do you want to update this email?") with mic, and footer actions: "Schedule and mark complete" (split button) and yellow "Send now". Right: tabbed "AI Insights | Olain | ..." panel with contact header (name, title@company, LinkedIn and Website links) and three labeled cyan-chip sections: "Why now", "Key context", "Strategy". It explains the recommendation next to the work area.

### 5.7 AI Assistant launcher (`hero.png`, render)
Centered card on a gradient: asterisk logo, serif greeting "I'm your AI Assistant, here to help you get things done", gray subtext "Choose a task and I'll take it from there:", five outlined pill buttons with icons: Find ideal prospects, Research accounts for fit, Craft outbound sequence, Analyze sales performance, Automate workflows.

## 6. Interaction patterns

- Setup order is stated as the sequence overview's "Get Started": Link your mailbox, Create a sequence (manually, template, or AI-generated), Add contacts (from searches, lists, CSV, profiles, workflows; enrollment warnings are shown first), Manage contacts, Report. Checklist UI not observed.
- Status feedback: live per-step counters on the editor (Active/Paused/Not sent/Bounced/Finished) and email-level funnel counts; tooltips explain state (paused due to out-of-office, with auto-resume date); "Not sent" has a filterable reason.
- Saved views: filter set becomes a named view.
- Bulk actions replace the toolbar when rows are selected, with "Clear N selected" as the first item.
- Hover insight: hover status icons for details; hover pill for the reason.
- Inline editing: delay pills on the sequence timeline have pencil icons; variants toggle on/off inline; "Save changes" is an explicit save.
- Progressive disclosure: "2 steps" / "Expand steps" collapse; filter panel hidden behind "Show Filters"; analytics tab links to deeper "Go to Analytics".
- AI everywhere: draft generation, rewrite prompt bar, reply sentiment auto-classification, task prioritization, AI research fields. AI output is visually marked (purple text).
- Guardrails in analytics: bot and self-caused opens/clicks excluded by default, opens flagged "directional". Open tracking requires explicit activation.
- Keyboard shortcuts and toasts: not observed.

## 7. Responsive / mobile behavior

Not observed (no mobile screenshots found; app screens are desktop only). Marketing site not tested at 390px.

## 8. Ideas worth borrowing for rightnow-ai

- Icon-only left rail with group dividers (find, reach, manage, operate) and a near-black filled square for the active item. Saves width for dense tables; add tooltips and a labeled expanded state for new users.
- One yellow-style accent color reserved for the single primary action per screen; everything else is white, gray, black. Pick our own accent and keep the rule.
- Email list status as a row of tiny state icons (sent, delivered, opened, clicked, replied) filled-vs-outline, plus text pills only for exceptions (Bounced, Not sent, Held). Map our HELD state to an amber pill with a tooltip reason.
- "Not sent reason" as a first-class filter; we have freshness gate and HELD outcomes, so a Reason column and filter would make queue behavior legible.
- Sequence editor as a vertical timeline with delay pills between step cards, and live per-step counters (Scheduled, Delivered, Bounce, Open, Reply, Opt out) on each card so build and results share one screen. Add A/B variant letter badges and per-variant toggles.
- Sequence tabs: Editor | Contacts | Emails | Report | Settings.
- Contacts-in-sequence view: left filter tree with counts, top stage-count strip (Total, Interested, Meeting set...), icon-only bulk toolbar, state pills (Paused, Step 2), tooltip explaining auto-pause reasons (out-of-office auto-resume).
- Bulk bar replaces toolbar with "Clear N selected"; offer Reschedule presets (1h, 2h, 24h, next business day, 7d, 30d).
- Saved views via "Save as new view" next to the filter button.
- Analytics: KPI strip with delta chips against a prior period, then a funnel of bars with pale "lost" fill. Lead with delivered, replied, interested; label opens/clicks as directional; exclude bots by default with a toggle (matches our no-fabricated-engagement principle).
- Row action menu with diagnostic items: "Show diagnostics information" (attempt history, scheduled date), "Retry", "Skip and continue sequence".
- Task-style "Prioritized for you" cards with plain-language headlines on the home screen and a weekly activity strip (numbers big, labels small).
- Mark AI-written content with a distinct color and give a prompt bar under the composer for iterative edits.
- Reply sentiment auto-label (willing to meet, unsubscribed) as a filter facet in the unified inbox.

## 9. Why it works

Apollo's in-app UI is calm because it spends its contrast budget in exactly two places: a near-black active state and one electric yellow call to action, while every other surface is white or pale gray with hairline borders, so the eye always lands on "what do I do next" and "what state is this in". The icon-only rail, underlined tabs, and consistent toolbar (view, filters, search, save view, options) repeat on every page, so once a user has learned the Emails table they already know the Sequences contacts list. Meaning is carried by small, regular signals rather than words: a row of filled or outlined circles tells you how far an email progressed, a pink pill appears only when something went wrong, and counters sit directly on each sequence step so building and measuring are the same view. The software's purpose reads from its structure alone: find people, enroll them in a timeline of steps with delays, watch each step's counts turn into a funnel, and act on tasks the system prioritizes for you. Plain-language labels ("Email sends in 30 minutes", "Schedules task in 3 days", "Why now / Key context / Strategy") keep complex automation readable, and tooltips explain the rare surprising states instead of hiding them.
