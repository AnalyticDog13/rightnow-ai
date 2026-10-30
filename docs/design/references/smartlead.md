# Smartlead: UI reference spec

Scope note: the live app (app.smartlead.ai) requires login and was not opened. Everything below comes from real in-app screenshots embedded in the Smartlead help center, the mobile-app article, and the marketing site. Measurements from images are marked "(est.)". Screens I did not see are listed as not observed.

## 1. Sources

Pages viewed (Chrome DevTools, isolated tab "smartlead"):
- https://helpcenter.smartlead.ai/en/articles/63-smartlead-s-smart-adjusting-algorithm-for-mailbox-warmups
- https://helpcenter.smartlead.ai/en/articles/269-how-to-bulk-update-warmup-for-mailboxes (text; its only image is a 756x160 logo, so no bulk-update dialog screenshot)
- https://helpcenter.smartlead.ai/en/articles/198-smartlead-mobile-app-how-to-manage-leads-effectively
- https://helpcenter.smartlead.ai/en/articles/172-side-bar-all-you-need-to-know (master inbox)
- https://helpcenter.smartlead.ai/en/articles/170-keyboard-shortcuts (text)
- https://helpcenter.smartlead.ai/en/articles/442-how-to-create-an-email-campaign-in-smartlead-the-new-version
- https://helpcenter.smartlead.ai/en/articles/292-what-is-smart-funnel (CRM kanban, plus new sidebar)
- https://helpcenter.smartlead.ai/en/ , /collections/22, /23, /35 (article lists, used for IA)
- https://www.smartlead.ai (marketing hero, computed styles; section images were icons or illustrations, not UI)

