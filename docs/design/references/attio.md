# Attio (CRM) - UI design reference

Scope note: Attio's real app requires login, so everything in-app below comes from saasui.design's 25 real screenshots (a small
test workspace "SaasUI", mostly empty states) plus Attio's help center and attio.com. Pixel values are estimated from 1500px-wide
screenshots (scaled from ~1974px originals) unless marked "measured" (live CSS from attio.com, the marketing site, not the app).
Screens NOT seen (Email/inbox, Sequences builder, Workflows canvas, Reports dashboard, mailbox settings detail) are described only
from help-doc text and flagged as such.

## 1. Sources

Viewed:
- https://www.saasui.design/application/attio (gallery of 25 screenshots; all downloaded, 14 studied at full size)
- https://attio.com (product page; live CSS measured; screenshot `home.png`)
- Help docs (text only, via fetch): kanban views, build-a-sales-reporting-dashboard, create-a-workflow, navigating-your-workspace
- Not viewed: no live app (login wall), no mobile app, no Sequences/Email/Workflows-canvas screenshots.

Screenshot files (in `...\scratchpad\screenshots\attio\`):
- `home.png` attio.com hero
- `s02.png` onboarding step 1/5 "Let's get to know you"
- `s05.png` onboarding step 4/5 "Help us customize your workspace"
- `s08.png` kanban list view "Content Co-creation" (Content Pipeline), empty
- `s09.png` Settings > Workspace > General
- `s10.png` Settings > Account > Profile
- `s12.png` Kanban "View settings" popover
- `s13.png` Activity (notifications) popover
- `s14.png` Tasks page + Create task modal with date dropdown
- `s16.png` Notes: template editor modal
- `s17.png` Companies table, empty state
- `s21.png` Company record page > Files tab
- `s22.png` Company record > Tasks tab, create task with linked record
- `s23.png` List settings > Attributes tab
- `s24.png` Kanban with Aggregations popover + "Task created" toast
- Other gallery shots (s01, s03, s04, s06, s07, s11, s15, s18-s20, s25) were downloaded but not studied.

## 2. Information architecture & navigation

App shell: two columns, no full-width top bar.
- Left sidebar ~190px wide (283/1500 of the screenshot, ~19%) in light gray (#F7F7F7 est.) with a 1px right border.
- Main pane: white. 52px header row (title or breadcrumb left; avatar, "+" and kebab "⋮" right), 1px divider, a toolbar row (view switcher, Filter, Sort, View settings, Import/Export), then content.

Sidebar, top to bottom (as seen in the app):
1. Workspace switcher: pink rounded-square logo tile "S" + "SaasUI" + chevron; collapse-sidebar icon at the right edge. Menu (per docs): switch workspace, Account settings, Workspace settings (admins).
2. Search box (full width, bordered, radius ~8px) showing "Search" and a ⌘ K keycap hint. `/` also opens search.
3. Primary items (icon + label, ~33px row pitch): Activity, Tasks, Notes, Email. Docs (newer build) list more: Home, Reports, Calls, Sequences, Workflows, Favorites, Chats.
4. Collapsible group "Records" (small gray label with triangle): Companies, People.
5. Collapsible group "Lists" with "+" on the right; each list has an emoji/icon + name ("Content Co-creation"). Docs: gear sets sort (Most relevant / Recently added / Alphabetical / Custom); 6 lists shown by default; "Show all lists".
6. Pinned to bottom: "Upgrade Attio" (sparkle icon), "Invite teammates", "Help and first steps" with a "1/6" progress chip (blue sparkle + count; shows 2/6 after steps complete).
Active item: light-gray (#EBEBEB est.) full-width row fill, radius ~6px, no accent color. Unread badge: red count pill ("1") right-aligned on Tasks.

Settings is a mode swap, not a new page: the sidebar is replaced by a "‹ Settings" sidebar with groups "Account" (Profile, Email and calendar accounts, Storage accounts, Notifications), "Workspace" (General, Members, Plans, Developers, Security, Support requests, Email and calendar), then "Records" and "Lists" (per-object and per-list settings). The content column is centered, ~800px wide (495-1290 of 1500), with breadcrumb ("Workspace Settings / General"), H1, one-line description, and hairline-separated sections.

Breadcrumbs: only on record pages and settings ("Company / saasui" with building icon; "List Settings / Content Co-creation"). List/table pages use a plain title (with a small info icon on Companies).

Command palette: "quick actions" on cmd/ctrl+K (30+ actions, upcoming meetings, RSVP). Search on `/`.

Announcement banner: full-width blue bar above everything ("Collections are now lists. Read more or dismiss this message.").

## 3. Visual language

Color (app, estimated from screenshots):
- Page bg white; sidebar #F7F7F7; hover/active fill #EDEDED; hairline borders #E4E4E7.
- Text primary near-black (#1A1C20 est.; site measured lab(10.7,-0.1,-1.5) ~ #1b1d21); secondary gray #6B7280 (site small text measured lab(50.4,-1.3,-9.6)); placeholder ~#9CA3AF.
- Primary action blue ~#0F5BE0 (est.) solid with white label; lighter variant (#5B8DEF est.) for hover/disabled. Links and active tab text/underline use the same blue. Selected chip: pale blue fill (#DCE7FB est.) + blue ring.
- Marketing site primary button is near-black (measured bg lab(12.7,...) ~ #1E2024), off-white text, radius 10px, 36px high, 14px/500; secondary white with 1px border. So: dark buttons on marketing, blue buttons in-app.
- Semantic: green check circle (toast), red count badge (#E5484D est.), stage dots in saturated colors (dark gray, orange, green, yellow, blue) as the only color in kanban headers. Lavender (#DDD6F8 est.) banner for "You are editing a template." Purple sparkle glyph marks computed/AI attributes ("Connection Strength", "Last email interaction").
- Light mode only seen; dark mode not observed.

Typography: Inter throughout. Measured on attio.com: body `inter` 16px/22px weight 500, letter-spacing -0.16px; display headings `interDisplay` h1 64px/600/-1.28px, h2 40px/500/-0.4px; small text 12px/18px/500. In-app (est.): sidebar items ~15px/500; page titles ~19px/600; table headers ~14px/500 gray; sidebar group labels ~13px gray; helper text 12-13px gray; Notes title ~36px/700. Medium weight is the default body weight (a crisp, slightly heavy feel), with slightly negative tracking.

Spacing/density: comfortable-medium. Sidebar row ~33px; toolbar buttons ~34px; table header ~40px; inputs ~36px; modal padding 16-24px; ~35px between settings fields.

Radii: buttons/inputs ~8px (est.; site buttons measured 10px); popovers/menus ~8-10px; modals ~10px; chips fully rounded; workspace logo ~8px; onboarding card ~28px.

Borders vs shadows: flat. 1px light-gray hairlines separate regions; floating layers (dropdowns, popovers, toasts, modals) get a soft large-blur shadow (about 0 8px 24px rgba(0,0,0,.12), est.) with no heavy border. Toolbar buttons are white with 1px border and a faint 1px lift shadow.

Iconography: 16px outline line icons, ~1.5px stroke, monochrome, one consistent set (lightning=Activity, circle-check=Tasks, doc=Notes, envelope=Email, building=Companies, people=People). Property types have small glyphs (Select = filled circle with chevron, Multi-select, Pipeline = bars, Text, Date, Rating = star). Lists get emoji icons. Brand: custom "a" logomark + lowercase wordmark.

Illustration: none in empty states (just a circled line icon). Onboarding uses abstract gray skeleton screenshots of the app on a gray panel to preview what is being built.

## 4. Components

Tables / lists (Companies empty state s17; Attributes s23):
- Header row ~40px; gray 14px labels each preceded by a property-type icon; "+" at the right end adds a column; first column has a select-all checkbox; drag handles (⠿) for reordering.
- Computed columns carry a purple sparkle glyph after the label.
- Calculation row under the header (Companies: "0 count", "+ Add calculation" per column) or pinned to the bottom (kanban). "Aggregations" menu: Count empty, Count filled, Percent empty, Percent filled, Sum, Average, Max, Min, each with a number and a ">" submenu arrow.
- Pills: gray rounded chip with leading dot for status ("No communication found"), pale-blue chip for URL ("saasui.design"), gray rounded count badges beside tab labels.
- Toolbar above table: view switcher (icon + view name + chevron, e.g. "Recently Contacte..." truncated, "Content Pipeline"), "Filter", "Sort" with a blue count badge, "View settings" (gear), "Import / Export" (download icon + chevron) or "Export". Filter: "+ Add condition", operators is / is not / contains, filter groups. Sort: attribute + Ascending/Descending, "+ Add sort".
- Row height not visible in the empty screens (Attributes list rows ~46px pitch).
- Bulk actions: checkbox per row/card; per docs shift-select then drag to bulk-move in kanban. No bulk bar seen.
- Attributes list (s23): columns Name / Type / Description, drag handle left, kebab "⋮" right, type shown as icon + label; dragged row is lifted with a shadow. Header actions: Search input, Filter, blue "+ Create attribute"; tabs "General" and "Attributes 9".

Kanban (s08/s12/s24): column header = colored dot + stage name + "+" + drag handle. Ghost "+ Add to list" at the top of each column. Footer "+ Add calculation" per column. Click a stage name (docs): Hide stage, Collapse stage, Track time in stage (red counter when over target), Confetti. Card hover (docs): "Edit entry", "Open preview"; bottom of card: Create note, Create task, Add comment.

View settings popover (s12, ~365px wide): "Grouped by Stage >", "Visible columns 10 >", "Show attribute labels" toggle, section "Visible attributes" with drag-reorderable rows each with an "x", then "+ Add card row >".

Forms/inputs: label above (13px), input ~36px high, 1px border, radius ~8px; focus = 2px blue ring ("First name"); read-only = gray fill (email). Toggle switch for booleans. Select = input with chevron. Helper text 12px gray ("We support PNGs, JPEGs and GIFs under 10MB"). Info banner = gray block ("Changes to your profile will apply to all of your workspaces.").

Buttons: primary blue solid, often with icon ("+ Add task", "+ Create attribute", "Upload logo"); secondary white with border and icon ("Import / Export", "Start new export", "Connect Google Account" with Google logo); tertiary gray fill ("Remove", "Add to list"); text/underlined link ("Change your email address"). ~34-36px high, radius ~8px, 14-15px/500. Disabled/hover blue is lighter.

Tabs: icon + label + gray count badge; active = blue text + 2px blue underline (record page: Activity, Emails 0, Files, Notes 1, Team 1, Tasks 1). Activity popover uses text-only tabs "Notifications (0)" / "Requests (0)".

Modals: centered, ~835px wide for Create task: 14px title top-left, "x" top-right, 18px text input, bottom chip row (date chip, "Add Record", "Assigned to you") with right-aligned "Create more" toggle and blue "Save". Date dropdown: text input at top ("February 7th, 2023"), then Today (blue, weekday on right) / Tomorrow / Next week / Custom... / No date. Notes template editor: large modal over a 55% gray overlay, centered title in a blue-ring input, lavender banner row "View all templates | You are editing a template. | Learn more".

Popovers: Activity (s13) ~395px wide beside the sidebar: H2 "Activity", tabs, centered empty message, "Notifications Settings" text link.

Record side panel: ~65/35 split; right = "Record details" (collapsible; icon + value; unset values greyed "Set City", "Set State"; "Show more") and "Lists" (collapsible; empty message + "+ Add to list").

Toasts: bottom-right white card, green check circle, "Task created", "x"; ~315px wide, shadowed.

Empty states: centered stack - circled line icon (~44px), bold title ("Add your first company"), one-line gray hint ("Connect your mailbox or manually add your first company to get started."), real next-step buttons ("Connect Google Account" / "Connect Microsoft Account" side by side in a faint gray tray), then primary "+ Add Company". Notifications empty: bold "You don't have any notifications" + explanation + settings link.

Editors: Notes use a block editor with big title (~36px/700) in a modal, kebab "⋮" bottom-right; templates are editable. Inline rename: a folder name field gets a blue ring while typing (s21).

Charts: none in the screenshots. Per docs, reports: Insight, Funnel, Time in stage, Stage changed; visualizations Funnel, Funnel Metric, Bar; options "Grouped by", "Group by", "Segmented by", "Included stages", "Created at" after/before, targets.

## 5. Key screens

Onboarding (s02, s05): 5-step wizard in one rounded card (~1180px wide at 1500, radius ~28px), split ~50/50. Left = form: "1/5" counter, bold H1, fields, full-width blue "Continue". Right = gray panel with a skeleton preview of the app that changes per step (step 4 enlarges the sidebar "Lists" item showing "Content Co-creation"). Step 1 "Let's get to know you": profile picture + Replace image/Remove, First/Last name, read-only Email, "Subscribe to product update emails" toggle. Step 4 "Help us customize your workspace": use-case chips (Sales, Recruiting, Marketing, Investing, Customer success, Human resources, Fundraising, Content creation, PR, Other), then "What are you working on at the moment?" chips (Hiring freelancers, Managing a content pipeline, Other). Hierarchy: small gray step counter, H1, copy, chips, bottom CTA.

Pipeline / kanban list (s08, s24) - maps to the rightnow CRM pipeline: header = emoji + list name + gray "People" object chip; toolbar as above; stage columns with colored dots; calculations at the bottom. Primary action: add records to the list.

Companies table (s17, empty) - maps to leads: toolbar + sparkle computed columns (Connection Strength, Last email interaction > When, Last calendar interaction > When) + empty state that offers mailbox connection (closest tie to mailbox setup).

Record page (s21, s22) - maps to a lead detail: breadcrumb, logo + name + status pill "No communication found", top-right "Add to List" and "Compose Email", tabs with counts, left content, right "Record details" panel. Files tab: "Browse ..." and "Create folder" buttons, file rows with red PDF icon and "Syncing" spinner or date.

Tasks (s14): H1 "Tasks"; top-right "My tasks" dropdown + blue "+ Add task"; body group "Today  February 07 • 0 open tasks" with "+" at right; Create task modal.

Activity popover (s13): notifications/requests inbox anchored to the sidebar, not a page.

Notes (s16): page with "Manage templates" and blue "Create note"; template editor modal.

Settings (s09, s10, s23): narrow centered forms. General: workspace name input, logo tile + "Upload logo", "Export Workspace data" row with "Start new export" and a TYPE/DATE table ("You have not created any exports."). Profile: info banner, avatar, two-up names, read-only primary email + "Change your email address", "Preferred Timezone" select (UTC). List Settings > Attributes: custom-field schema editor (Content Piece, Topics, Type, Stage, Post-production phase, Priority, Link to published content, Published date, Rating).

Not seen, docs only: Email (compose key `c`), Sequences, Workflows canvas (trigger + blocks, "Publish workflow", "Publish changes", "Discard changes", "Enable workflow" toggle, keys `V`/`H`/`B`, "Ask Attio" prompt "Describe your workflow..."), Reports dashboard.

## 6. Interaction patterns

- Onboarding wizard asks use case and tailors a first list/pipeline; the preview panel visualizes it. Post-signup checklist is a quiet "Help and first steps 1/6" row at the sidebar bottom (counter increments as steps finish), not a blocking modal.
- Empty states offer the real action (connect Google/Microsoft, add company).
- Inline editing: record-detail values are click-to-edit with "Set X" placeholders; folder rename inline; "Edit entry" on cards (docs).
- Create flows are short modals with a "Create more" toggle, natural-language date chips (Today/Tomorrow/Next week/Custom/No date), and @mention linking a record ("@saasui" becomes "1 linked record").
- Keyboard (docs): cmd/ctrl+K quick actions, `/` search, `n` new note, `t` new task, `c` compose email, `?` shortcut list; kanban shift-click + drag; workflow canvas `V`/`H`/`B`.
- Hover reveals: card "Edit entry"/"Open preview", checkboxes, drag handles on columns/attributes, sidebar row gray fill.
- Progressive disclosure: "Show more" in record details, submenus (">" on Visible columns, Add card row, Aggregations), collapsible Records/Lists groups, popovers over modals.
- Real-time feedback: "Syncing" spinner on files, green "Task created" toast, red unread badge, "No communication found" status pill, time-in-stage counter turns red past target (docs).

## 7. Responsive / mobile behavior

Not observed. All screenshots are desktop (~1974x1080 originals); no mobile layout captured. The sidebar has an explicit collapse button, implying narrow-width handling, but this was not seen.

## 8. Ideas worth borrowing for rightnow-ai

- Sidebar: workspace switcher, search with ⌘K hint, a few core items (Inbox, Campaigns, Leads, Pipeline, Mailboxes, Analytics, Automations), a collapsible "Lists" group with "+" for lead lists/segments, bottom pinned "Invite" and "Setup n/6" chip.
- "Setup n/6" chip (connect mailbox, verify DNS, start warm-up, import leads, create sequence, send test): non-blocking progress.
- Settings as a mode swap: sidebar becomes "‹ Settings" with Account / Workspace groups; content ~800px wide with breadcrumb, H1, one-line description, hairline-separated sections.
- One toolbar for every table: saved-view switcher + Filter + Sort (blue count badge) + View settings + Import/Export. Use on leads, campaigns, mailboxes.
- View settings popover: "Visible columns n", drag-reorderable visible attributes with "x", "Show attribute labels" toggle.
- Footer calculations row ("+ Add calculation": Count, Percent filled, Sum, Average, Min, Max), e.g. count of verified emails.
- Kanban pipeline: colored-dot stage headers, "+" per column, per-stage aggregates, stage actions (hide/collapse/time-in-stage with red overdue), shift-select + drag for bulk moves.
- Empty states with real CTAs (Mailboxes: "Connect Google / Microsoft / IMAP"; Leads: "Import CSV" / "Add lead").
- Create modals with "Create more" toggle and a chip row for date/assignee/linked record.
- Lead record page: breadcrumb, status pill, count-badged tabs (Activity, Emails, Notes, Tasks), right "Record details" panel with ghost "Set X" fields, "Add to List" and "Compose Email" buttons.
- Custom-field schema editor (Name / Type / Description, drag handle, kebab, type icons).
- Toasts bottom-right with green check; red count badges for unread; purple sparkle reserved for computed fields (warm-up score, deliverability).
- Onboarding split card with live skeleton preview and use-case chips.
- Keyboard: `/` search, `c` compose, `t` task, cmd+K actions, `?` shortcuts sheet.
- Automations (from docs): canvas with trigger + blocks, "Publish workflow" / "Publish changes" / "Discard changes", an "Enable workflow" toggle, AI prompt box to scaffold.

## 9. Why it works

Attio looks good because it is almost entirely neutral: white content, a faint gray sidebar, hairline borders, one blue accent and a single typeface (Inter at medium weight, slightly tightened), so the only saturated color on screen is data (stage dots, status pills) or the one primary action. The chrome is quiet and consistent (16px line icons, ~8px radii, soft shadows only on floating layers), so the content feels like the interface. It is clearly presented because every list page repeats the same skeleton (title, view switcher, Filter/Sort/View settings, table or board, footer calculations) and every record page repeats another (breadcrumb, count-badged tabs, details panel), so users learn it once and read every screen the same way; settings live in a narrow centered column that never competes with working views. Users grasp what the software is for within seconds because the sidebar is a literal map of the product (Activity, Tasks, Notes, Email, Records: Companies and People, Lists), empty states say what to do next and provide the real buttons (connect a mailbox, add a company), onboarding asks what you do and previews the workspace it builds, and a small "Help and first steps 1/6" counter keeps guiding without blocking the work.
