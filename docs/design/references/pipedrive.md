# Pipedrive UI reference

Scope note: the live app requires login and was not accessed. Everything below comes from Pipedrive's own help-center screenshots (cropped, 900px wide, so values marked "(est.)" are estimates from images) and the public marketing site (real HTML, so measured values there are exact but describe the marketing site, not the app). Items I did not see are marked "not observed".

## 1. Sources

Pages viewed:
- https://support.pipedrive.com/en/article/pipeline-view (text + images)
- https://support.pipedrive.com/en/article/insights-feature
- https://support.pipedrive.com/en/article/automated-campaigns?category=campaigns
- https://support.pipedrive.com/en/article/email-sync
- https://www.pipedrive.com (desktop 1440 wide and 390x844 mobile)
- https://support.pipedrive.com/en/article/automations: 404 (not found).

Image assets opened at full size (kb-cms.pipedriveassets.com): pv1.png, pv4.1.png, insightsfeature1.png, insightsfeature4.png, "Screenshot 2023-04-13 at 17.17.59.png", "automated campaigns list.png", emailsync19.png.

Screenshots saved in `C:\Users\willi\AppData\Local\Temp\claude\C--Users-willi-OneDrive-Desktop-GitHub-Repositories-rightnow-ai\f8a7d979-9487-46fe-b300-dcca3fab7b2a\scratchpad\screenshots\pipedrive\`:
`pv1.png` (pipeline + pipeline dropdown), `pv4.png` (kanban cards, rotting/activity indicators), `insights1.png` (Insights report builder), `insights4.png` (Add goal modal), `camp1.png` (automated campaign setup modal), `camplist.png` (automated campaigns list), `emailsync19.png` (Sales Inbox), `home.png`, `home2.png` (marketing hero + automations/leads inbox), `mobile.png` (390 wide marketing page).

## 2. Information architecture & navigation

App shell (seen in hero mockup `home.png`, and help screenshots):
- Left rail: narrow icon-only vertical sidebar (about 64px wide at 1x, est.), dark indigo/navy background (hero mockup), Pipedrive "p" logo at top, then icons stacked ~60px apart: Leads (target/crosshair), Deals ($ circle), Automations/Campaigns area (robot icon, shown as the active item with a rounded violet/indigo highlight pill), Activities (clipboard with blue dot), Campaigns (megaphone), Mail (envelope with blue count badge "27"), Calendar (with red badge "1"), Contacts (card). No text labels in the rail; sections are identified by the page title in the topbar.
- Topbar (white, ~60px tall): left = page title ("Deals", "Insights", "Automations") in ~18px bold, with a small info (i) icon on some; centre = a pill-shaped global search ("Search Pipedrive", full radius, ~300px wide, 1px light border) and a circular "+" quick-add button beside it; right = marketplace icon, help (?), lightbulb/"what's new" with a red count badge ("1+"), then user avatar circle with name and company stacked ("Marian / Learn & Sell").
- Sections with sub-nav (Campaigns, Insights) show a second light-grey left panel (~230px wide, est.) with breadcrumb in the topbar ("Campaigns / Email campaigns", with a hamburger collapse icon at left). Campaigns sub-nav items: Email campaigns, Automated campaigns, Email templates, Settings. Active item = pale blue fill + blue text + blue icon.
- Insights sub-panel: top "+ Create" green split button (menu: Generate report (AI badge), Report, Goal, Dashboard), then collapsible groups with uppercase section labels: DASHBOARDS, GOALS (Active / Past), REPORTS with usage counter chip "7/250", each followed by "..." overflow menus; items list with small type icons (report, goal, dashboard).
- Sales Inbox (Email sync): second panel with green "+ New email" button, then folders Inbox (blue count pill 178), Drafts (2, grey), Outbox, Sent, Archive.
- Workspace/company switcher: shown only as the user name + company text at the top right (no dropdown observed).
- Command palette: not observed. Global search plus "+" quick add substitutes.
- View switcher on Deals: 4 icon-only toggle buttons grouped in a segmented control (Pipeline kanban, List, Forecast/revenue "$" circle, Archive/closed box).

## 3. Visual language

Marketing site (measured):
- Fonts: body `Inter` 16px/400; headings `Haffer` 700 (h1 52.6px, h2 57px). In-app UI looks like Inter-style neo-grotesque sans (est.).
- Colors: brand green `#017737` (rgb 1,119,55) and dark green `#014722` / `#024722` for hero; accent yellow `#FFDE00` (rgb 255,222,0) for the primary marketing CTA; ink `#192435` (rgb 25,36,53); mint tints `#F3FCF2`, `#D7F9D3`, `#F9FFFA`; neutral grey `#E9E9E9`. CTA pill: 40px radius, padding 9px 20px / 12px 20px, 18-22px text, weight 600.
- App (from images, est.): white content surface on very light grey page (`#F5F5F5`-ish) with a light grey app background behind kanban columns; primary action green `#2A8A4A`-ish (est.) for "+ Deal", "Create", "Save", "+ Campaign", "+ New email"; link/selection blue `#1F5BD8`-ish (est.) for active nav, selected dropdown row (solid blue with white text), "Sort by: Next activity", "Reply?" link; warning amber triangle; danger red filled circle with chevron; success green filled circle with chevron; dark navy text `#1F2937`-ish.
- Light mode only observed. Dark mode not observed (only the sidebar and marketing hero are dark).
- Type scale in app (est., from 900px crops at ~1x): page title 18px/700; column header 16px/600; card title 14px/600; secondary line 12px/400 grey; meta (value, counts) 12px; table cells 12-13px.
- Density: compact. Inbox rows ~24px tall in the screenshot (compact ~36px at true scale, est.), tables with 1px light borders between rows. Card padding ~10px, card gap ~8px; kanban column gap ~12px.
- Radii: cards ~6px, buttons ~4-6px, dropdown menus ~6px, status pills fully rounded or 3px (tiny uppercase "DRAFT"/"READY" chips are rounded ~10px), search input full-pill. Marketing mockup frame ~28px.
- Borders vs shadows: borders (1px #DDD-ish) for inputs and table rows; soft shadow on kanban cards and dropdown/modal surfaces; modals have a grey `#F5F5F5` header and footer band separated by 1px lines from a white body.
- Iconography: simple 1.5px-stroke outline icons, 16-20px, monochrome dark grey; coloured only for status (amber warning, red/green circles) and type (green phone/meeting icons, blue envelope).
- Illustration: playful flat vector (grey domino tiles with blue accents in the automation setup modal); marketing uses green photo-less blocks, customer portrait cards.

## 4. Components

Tables/lists
- Leads inbox (marketing, `mobile.png`): columns Contact person (bold if unread/new, blue dot at left), Next activity (icon + coloured text: amber warning "No activity", red "Yesterday" with envelope, green "Today · 12:15 PM" with phone, green "Tomorrow" with meeting icon), Labels (tiny solid uppercase chips: COLD blue, WARM yellow, HOT red), Source (icon + text: Chatbot, Prospector, Live Chat, Deal, Import), Organization. Leading checkbox column; selected rows have pale blue fill. Bulk actions appear above as outlined buttons "Send group email" and "Schedule activities".
- Sales Inbox rows: checkbox, blue unread dot, sender (bold when unread), subject bold + snippet grey on the same line, small lock/visibility dropdown chip (private/shared), right-aligned time ("15:12", "17 Dec"). Toolbar: select-all checkbox with dropdown, refresh, "216 conversations", Labels dropdown, Filters dropdown, search icon, settings gear.
- Automated campaigns list: stacked row cards, each with a document icon, campaign title 16px/600, "Updated on / Last sent" caption, a status chip, then three right-aligned metric columns (Delivered 134, Opened 45.8%, Clicked 22.6%; value 16px above grey label), a blue tinted "Automation x" link-chip and a "..." overflow button. A linked automation appears as a nested child row below with a robot icon, name, and "Active" green dot or "Inactive" grey dot.
- Status chips: DRAFT (grey outline), READY (grey), ACTIVE (solid green, white text), INACTIVE (green outline), UNLINKED (grey). All uppercase, ~10px, bold.

Cards
- Deal card (kanban): title 14px/600, subtitle "Org, Person" 12px grey truncated with ellipsis, bottom row = person avatar icon, optional red age pill ("22d", "45d" = rotting), value ("$600"), right-aligned status icon (amber warning = no activity scheduled, green circle chevron = activity planned, red circle = overdue, grey circle = none). Optional coloured label bar on top-left (short yellow stripe). Rotting deals get a pale red/pink card tint. Selected/highlighted card in docs gets a red outline (doc annotation, not UI).
- Kanban column: grey rounded panel; header = stage name 16px/600, below a grey line with a scales icon, sum ("$22,031.25") and count ("3 deals"). Columns ~265px wide (est.), equal width; horizontal scroll for more.

Forms/inputs
- Modal form (Add goal 2/2): label-left layout, right-aligned labels (~110px column), inputs 40px tall, 1px grey border, 4px radius, caret dropdowns, multi-select token ("All pipelines x"), date range pair "01/01/2026 - 31/12/2026", numeric with currency hint "Value, USD". Footer: ghost "Previous step" with left arrow at left; "Cancel" outline + green "Save" at right. Step counter in title ("Add goal 2/2 - Revenue forecast").
- Filters: "Add condition" link with filter icon under the toolbar; "Pin filters"; report filter row = entity dropdown, field dropdown, operator ("is"), value dropdown, date inputs, then green circle "+ Add filter".

Buttons
- Primary green solid with white text, with split variant (main + caret) for "+ Deal" and "+ Create". Secondary white outline (Cancel, Filter dropdown, "Pipeline" selector, "..." icon-only). Icon-only segmented toggle for view modes. Text-link blue ("Sort by: Next activity", "Add filter"). Disabled primary = pale green (Continue before selection).

Tabs: marketing mockup shows text tabs with a blue underline on active (Templates / Automations). In-app Insights uses chart-type icon toggles (bar, horizontal bar, pie, number, table) as a mini segmented row.

Drawers/modals: centred modals ~500-760px wide, 6px radius, grey header/footer. Dropdown menus: white, shadow, selected row solid blue; contains actions with icons (Reorder pipelines, Pipeline visibility, Customize deal cards, Pipeline layout settings) and a blue "+ New pipeline" at the bottom after a divider. Deal detail opens as a full detail view (not a drawer) per the docs text.

Badges: red numeric badges on icons (bell, calendar), blue count pill on mail icon, "AI" gradient chip on "Generate report", "BETA"-style small chips (not seen).

Toasts: not observed. Empty states: "No goals" (grey plain text under group), otherwise not observed.

Charts: Insights column chart with stacked series (Open light blue `#B5DDF2`-ish, Won green `#6BAA6F`-ish), value labels above bars, zero labelled "0", axis titled by rotated "Number of deals", x month labels truncated ("Jan ..."), legend at right, "Segment by Status" dropdown with clear x, "View by Deal created on / Monthly" dropdowns beneath, Export dropdown and settings gear at the top right of the chart panel.

Editors: Campaign email editor not seen. Automation builder (marketing mockup): vertical flow of rounded white cards with a thin connector line; each card has a coloured icon tile (green bolt for Trigger, violet envelope for Action), small grey type label ("Trigger", "Action") above bold 16px sentence ("When a deal is added", "Send a welcome email"); trigger card has an on/off toggle. A second mockup shows a numbered node "1" with a blue "TRIGGER" tag on a bordered box, and a "Templates | Automations" tab strip with category filter chips (Email, Campaigns, Activity, Deal) and "FEATURED TEMPLATES" tiles with miniature flow previews on a lavender background.

## 5. Key screens

Deals / Pipeline view (`pv1.png`, `pv4.png`)
- Topbar title "Deals (i)". Below: toolbar row. Left: segmented 4-icon view switcher + green split "+ Deal". Right: "12 deals (i)" counter, "Pipeline" selector with pipeline icon and caret (red box = doc annotation), pencil edit button, "Filter" dropdown, "..." menu. Second row: "Pin filters" and "Add condition" links on the left; "Sort by: Next activity" blue pill with up-arrow on the right.
- Body: horizontal kanban, stages Qualified, Contact Made / First call, Demo Scheduled, Proposal Made, Negotiations Started. Primary action: drag a card between stages or "+ Deal". Hierarchy: stage totals (money) are visible in every header, giving a funnel read at a glance; card shows only title, org, owner, value and one status icon.
- Pipeline dropdown lists pipelines with check on current, selected row solid blue with inline pencil, then management actions.

Insights (`insights1.png`, `insights4.png`)
- Left panel (~270px) with Create menu, Dashboards, Goals, Reports tree. Main area: title "New deal performance report" with Cancel (outline) and Save (green) top-right; report type dropdown "Performance" with info icon; filter card "1 filter applied" with "THIS YEAR" tag and clear x; chart card with chart-type icons, Export, settings gear; chart; "View by" row at bottom. Primary action: Save. Builder pattern: measure (left rail rotated label "Measure by Number of deals"), segment, view-by around the chart so the sentence "Number of deals, segmented by Status, viewed by Deal created on monthly" is readable.
- Goal creation is a 2-step modal (see forms).

Automated campaigns (`camp1.png`, `camplist.png`)
- List: sub-nav + "+ Campaign" green button top left, "All states" filter dropdown top right, rows as above. Create flow: build email, "Mark as ready", "Continue to automations", then modal "Automated campaign setup: What would you like to do with the campaign?" with two illustrated choice cards, "Create automation / Pick a template to get started and then customize it" and "Add to existing automation / Choose an existing automation and add the campaign step manually"; Cancel + Continue (disabled pale green until a card is chosen). Audience is defined in the automation, not the campaign.

Sales Inbox (`emailsync19.png`)
- Folder panel left, conversation list right, no reading pane seen. Unread = blue dot + bold. Sync status/linking to deals not visible in this crop, but the docs describe emails linked to contacts/deals and shown in deal detail (text only).

Leads inbox (marketing mockup, `mobile.png`): table with checkbox multi-select and above-table bulk buttons.

Automations (marketing mockup, `home.png`): see editors.

Mailbox/warm-up settings: not observed (Pipedrive has no warm-up).

## 6. Interaction patterns

- Drag and drop: cards between stages; drag to a "Delete" drop zone; pipelines reordered via "Reorder pipelines" (drag handle icon).
- Inline actions on cards: clicking the activity status icon opens a popover to mark done or schedule next (docs text).
- Rotting: age pills + pink tint on stale deals surface neglect without extra UI.
- Progressive disclosure: toolbar shows only counts and one filter; "Add condition" expands filter rows; "Pin filters" persists them; "..." menus hold less-used actions; "Customize deal cards" and "Pipeline layout settings" let users control density.
- Hover-edit titles: campaign title is edited by hovering and clicking the title (docs text).
- Gated setup: campaigns need 2FA and admin permission (docs text).
- Wizard steps in modals ("2/2", Previous step).
- Real-time feedback: unread count badges on nav icons, "Active"/"Inactive" green/grey dots on automations, live metrics (Delivered/Opened/Clicked) on campaign rows.
- Keyboard shortcuts, setup checklists: not observed.
- Marketing page shows a chat widget with "Hi there, Welcome to Pipedrive!" bubble and a sticky bottom feature bar (Visual pipeline, Email sequences, Automations, 500+ integrations, AI assistant, Sales reporting) with yellow "Start selling" CTA.

## 7. Responsive / mobile behavior

- Marketing site at 390x844: logo + yellow "Try it free" pill + hamburger; sections stack to one column; product mockups are cropped at the right edge (tables clipped, not reflowed). App mobile UI: not observed.

## 8. Ideas worth borrowing for rightnow-ai

- Kanban column headers with sum and count ("$22,031 · 3 deals"): for the CRM pipeline show value and lead count per stage; for sequences show "N leads" per step.
- Dense deal card with exactly 4 pieces of info and one status icon at the right (amber = no next action, green = scheduled, red = overdue); reuse for lead cards (next send, replied, bounced).
- Rotting indicator: red age pill + pink tint on leads untouched N days.
- Segmented icon-only view switcher (kanban / list / forecast / archive) beside a split primary button ("+ Lead" with import in the caret).
- Toolbar line "N deals (i)" + pipeline selector with inline manage actions + Filter + "..." + "Pin filters / Add condition" + "Sort by" pill: one disciplined toolbar for leads and campaigns.
- Campaign list rows with state chip (DRAFT / READY / ACTIVE / INACTIVE / UNLINKED) and three right-aligned metrics (Delivered, Opened, Clicked); nested child row showing the linked automation with an Active/Inactive dot.
- "Mark as ready" gate between drafting and launching a campaign, plus a two-choice modal (template vs existing).
- Automation builder as a vertical stack of cards with icon tile, small "Trigger/Action" label, bold sentence, and toggle on the trigger; featured templates gallery with category chips.
- Analytics builder that mirrors a sentence (Measure by / Segment by / View by) with Export and chart-type icon toggles; goals as a separate sidebar group.
- Sub-nav panel with count pills for inbox folders (Inbox 178, Drafts 2) and a green primary action on top.
- Thin icon-only dark rail plus light topbar with centred pill search and "+" quick add.
- Modal forms with right-aligned labels and Previous step / Cancel / Save footer on a grey band.
- Uppercase micro-chips for temperature labels (COLD blue, WARM yellow, HOT red) and source icons in leads tables.

## 9. Why it works

Pipedrive's UI works because it keeps one idea in front of the user at all times: deals move left to right. The kanban with money totals per stage makes the whole business legible in a single glance, and every other area (campaigns, inbox, insights) reuses the same grammar: a dark icon rail for where you are, a white topbar with one search and one "+", a single green primary button, small outlined secondary buttons, blue only for selection and links. Cards and rows hold a small fixed set of facts with one coloured icon for status, so scanning is fast and the amber/green/red states are learned once and reused everywhere. Generous white space inside a compact density, quiet grey panels, soft shadows and a restrained palette (green, blue, amber, red used only for meaning) keep it calm, while the friendly rounded pills, domino illustrations and plain-language labels ("Mark as ready", "What would you like to do with the campaign?") make a complex tool feel approachable. New users can follow it because the sequence of the work (create, mark ready, continue to automation, activate) is staged by buttons and modals, and each list shows state and results on the same row.