Screenshots, in `C:\Users\willi\AppData\Local\Temp\claude\C--Users-willi-OneDrive-Desktop-GitHub-Repositories-rightnow-ai\f8a7d979-9487-46fe-b300-dcca3fab7b2a\scratchpad\screenshots\smartlead\`:
- `warmup-settings.png` (account modal, Warm Up tab)
- `mobile-app-4up.png` (Home, Inbox, Analytics on a phone; 4th screen cropped)
- `bulk-warmup-page.png` (help center chrome only)
- `home-top.png` (marketing hero), `home-imagery.png` (deliverability gauge illustration)
- `master-inbox-sidebar.png` (older-generation master inbox, 2 screens)
- `campaign-create.png` (new nav + campaigns list, empty leads tab, upload settings modal, field mapping modal)
- `smart-funnel.png` (new sidebar with AI agents home, and the CRM kanban)

Not observed: sequence editor itself, campaign analytics page, leads table, Email Accounts table, automations builder, command palette, dark mode of the web app.

## 2. Information architecture and navigation

App shell (web, newest generation, `campaign-create.png` and `smart-funnel.png`):
- Top bar, full width, dark navy (about #000066 to #0a0a6e, est.), about 64px tall (est.): hamburger (collapses sidebar) at far left, logo "Smartlead.ai" in white, right side: white-filled "+ Ask AI" button, bell, "? Help", round avatar with chevron.
- Left sidebar about 230px wide (est.), light background, with collapsible labelled groups. Labels are small, grey, sentence-case with a chevron:
  - Engage: Prospect Finder, Campaigns, Master Inbox, Sender Accounts, Calls (green "New" tag)
  - AI Team: AI Assistant, AI Agents, Automations (purple "Beta" tag)
  - Inbox health: Deliverability, Sending Servers
  - Pipeline: Deals, Client Portal, Connectors, Services, Admin Services
  - Performance: Analytics
  - Footer icon row: learn, support headset, calendar, invite person, help.
- Each item: 20px outline icon + label, about 42px row height (est.). Active item has a pale lavender pill fill with a slightly stronger icon; a red callout box is only the help-article annotation.
- Hover tooltip on a nav item: dark rounded card with a bold title and a one-line description (for example "Email Campaigns: Build and send multi-step cold email campaigns", "CRM: Track leads through your sales pipeline").
- The sidebar can collapse to a 60px icon rail (est.) (seen in the kanban screenshot and in the older app).
- Second-level sidebar: a section opens a second narrow column (about 200px, est.) with its own heading and items. Examples: "SmartAgent" with Home, My Agents, Templates, AI Connections; "CRM" with Smart Funnel, All Leads, Calls, then "CUSTOM CRM" saved boards (client, abc, full access, ...) each with a kebab menu and a search and plus icon in the group header. This collapses with a "<<" button.
- Older generation (Dec 2023 screenshots): thin 64px icon rail at the far left, then a 190px mailbox sidebar, then list, then thread. Same pattern, so the structure has stayed stable.
- Workspace switcher: not observed. Client accounts exist ("Client Portal", white-label) but no switcher was visible.
- Global search / command palette: not observed. "Ask AI" button in the top bar is the nearest thing. Search is per-list (search box above the lead list).
- Breadcrumbs: not used in the app. Campaign detail shows a back arrow, campaign name, a "Draft" badge and a subtitle ("Configure your email campaign"), then a tab row.
- Campaign detail is a tabbed wizard: Leads, Sequence, Email Accounts, SubSequences, Settings. Top right has "Review and Launch" and "Next: Sequences" buttons (grey while disabled).
- Mobile app bottom nav: Home, Inbox, Analytics, Assistant, More.

## 3. Visual language

Measured (marketing site `www.smartlead.ai`, computed):
- Font: Inter. Body color rgb(40,34,75) (#28224B, deep indigo-ink, not black). Page background rgb(251,251,251) (#FBFBFB). Marketing H1 is very large (about 96px, est.), bold, near-black, with the second line "AI Outbound" in a violet to blue to green gradient.
- Primary button: filled indigo-violet, about #4F46E5 to #5B4CF5 (est.), white text, square-ish corners (about 4px, est.). Secondary: white with 1px indigo border and indigo text.
- Promo bar: purple to deep-blue gradient.
- Help center font: proxima-nova; hero band is periwinkle #7479E8 (est.).

From in-app images (est.):
- Palette: navy header (#000066-ish), violet primary (#5B5BD6 to #6D5CE8) for buttons, active tab underline, selected pill, toggles and "View All" links. Surfaces white on a very light grey-lavender (#F7F7FB). Text near-black for titles, mid grey (#6B7280) for secondary.
- Status colors, used as text on a pale tinted pill: green "Active", "Interested", "Completed" check; orange/amber "Information Request", "Paused"; grey for "Blocked", "Draft", "Completed" in the mobile list; blue for "Completed" icon tile. Kanban columns each get their own color on a bold title with a colored underline: New Lead (violet), Email Sent (teal), Reply Received (orange), Cold Lead (red/pink), Meeting Booked (pink/purple).
- Light mode only seen on web. Mobile app has Light, Dark, System (documented, not seen).
- Typography in app: sans (Inter-like or Proxima), page title about 22px semibold, section title 16px semibold, body 14px, secondary 12-13px grey. Table/list names are semibold 14px with a smaller grey line below.
- Density: medium. List rows 72-90px tall in the campaign list (est.); the master inbox list rows about 70px with three lines (name + date, email, snippet) then a campaign chip. The older UI is denser (14px text).
- Radii: cards and modals 12-16px, inputs and buttons 6-8px, pills fully rounded or 6px, toggles fully rounded. Mobile stat cards about 16px.
- Borders vs shadows: hairline 1px dividers between rows and sections (#E5E7EB, est.); cards use a very soft shadow plus a 1px border; modals use a dim overlay and a large soft shadow.
- Icons: 1.5px stroke outline icons (Lucide/Phosphor-like), 18-20px, in rounded tinted squares for stat cards (mobile: green play, amber pause, blue check, grey lines, each on a 10%-tint square).
- Illustration: product marketing uses gradient arcs and a gauge ("Optimizing deliverability" with Day 1 / Day 3 / Day 5 cards showing Good, 10%, 28%, 30 emails, 60 emails and green check chips for SPF, DKIM, DMARC, DNS Warm). Empty states use a small line icon in a tinted circle.

## 4. Components

Lists and tables
- Campaign list: table with header row (select-all checkbox, "Campaign name"), then rows. Each row: checkbox, a circular progress ring with a percentage ("0%", a check for complete) at about 64px, then name (semibold) with an external-link icon, an inline status pill ("Active" green dot, "Draft" grey dot, "Completed" violet dot), and below it "0 sequences . Created Sep 02, 12:56 PM". More columns sit to the right (cropped). Top of the page: title "Email Campaigns", subtitle "Manage and track all your outreach campaigns", then status tabs with counts: "Active (18)", "Paused (153)", "Stopped ...".
- Field-mapping table (upload step 3): columns "CSV Column", arrow, "Maps To SmartLead Field" (select), "Preview" (value chips). A green "Auto Mapped" pill sits beside matched column names, and the matched select shows a clear (x) icon.
- Email Accounts: bulk-select with a "Bulk Update" button at top right (text only). Filters by status (Pre-warmed, Disconnected, Nearing limit). The mobile list shows connection status, warm-up status and sent-today / daily limit.
- Bulk actions: checkbox select then a top-right action button opens a configuration modal.
- Views: saved filtered views in the inbox sidebar (Custom, Team member, Unassigned Leads, Information Request, plus user-named) with search and plus icons on the VIEWS group header.

Cards
- Mobile Home: 2x2 grid of stat cards (icon tile, label, big number 36px bold): Active 37, Paused 155, Completed 506, Draft 483. Campaign list cards below: name, status pill top right, date and ID with tiny icons.
- Kanban cards: email (semibold), company with campaign chip (small grey), crown icon plus lead name, a violet "$" square with amount, a dot, and a date.
- Template cards (AI Agents): dotted-grid header with two logos and an arrow, title, 2-line description, "895 users . 5 minutes" meta, eye icon button plus "Use template" outline button.

Forms and inputs
- Checkbox rows with a bold label and a grey one-line explanation under it, separated by hairlines (warm-up settings): "Enable Auto-adjust warmup/sending ratio", "Warmup the Custom Domain Tracking Link", "Send warmup emails only on weekdays" (checked, violet).
- Warm-up identifier tag: two text inputs joined by "-" with the live result "= class-think" and an info icon.
- Toggles in 2-column grid cells (upload settings): each cell has label, info icon, switch at right: Global Block List, Unsubscribe List, Community Bounce List (on), Existing Campaign Leads, plus a "HubSpot Integration" group.
- Inputs are white, 1px grey border, 8px radius, about 44px high.

Buttons
- Primary: solid violet, white text, 6-8px radius ("Update", "Continue", "Import Leads", "+ Add Column", "+ Add Leads"). Secondary: white with grey border ("Back" with arrow, "Preview Data", "Replace File"). Ghost text links in violet ("View All", "Watch Tutorial"). Top bar "+ Ask AI" white on navy. Disabled: pale grey.

Tabs
- Account modal tabs: Overview, General, Warm Up, Management, Campaigns; active is violet text with 2px underline. Campaign tabs: Leads, Sequence, Email Accounts, SubSequences, Settings. Inbox top tabs on mobile: icon + label (Inbox, Unread, AI Drafts, Sent, Important, then scroll: Archived, Reminders, Snoozed, Scheduled).
- Time presets on mobile analytics: segmented chips 7D, 14D, 30D (selected, solid violet), 90D.

Modals and panels
- Centered modal about 800-1000px wide, 16px radius, title at left, close X top right, optional 3-step stepper at top (circles joined by lines, completed steps show a check in a tinted circle), scrollable body, sticky footer with Back at left and primary at right. Account detail is a large modal with the person's name as a 28px title and tabs under it, "Update" fixed bottom right.
- Dropdown action menu on a message: kebab opens Expand, Reply, Forward, Set Reminder with icons.
- Snooze opens a small modal with preset times and custom date and time, "Snooze Lead" button bottom right.
- Right-edge vertical "What's new" tab (violet) and a round chat bubble bottom right.

Badges and pills
- Square-ish 6px pills, 12px text, tinted background: BLOCKED (grey, uppercase), COMPLETED (grey), Interested (green), Information Request (amber), Auto Mapped (green), "New" (green), "Beta" (violet), "Draft" with a dot. Campaign name chip on a lead row has a megaphone icon and grey outline.

Toasts: not observed. Banners: kanban info banner, full width, pale lavender: "Note: Leads will automatically move between columns based on their associated category..." with a dismiss X. A green success banner in the mapping modal: "Smart Mapping Applied: CSV upload complete. We matched leads by email, skipped duplicates, ..."

Empty states: leads tab shows a dashed-border large panel with a people icon in a tinted circle, "No leads added yet", one grey line, and a violet "+ Add Leads" button. Kanban columns show a small spinner with "Please wait while we load your data."

Charts: not observed in the web app. Mobile analytics uses stat cards (see Key screens). Marketing shows a semicircular gauge.

Editors: email editor with "Write with AI", "AI Spintax", Email Templates, variables, preview, A/B variants and a code editor (text only; not seen visually).

## 5. Key screens

Master inbox (3-pane, `master-inbox-sidebar.png`, older generation)
- Layout: icon rail (64px) | mailbox sidebar (about 190px) | thread list (about 340px) | thread detail (rest). Top bar navy.
- Mailbox sidebar: group "FOR ME" with Inbox, Assigned me, Sent, Important (star), Snoozed (clock), Reminders, Scheduled, Archived; then "VIEWS" with search and plus: Custom, Team member, Unassigned Le..., Information Re..., user views. Selected item has a grey fill; a violet left bar marks the selected thread.
- List column: search box "Search lead", title "Inbox(20)" with refresh and filter icons (filter shows a count badge). Each item: name (semibold) and date right, email, grey "Got reply from the lead" or "Sequence 2 sent & reply pending from the lead", then a campaign chip.
- Thread header toolbar: Deal, Task, Notes, Push Lead To, More (kebab); right side: snooze clock, archive tray (tooltip "Archive Lead (A+L)"), "Assign to" select. Below: campaign name, "All Activities" filter, lead name with star, info, copy, a green "Completed" status chip, and a "Mark lead as" select at right (category).
- Thread body is an activity timeline with a left vertical line and round tinted icons: "Lead opened the Testing (Email Sequence: 1) on ...", "Replied to ...", then a message card (subject "Re: hi", avatar, from/to, reply/forward/kebab, body, expand chevron), then "Event Status: 6 times Email Opened". "Ignore Reply" link at the right of the reply line.
- Primary action: Reply (arrow on the message). Hierarchy: lead name > status chip > timeline.
- Keyboard shortcuts (documented): O+L mark OOO, P+L pause, B+L block, R+L replace lead, K+L assign category, D+L add/update deal, C+L push to campaign, U+L unread, A+N new note, A+T new task, A+L archive. A shortcut that changes counted data pops a confirm: "Do you want to ignore this reply? If yes, it won't be counted as part of your reply rate metrics."
- More menu: Replace Lead, Push to Subsequence, Resume Lead, Mark as block, Mark as unread, Keyboard Shortcuts.

Campaigns list (`campaign-create.png`): described under Tables above. Primary action "+ Create Campaign" (name then Continue; creates a Draft).

Campaign builder (documented flow): tabs Leads, Sequence, Email Accounts, SubSequences, Settings.
- Leads: empty-state button, then a 3-step modal: pick source (Upload CSV, Import from CRM, Saved Lists, SmartProspect), Upload Settings, Map Your Fields.
- Sequence (text only): "+ Create First Step" with step types Email, Manual Task, Call; A/B variants; wait times between steps; AI writing, spintax, templates.
- Email Accounts: pick warmed accounts, see daily limits, warm-up status, current campaigns; filter by Pre-warmed, Disconnected, Nearing limit.
- Settings: timezone, start date, active days, sending window, send interval, new leads per day; stop-on (Replies recommended, Clicks, Opens); variant distribution (Pattern-based recommended, Randomized; locked once live). Smartlead adds timing jitter.
- Header: back arrow, name, "Draft" badge, "Review and Launch" and "Next: ..." at top right so the wizard order is always visible.

Mailbox warm-up settings (`warmup-settings.png`): modal titled with the account name, tabs Overview / General / Warm Up / Management / Campaigns. Warm Up tab: section heading + helper line, identifier tag inputs, then three checkbox-with-description rows, "Update" at bottom right. Documented bulk settings: total daily emails (start 25-50 for new accounts), daily ramp-up (example +5 per day from 15), custom tags, reply rate (keep 20-30%), auto-adjust ratio.
- Related: the Email Accounts tab has "Bulk Update" top right; status tags Pre-warmed etc.

Pipeline / CRM kanban (`smart-funnel.png`, bottom): header "CRM" with collapse, sub-nav Smart Funnel, All Leads, Calls, and a CUSTOM CRM saved boards list. Main area title "Smart Funnel", right side "Watch Tutorial", "Share Feedback", search "Search email", filter icon, column-view icon, violet "+ Add Column". Column headers are chevron-shaped (arrow-ended) tabs: colored title, info icon, kebab, "60 Leads . $0" under a 2px colored bar. System columns New Lead, Email Sent, Reply Received; custom ones like Cold Lead, Meeting Booked. Cards about 300px wide, 140px tall (est.), stacked with 10px gaps; columns about 340px wide. Moving a card changes the lead's inbox category and vice versa (columns are tied to categories).

AI agents home (`smart-funnel.png`, top): sub-sidebar (Home, My Agents, Templates, AI Connections), centered 40px headline "What do you want to get done, today?" with "get done, today?" in violet gradient, a large prompt textarea with a send arrow, "or Pick a Template and Build, View All", template cards. Closest analogue to automations.

Analytics (mobile only seen): see mobile section.

## 6. Interaction patterns

- Onboarding and setup: the Campaign wizard doubles as a checklist (tab order is the order of work, next-step button in the header). Smart defaults and recommended tags: "(recommended)" on Replies and Pattern-based. Auto-mapped CSV columns with a green summary banner explaining what happened (matched by email, skipped duplicates).
- Inline status: draft/active/completed pills and progress rings in rows; kanban banner explains the automatic movement rule once and is dismissible; "Auto Mapped" pills.
- Keyboard: two-key chords ending in L for lead actions (see above), A+L archive. Shortcut listed in tooltips ("Archive Lead (A+L)").
- Hover: tooltips with title + description on sidebar items; icon buttons get dark tooltips with shortcuts.
- Progressive disclosure: advanced items behind "More" menu and message kebab; account detail split by tabs; checkbox rows with explanatory sub-line; locked settings labelled "cannot be changed once live".
- Confirmation on metric-affecting actions (ignore reply).
- Real-time: "Inbox" refresh icon, activity timeline events ("Email Opened 6 times"), kanban sync with inbox categories; snooze auto-return (documented 5-10 minute lag).
- Saved views as the filter model (inbox views, CRM boards).

## 7. Responsive / mobile behavior

Seen via the mobile app screenshots (738x1600 phone, `mobile-app-4up.png`), not the responsive web:
- Bottom tab bar with 5 items (Home, Inbox, Analytics, Assistant, More); large title row at top (Home shows logo; others show title), search and filter icons at right on Inbox.
- Home: greeting "Good morning" (28px semibold) and subtitle "Here's your outreach overview"; 2x2 stat cards; "Recent Campaigns" with violet "View All"; list cards with status pill. Cards have 16px radius, white on #F7F7FB.
- Inbox: horizontally scrollable icon-labelled tabs; rows with name + timestamp right, campaign name, email + status tag. Thread view has Reply / Forward and "View full message". Row separators are inset hairlines.
- Analytics: date-range field with calendar icon, preset chips 7D 14D 30D 90D, "Overview" with horizontally scrolling stat cards (Emails Sent 1.3K with "1.2K leads", Opens 409 / 32.23%, Replies 4 / 1.00% reply rate, Positive 1 / 25.00%, Bounces, Leads), then a per-campaign list.
- Assistant: chat with suggestion chips ("How are my campaigns performing?", "Show me top replied campaigns", "Which leads should I follow up with?", "Summarize my inbox activity") and an "Ask anything about your campaigns..." box.
- More: Campaigns (filtered Active/Paused/Completed/Draft), Email Accounts, Settings (theme Light/Dark/System, notifications). Campaign creation is web-only; the + button shows a redirect prompt.
- Web responsive collapse (sidebar to icons) is inferred from the screenshots; narrow-width web behavior not observed.

## 8. Ideas worth borrowing for rightnow-ai

- Grouped sidebar with small labelled sections (Engage / Inbox health / Pipeline / Performance) and a second narrow context column for sub-nav; tooltips with a one-line description on hover.
- Campaign detail as ordered tabs (Leads, Sequence, Email Accounts, Settings) with a persistent "Review and Launch" / "Next" button top right. Matches the rightnow campaign model directly.
- Campaign list rows: progress ring + name + status pill + "N sequences . Created ..." sub-line; status tabs with counts above (Active, Paused, Stopped).
- Three-pane inbox with a mailbox group (Inbox, Assigned me, Sent, Important, Snoozed, Reminders, Scheduled, Archived) and saved Views; a thread header with status chip and "Mark lead as" category select; activity timeline in the thread (opened, replied, event status) instead of a plain message list.
- Two-key keyboard chords for lead actions, shown in tooltips and in a "Keyboard Shortcuts" entry of the More menu; confirm only when the action changes reported metrics.
- Warm-up settings as checkbox rows with one-line explanations, live preview of the identifier tag, and hints with numbers (start 25-50/day, reply rate 20-30%). This fits the honesty rules, since it avoids pushing users to extremes.
- Upload wizard: 3-step stepper, upload settings as toggle grid (blocklist, unsubscribe list, existing campaign leads), field mapping table with "Auto Mapped" pills and a green summary banner. Also reinforces the "unsubscribe always honored" principle by making it a visible toggle.
- Kanban with chevron-shaped colored column headers, count and value under each, a dismissible banner explaining column rules, and columns tied to lead categories (move card updates category).
- Mobile app pattern: bottom tabs (Home, Inbox, Analytics, More), 2x2 status count cards, preset-range chips, status tag on each inbox row.
- Status pills as tinted-background text with a color-coded set (green/amber/grey), uppercase for terminal states.
- Dashed empty state with one button and a single line of guidance.

## 9. Why it works

Smartlead's UI works because it keeps one clear, repeating structure: a dark navy bar anchors the product, a calm light sidebar names the jobs to be done in plain verbs and groups (Engage, Inbox health, Pipeline, Performance), and every major object (campaign, mailbox, lead) opens into a tabbed page whose tab order is the order of work. A single violet accent is used only for the next action, the active tab and the selected item, so the eye always lands on what to do; status uses a small fixed set of tinted pills (green, amber, grey) that read in half a second. Rows put the human-readable name first and the technical detail (sequence count, date, ID) in smaller grey text underneath, and the inbox thread shows the lead's whole history as a timeline, which explains why a reply exists without a separate report. Settings are written as full-sentence checkbox rows with a one-line reason and numeric guidance, hover tooltips explain every nav label, and wizards add recommended defaults and a summary banner after an upload, so a newcomer can follow what the software is for (send sequences from many mailboxes, keep them healthy, answer replies, move deals) without a manual. The same mental model carries to a phone: five bottom tabs, big stat cards and status tags per row.
