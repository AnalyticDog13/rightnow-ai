# folk (CRM) - UI reference spec

Reference material for the rightnow-ai redesign. Only what was actually seen is described. Values marked "(est.)" are measured by eye from screenshots (the in-app shots are 1920x1080 screen recordings framed with a ~38px browser-tab strip at the top and ~73px black bars at left/right, so px figures are roughly 1:1 with a 1920 wide viewport). Values without "(est.)" were read from the live folk.app marketing page.

## 1. Sources

Viewed:
- https://www.saasui.design/application/folk - gallery of 16 real in-app screens (login, 3x onboarding, empty state x3, settings, modal x3, table x2, profile, email). I opened the individual images from the Sanity CDN at full size.
- https://help.folk.app/en/articles/5779445-send-messages - text of the send-messages / mail-merge flow (fetched as text).
- https://www.folk.app/products/emailing - live marketing page (computed styles read; full-page screenshot viewed, containing a rendered mock of the composer, a LinkedIn import, enrichment, sequence diagram, pipeline + bar chart illustrations).

Not viewed (not attempted beyond the above): help articles on pipelines/groups/contact records, the folk.app home page, any live logged-in app (requires login). The login screen image (87830825...) was not opened individually.

Screenshots saved (scratchpad `...\scratchpad\screenshots\folk\`):
- table1.png (kanban "My Pipeline" with filter popover), table2.png (kanban with column-visibility menu), email.png (composer with `/` variable menu), profile.png (contact record), settings.png (Settings > Accounts), modal1.png (Add contact modal over table), modal2.png (Verify domain modal "Analyzing your domain..."), empty2.png (empty group table), empty3.png (kanban, one card), onboarding3.png ("Create live groups of contacts"), emailing-page.jpeg (marketing page).

Caveat: the in-app shots are from 2022 (Last sync "7 Nov 2022"), so the app chrome may differ from today's folk.

## 2. Information architecture & navigation

App shell: fixed left sidebar + one large content pane. No top bar at app level; each page has its own header inside the content pane.

Sidebar (about 290px wide (est.), x 73-363 in the frame, warm off-white, 1px right border):
1. Workspace switcher at top: small rounded-square blue avatar with letter "R" + workspace name "RM" + up/down chevron (opens workspace list).
2. Primary items (icon + label, ~40px row (est.)): **Search** (magnifier, with a right-aligned count in small bold, e.g. "1.1K", which is the live total of contacts/results; it ticks up during import), **Messages** (envelope; the mail-merge/campaign area with Draft / In review / Unread / Replied folders), **Settings** (gear).
3. Section header "PRIVATE" (small uppercase, letter-spaced, grey, with a collapse chevron on the left and a "+" on the right to create a group). Below it, **Groups** as the main navigation object: emoji + name + right-aligned count: "Alumni 1", "Clients 1", "Colleagues 0". Active row gets a rounded light-grey fill (~8px radius (est.)). A "SHARED" section exists too (visible in the marketing mock: Press release, Growth, Candidates).
4. Bottom of sidebar: a floating status card "Import in progress" with a spinner icon, text "New contacts from your source hello@... are being imported." and a bold uppercase counter "1,120 CONTACTS IMPORTED" that increases across shots (1,000 -> 1,120 -> 1,170 -> 1,680 -> 1,930). A circular "?" help button sits bottom-right of the viewport (and an Intercom-style dark rounded chat button in onboarding).

Group page header: emoji + group name as large title (about 28px, weight 500 (est.)), right side "Share" (lock icon) and a "..." overflow. Under it a **view bar**: view switcher pill ("My Pipeline (1 person)" or "All people (0 people)" with chevron, a small view-type icon), "Add view", "Share view"; right side: "Filter" (with a count badge when active, e.g. "Filter 1"), "Sorted by Last interaction", eye icon (show/hide fields), columns icon (pipeline), magnifier (in-view search), then "Message all" (outlined) and "Add contact" (outlined, rounded).

Settings uses a separate shell: sidebar swaps to a settings nav with "<- Back" at top; groups: user email heading (HELLO@...) > Personal details; workspace name heading (RM) > Workspace details, Members, Accounts, Senders, Integrations, Billing; "Logout" pinned at bottom. Content is a single centered column about 790px wide (est.) starting at x~717.

Contact record is a full-page route (not a drawer): "X" close at top-left, "View in [Alumni] +" breadcrumb-like chip (the group context), top-right link-copy button and "..." menu.

Search/command palette: "Search" is the first sidebar item with a live count, so search is global and a first-class nav item. No keyboard-palette screenshot seen. Breadcrumbs: only the "View in [group]" chip on records.

## 3. Visual language

- Palette (in-app, est.): warm off-white canvas (marketing page body is white; app content looks #FFFFFF to #FDFCFA, sidebar #F8F7F4-ish warm grey-cream), text near-black (marketing text color rgba(3,2,0,0.89), a warm black, not pure #000), secondary text mid grey (~#8A8A85 (est.)), hairline borders very light warm grey (~#E8E6E1 (est.)). Primary buttons are solid near-black (#111 (est.)) with white text. Accent colors are used only in small tag chips: pink/red "Doing" (pale red bg, dark red text), grey "Done", lilac/purple "Next", grey "No status". Links are blue (~#2563EB (est.)). Verified-checkmark badge is green. Workspace avatar is blue.
- Light only. No dark mode seen.
- Typography: in-app text is a clean neo-grotesque sans (looks like Inter/system-like (est.)); marketing page uses custom faces: headings "Uxumgrotesque" (h1 64px, h2 48px, weight 500), body "Foundersgrotesk" ~13px, buttons Inter 12px 500. In-app scale (est.): page title ~28px/500, modal title ~28px, empty-state heading ~28px, body/nav ~15-16px/400, section labels ~13px uppercase tracking +0.06em weight 600 (e.g. "BIRTHDAY", "GROUPS", "PRIVATE"), small meta ~12-13px.
- Density: airy. Sidebar rows ~40px, toolbar buttons ~36px tall (est.), table header row ~48px (est.), kanban card ~70px tall with 12px padding (est.). Generous whitespace; content padded ~75px from sidebar edge.
- Radii: buttons/inputs ~8px (est.), cards ~10-12px, modals ~14px, pill tags ~6px (not fully round), avatar circles full, marketing buttons 1000px (pills).
- Borders vs shadows: hairline 1px borders define buttons, cards, inputs; soft diffuse shadow only on floating layers (popover menus, modal, sidebar import card). No heavy shadows.
- Iconography: single-weight filled/solid glyph icons (envelope, gear, briefcase, cake, people, bolt, clock, pin, link) at ~16px, grey; emoji used as group icons. Field type icon precedes every field label and every column header.
- Illustration: onboarding uses large product-mock cards with real logos (Gmail, Notion, Airtable, Zapier, LinkedIn) and a bold orange (#F25C3B-ish (est.)) geometric accent shape behind the headline; the Verify-domain modal has a flat blue/orange/black geometric illustration; the empty profile uses a pale yellow lightning-bolt illustration. Playful but restrained.

## 4. Components

Tables / lists:
- Group table (empty state seen): header row with checkbox + "Person", then typed columns each with icon + label + dropdown chevron: Emails, Phone numbers, Job title, Birthday, Groups. Columns ~250px wide each (est.). A "+ Add person" inline row sits directly under the header (add-in-place). No row data was visible in any screenshot, so row height and cell styles are not observed beyond the header.
- Column visibility: eye icon opens a popover list of fields with icon, name and a toggle switch each (Emails, Phone numbers, Job title, Birthday, Groups, Your total interactions, Your last interaction, Addresses, Urls ...), scrollable.
- Sort: shown as text "Sorted by **Last interaction**" (bold key) in the view bar.
- Views: named saved views with a type icon ("All people", "My Pipeline"), "Add view", "Share view". Count in parentheses "(0 people)" inside the pill.
- Filter builder popover: row = trash icon, "Select an attribute" dropdown, "Select a condition" dropdown (options seen: Does not contain, Contains, Is empty, Is not empty, Is exactly, Is not exactly), then "Add a filter" text link and a dark "Apply" button. Active filter shown as a count badge on "Filter".
- Bulk actions: tick checkboxes then "Email" appears in a bottom toolbar (from help article); Shift+arrows multi-select. "Message all" top-right acts on the whole filtered group.
- Cards: kanban card = white, 1px border, ~10px radius, avatar circle with initial + name, hover shows a grab hand cursor. Settings uses bordered white cards with a grey inset sub-card (the "Share your interactions" toggle block).
- Forms/inputs: borderless "click to edit" fields with placeholder prompts ("Add birthday", "Add an address", "Add url", "Add a company", "Add note", "Add a job title"); label above, uppercase with icon. Composer fields: "From:" select ("Select a sender" with chevron), "Cc:" / "Bcc:" lines with placeholder email@company.com, subject as plain text line. Toggle switches are small grey pills.
- Buttons: primary = solid near-black, white 600 text, ~8px radius (Apply, Create (full width in modal), Verify domain); secondary = white with 1px grey border (Share, Message all, Add contact, Save and close, Back, Exit, Import file, Connect Google); disabled primary = mid-grey fill (the "Review" button while the draft is incomplete); ghost = text-only ("Add view", "Add a filter", "Cc", "Bcc"); icon buttons = square outlined 36px (link, envelope, bell, chat on record).
- Tabs: underline tabs on the contact record: "Interactions (0)", "Comments (0)", "Reminders (0)" with icon and count; active has a dark underline. Segmented control in the Add modal: Person | Company (selected = white raised pill on grey track).
- Modals: centered white card ~640px wide (est.), 14px radius, dim grey overlay (page behind greyed ~40%), header row inside the card, sticky footer with the primary full-width "Create" button. Multi-step modal has a dot stepper (4 dots) top-center, back arrow top-left, X top-right.
- Badges/status tags: kanban column labels are colored text-chips with a count ("Doing 0" pink, "Next 1" lilac, "No status 0" grey, "Done 0" grey) and a "..." menu per column. Green check badge on account avatar = synced.
- Toasts: not observed. Progress feedback is instead persistent (sidebar import card, "Saving changes..." text in composer header).
- Empty states: centered column, large heading "There's no one here - yet", one grey line "Time to add some people. Here are the ways you can do so:", then three stacked action cards (icon + bold title + grey description + arrow on first): "Add people / Create a new person to add to this group", "Import people from a file / Import people from a CSV, XLS, or any other file (more info)", "Connect an integration / Import people from your favorite tools by connecting them to folk". First card pre-highlighted grey. Cards ~685px wide x ~85px tall (est.). Record empty state: lightning illustration + "No interactions" + "We are not aware of any interaction with this contact in the past year".
- Charts: none in the in-app shots. Marketing mock shows a simple 3-bar chart "New leads" and a stat strip in the composer mock: Sent 100%, Read 98%, Clicked 30%, Bounced 1% (four labeled percentages).
- Editors: composer is a minimal document editor: floating formatting toolbar anchored bottom-left of the body (B, I, U, bullet list, numbered list, quote), "/" opens an inline variable menu (Name, First name, Last name, Job title, Url, Company name, Company url) shown as a small popover list with the first item highlighted; a "Templates" strip at the bottom; markers like `(organization)` and `First name` render as colored inline chips in the marketing mock.

## 5. Key screens

**Group as kanban pipeline ("Alumni", view "My Pipeline")** (table1/table2/empty3): sidebar left; title row; view bar; four columns side by side, each ~370px wide (est.) with a header chip (status name + count) and "..." at right, separated by a thin line under headers. Columns: No status, Doing, Done, Next. Cards: avatar initial + name only (minimal; extra fields are opted in via the eye menu). Primary action: "Add contact" / "Message all". Hierarchy: title > view/filters > columns. The column headers are tinted so state is scannable without reading. Maps to rightnow-ai CRM pipeline.

**Group as table** (empty2): same header, view "All people (0 people)", typed columns, "+ Add person" inline row, empty state cards below. Maps to leads table.

**Contact record** (profile): full page, 2-pane. Left (about 420px (est.)): big avatar circle with "+" (upload) + first/last name as editable large text (~28px), three quick-action icon buttons (email, reminder bell, comment), then a vertical list of field blocks, each = icon + uppercase label + value/placeholder: Birthday, Groups (emoji chip "Alumni"), Your total interactions (0), Your last interaction ("No interactions"), Addresses, Urls, Gender; footer pinned "+ New field" (outlined) and "Visible fields" (eye toggle). A thin dark vertical scrollbar divides panes. Right pane: tabs Interactions / Comments / Reminders with timeline (empty state shown). Primary actions: email, set reminder, comment.

**Composer / mail-merge** (email): full-page (replaces content pane, sidebar stays). Header: "New message (1)" title (the (1) = recipient count) left; right "Saving changes..." autosave text, "Save and close" outlined, "Review" dark-grey button. Below: From select, Cc/Bcc reveal links on right, Cc and Bcc rows, subject, body with "/" variable menu, bottom floating format toolbar, Templates row. Flow from help article: choose sender -> write with variables -> **Review** (per-recipient preview, edit each, remove with bin icon, search) -> "Edit draft" or "Send". Drafts appear in Draft folder, in-review in "In review"; sent campaigns have Unread/Replied folders and analytics. Sender types: Custom Sender (own domain; required for sequences) or Gmail Sender. Limits per help article: 5,000 (custom) / 500 (Gmail) per campaign; first 100 sent at once, then batches of 100 spaced up to 30s. Tracking (opens/clicks) on by default, workspace-wide switch in Settings > Senders. Replies go to the external inbox and only sync back if the same sender is connected under Settings > Accounts. Marketing page shows a sequence builder diagram ("Wait 2 days" then "If reply" branch) and a stats strip Sent/Read/Clicked/Bounced.

**Settings > Accounts** (settings): title "Accounts" + 2-line explainer paragraph; bordered full-width card "Connect a Google account" with Google logo and "+" at right; below an account card: yellow initial avatar with green check badge, email, "Last sync: 7 Nov 2022 at 09:07 AM", "..." menu, explanatory paragraph about scopes imported, grey inset block with title "Share your interactions", description, and toggle (off). Footer legal links in blue. Maps to mailbox account settings (connected mailbox + last sync + privacy toggle).

**Settings > Senders > Verify domain** (modal2): page behind explains "Verify your domain X to send messages from this domain" with DNS records table (CNAME-style values like *.sendgrid.net), "Auto-configure" button, dark "Verify domain" button. Modal shown on Auto-configure: 4-dot stepper, illustration, "Analyzing your domain..." and a 3-item progress checklist with check circles: "Analyzing X...", "Detecting DNS Provider...", "Getting your setup ready.", footer "Powered by Entri". Maps to domain/DNS setup (SPF/DKIM) for mailboxes.

**Add contact modal** (modal1): over a table; "Add to [Clients v]" selector top; Person | Company segmented; avatar + inline "James" / "Last name" big inputs; stacked field sections each with icon+uppercase label (COMPANIES with "Add a company" row, NOTES with textarea + resize handle, JOB TITLE, EMAILS...) scrolling; sticky full-width black "Create".

**Onboarding** (onboarding3): full-screen cream page (no sidebar), folk logo + "Exit" top-left, huge centered headline "Create live groups of contacts", subhead "folk lets you create live groups of contacts in four different ways.", four equal cards in a row (each ~400px wide, mock illustration on top, bold title, grey description, logo row, full-width outlined action button): "Connect Google account / Connect Google", "Upload a CSV file / Import file", "Download folkX for Chrome / Download extension", "Connect with Zapier / Connect integration". Centered dark "Next" button and 3 pagination dots at the bottom. Other two onboarding frames and the login frame were not individually studied.

Not seen: unified inbox, analytics dashboard, automations (folk's "Messages" inbox is a folder list for campaigns, not a reply inbox).

## 6. Interaction patterns

- Onboarding: multi-step full-screen wizard (dots), each step offers 4 import routes; always an "Exit" escape. Import then runs in background with a persistent live counter card in the sidebar (progress without blocking).
- Inline editing: all record fields are click-to-edit with "Add ..." placeholders; no edit mode toggle; "New field" creates custom fields; "Visible fields" controls which show.
- Progressive disclosure: columns/fields hidden by default and opted in by toggle; Cc/Bcc hidden behind links; filter popover builds conditions one row at a time; composer variables only on "/".
- Keyboard: "/" for variables in composer; Shift+arrows multi-select rows (help article); Shift+Enter tighter line spacing. No other shortcuts observed.
- Hover: rows/buttons get a light grey fill (e.g. "Accounts" nav and "Add a company" row in the screenshots); draggable cards show a grab cursor.
- Status feedback: "Saving changes..." autosave text; Review step before send; sync timestamp with green check; checklist-style progress in modals; live counts in sidebar.
- Drag and drop: cards between kanban columns (grab cursor seen; the drop itself not captured).

## 7. Responsive / mobile

Not observed. The gallery shows only desktop frames, and I did not open a logged-in app. The marketing page was rendered at desktop width only. (No mobile app UI observed or claimed.)

## 8. Ideas worth borrowing for rightnow-ai

- Left sidebar structure: workspace switcher, then 3 utility items (Search with live count, Messages, Settings), then a user-defined collection list with emoji + right-aligned counts (map to campaigns / lead lists). Counts in nav build trust cheaply.
- A persistent bottom-of-sidebar activity card for long jobs (CSV import, mailbox sync, warm-up ramp) with a big live number, rather than a toast.
- Empty states as three stacked action cards (icon + title + one-line description) instead of a lone button: for leads: "Add leads / Import CSV / Connect integration"; for mailboxes: "Connect Google / Connect Microsoft / Connect IMAP-SMTP".
- View bar pattern: named view pill with count, "Add view", "Share view", Filter (with active-count badge), "Sorted by **X**" text, eye menu for column toggles. Use for leads table, campaigns list and inbox.
- Filter builder as one small popover: attribute dropdown + condition dropdown + trash + "Add a filter" + dark "Apply".
- Typed column headers with icon + chevron menu; "+ Add row" inline directly under the header.
- Full-page contact/lead record: left = typed fields as icon + uppercase micro-label + click-to-edit value, pinned "New field / Visible fields"; right = tabs with counts (Interactions / Comments / Reminders). Replace with Emails sent / Replies / Notes / Tasks.
- Composer: "/" variable popover (First name, Company...), floating format toolbar, "Saving changes..." autosave, a dedicated per-recipient "Review" step before "Send", disabled-grey "Review" until valid. Use for sequence step editor with preview-as-lead.
- Sender/mailbox settings: bordered "Connect a Google account +" row above account cards showing "Last sync" and a green verified check; inline grey info block with a toggle for privacy options.
- Domain verification as an animated checklist modal with auto-configure, plus manual DNS values table and a dark "Verify domain" button; surface SPF/DKIM/DMARC state this way.
- Status chips for pipeline columns: tinted pale background + dark text + count, with "..." per column.
- Palette discipline: warm off-white, near-black primary buttons, hairline borders, color reserved for small status chips. Low visual noise suits a data-dense tool.
- Mail-merge stats strip (Sent / Read / Clicked / Bounced as four big percentages) as the campaign summary header.
- Safe sending limits stated in-product (per-campaign caps, batches of 100) and a "same sender must be synced for replies" explanation: honest constraints surfaced next to the controls.

## 9. Why it works

folk looks good because it removes almost everything that is not data or a next step: a warm off-white canvas, near-black text and buttons, hairline borders and soft shadows only on floating layers, and color spent only on tiny status chips and a few playful onboarding illustrations. Every object is shown the same way (icon + label + count in the sidebar, icon + label + chevron in column headers, icon + uppercase micro-label on record fields), so once you learn one list you can read all of them. It is clearly presented because each screen has exactly one title, one view/filter bar and one content area, with the primary action ("Add contact", "Create", "Review", "Verify domain") the only dark filled element on the screen, and because empty states and onboarding hand you a short list of concrete ways to proceed rather than a blank grid. Users can follow what the software is for because the nouns are plain (groups, people, messages, pipeline), the first-run flow is literally "bring your contacts in four ways", long operations report visible progress (live import counter, "Saving changes...", analyzing-domain checklist), and the email flow is a linear, forgiving path (choose sender, write with "/" variables, review each recipient, send) that mirrors how a person thinks about reaching out.
