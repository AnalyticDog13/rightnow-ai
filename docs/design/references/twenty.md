# Twenty (open-source CRM) - UI reference

Values marked (est.) are estimated from images; unmarked CSS values were measured from the live HTML app mock on twenty.com (colors there are reported in display-p3; hex below is the sRGB equivalent, rounded).

## 1. Sources

Viewed:
- https://twenty.com (homepage; contains a live-HTML Companies table inside a macOS-style window; measured with evaluate_script) - screenshots: `home.png` (narrow ~750px layout), `home-app-table.png` (desktop), `home-mobile.png` (390px attempt, not useful)
- https://docs.twenty.com/user-guide/getting-started/how-tos/navigate-around-twenty (text) + doc images `command-menu.png`, `side-panel.png`
- https://docs.twenty.com/user-guide/views-pipelines/how-tos/create-a-kanban-view-for-projects (text) + `kanban.png` (Fields options panel over a kanban)
- https://docs.twenty.com/user-guide/workflows/overview (text) + `workflow-actions.png` (Select Action panel)

Not viewable: https://demo.twenty.com redirected to the sign-in page (`/welcome`), so there was no live-app exploration. GitHub README was not opened. No inbox, analytics, or warm-up screens were seen (Twenty has none of these as first-class screens; its email is sync + a Send Email workflow action).

All screenshots are in `C:\Users\willi\AppData\Local\Temp\claude\C--Users-willi-OneDrive-Desktop-GitHub-Repositories-rightnow-ai\f8a7d979-9487-46fe-b300-dcca3fab7b2a\scratchpad\screenshots\twenty\`.

## 2. Information architecture & navigation

App shell = three columns: left sidebar (~170px in the mock, est. 200-220px real), center record view, optional right side panel (~400px, est.).
- Sidebar top: workspace switcher ("Apple" with logo and chevron; "User Guide" in docs), then search icon, and a collapse-sidebar icon. Docs: workspace dropdown also creates new workspaces. Search focus key is `/`.
- Row below: "Home" pill (selected, icon + label), a chat icon and a settings gear as icon buttons.
- Section label "Favorites" (11px, 600, gray #B3B3B3): per-user favorite views, e.g. "Sales Dashboard" with a yellow letter avatar "S" and a muted "Dashboard" type suffix.
- Section label "Workspace": objects, in order: Companies, People, Opportunities, Tasks, Notes, Dashboards, Workflows (Workflows has a right chevron, expandable), then "Book a demo" in the marketing mock. Each object has its own tinted icon (Opportunities red target, Tasks teal check, Notes teal doc, Workflows orange gear, People/Companies blue-ish outline).
- Bottom of sidebar (older doc screenshot): "Support". Settings (via gear) holds: mailbox/calendar connection, Data Model (custom objects/fields/relations), API and webhooks, members/roles, billing, Updates -> Early Access, Documentation.
- Main header bar (~40px): breadcrumb-ish object title with icon ("Companies"), on the right primary "+ New Record" button, then up/down chevron buttons (previous/next record) and a kebab menu.
- Second bar (~41px): view switcher on the left ("All Companies - 9" with list icon, count, chevron dropdown), on the right plain text buttons "Filter", "Sort", "Options".
- Command menu: Cmd/Ctrl+K, or the kebab. It opens as a right-hand panel (not a centered modal) with a "Type anything..." input, grouped sections "Companies" (Create new record, Import records, Export view, See deleted records, Create View) and "Global" (Search records `/`, Quick Lead, Go to Workflows `G then W`, People `G then P`, Dashboards `G then D`, Opportunities `G then O`, Settings `G then S`, Tasks `G then T`, Notes `G then N`). Shortcuts shown as small bordered key caps on the right of each row.
- Search is global across all objects.

## 3. Visual language

- Light theme dominant (dark theme exists in product, not seen). Page background white `#FFFFFF`; marketing page `#F4F4F4`.
- Text: primary `#333333` (p3 0.2) in-app, secondary/inactive nav `#666666` (p3 0.4), column headers `#999999` (p3 0.6), section labels/placeholders `#B3B3B3` (p3 0.7). Marketing body color `#1C1C1C`.
- Accent: single blue, approx `#4560D6` (p3 0.276 0.384 0.837) for the primary button; Select-pill tints are pastel (green "Proposal", yellow "Customer", light-blue circle avatar `#E2E9FF` with dark navy letter).
- Typography: in-app UI is Inter (marketing is a custom grotesk "Host Grotesk" light 300 for headlines, 44px, plus a mono for button labels). In-app scale is tiny and flat: 13px/500 for nav, headers, titles; 13px/400 for cell values; 12px/500 for the window title; 11px/600 for section labels; 10px/500 for avatar letters. Hierarchy comes from color (#333 / #666 / #999 / #B3B3B3), not size.
- Density: compact. Table body rows pitch 33px (rows 32-33px tall), header row 32px; sidebar nav items 28px tall on a 30px pitch with 4px radius; toolbar buttons 24px tall.
- Radii: 4px small controls/nav items/chips, 8px buttons, 999px pills (URL/link chips), 50% avatars, 20px outer window. Marketing buttons have a signature clipped bottom-right corner.
- Borders vs shadows: hairline 0.67px borders (`~#EBEBEB`) separate cells and panels; shadows nearly absent in the table (cards in kanban have a very soft shadow). Selected nav row = 4% black wash (`rgba(0,0,0,.039)`), no color.
- Iconography: thin outline icons (Tabler-style), one per field type, shown in every column header, in the side panel field list and in cards. Company/person records use real logos/photos as 14-16px avatars.
- Illustration: none inside the app; marketing uses animated pixel/dash blue bar-field decoration.

## 4. Components

Tables (`home-app-table.png`):
- Columns seen: Companies (name with logo chip + "+" add-column at header), Url (gray pill with 1px border, 13px, 20px tall, `rgba(0,0,0,.02)` fill), Created By (avatar + name), Address, Account Owner (avatar chip), ICP (boolean: check/cross icon + "True"/"False"), ARR ($500,000), Linkedin (pill), Industry (pill, gray text), Main contact, Employees (number), Opportunities (relation with letter-avatar), Added (date "Jul 1, 2023"). Long text truncates with ellipsis ("18 Rue De Nav...").
- Each header has a leading field-type icon; first column has a checkbox column (select all in header); cell padding 0 8px; vertical cell dividers.
- Bottom of table: "+ Add New" row and a "Calculate" footer for per-column aggregations (docs image).
- Relation values render as small chips (4px radius, gray 4% fill) with avatar. Text-ish link values render as pill chips.
- Filter / Sort / Options are text buttons (24px high, 4px radius, hover wash); views are a dropdown with count; unlimited saved views per object; Group By sections; favoriting a view puts it in the sidebar.
- Bulk actions: checkbox selection (action bar not seen).

Cards (kanban, `kanban.png`): column header = colored pastel status pill (e.g. green "Proposal", yellow "Customer") + count in a gray circle on the right; "+ New" ghost button at bottom of each column; card = white, 1px border, soft shadow, ~8px radius, title chip ("Microsoft - $10000") then icon-prefixed rows (amount, close date, person chip, company chip, 5-star rating). Which fields show is controlled by Options -> Fields ("VISIBLE" list with drag handles, "HIDDEN" list with eye toggles) and a "Compact view" switch (cards show only name). Column header number click opens aggregation (Count, Sum...).

Buttons: primary = solid blue 8px radius with plus icon ("+ New Record", white 13px/500, 24px tall); secondary = icon-only square buttons with 1px border (prev/next chevrons, kebab); ghost = text-only (Filter, Sort, Options); in side panel footer "Options  CmdO" (ghost with key hint) and "Open  Cmd+Enter" (primary blue with key hint).

Side panel (`side-panel.png`): header with close X, record icon, name and muted "Created 25 minutes ago"; tab row "Home | Tasks | Notes | Files | +2 More v" (icon + label, underline on active); body = label/value list (icon + muted label ~100px column, value editable inline: Address, ARR, Created by, Domain Name chip, Employees, ICP, Linkedin, Last update, X), then relation sections with titles and right-aligned action icon (Account Owner pencil, Opportunities +, People "All (1)" with chips); sticky footer with Options and Open.

Command menu: see section 2; rows with 24px icon tile, label, and key caps; section headings 11px gray.

Workflow action picker (`workflow-actions.png`): a vertical side panel titled "Select Action" with X; groups "Data" (Create Record, Update Record, Delete Record, Search Records, Create or Update Record), "Flow" (Iterator, Filter, Delay), "Core" (Send Email, Code - Serverless Function, HTTP Request), "Human Input" (Form); each row = 28-32px rounded gray icon tile (icons color-coded: red for core, green for flow, orange for human input) + label. Triggers per docs: record events, schedule, manual, webhook. Workflows are themselves a record object with Test and Activate steps.

Not observed: toasts, empty states, modals, charts, rich-text editor, form inputs in isolation.

## 5. Key screens

1. Records table (Companies): header with icon+title and blue New Record at right; view bar; field-typed columns; 33px rows; checkbox column; "+ Add New" and Calculate footer. Primary action: New Record (or inline "+ Add New"). Hierarchy: neutral, data-first, chrome is gray and recedes.
2. Record side panel: click a row, a ~400px panel slides over the right; table dims behind it. Open (Cmd+Enter) goes to the full record page. Maps to a lead/contact preview in rightnow-ai.
3. Command menu panel: right-docked search + actions + navigation shortcuts.
4. Kanban pipeline (Opportunities, via docs): columns by Select field (stage), colored pills, counts, aggregations, drag cards to change status, card field picker. Maps directly to rightnow-ai CRM pipeline.
5. Workflow builder (docs): record with trigger + ordered actions; action picker above. Trigger -> actions (Send Email, Delay, Filter, Iterator, Form, AI Agent, HTTP). Maps to automations and sequence steps (Delay + Send Email + Filter). The canvas itself was not seen.
6. Home/Dashboards: only a favorite "Sales Dashboard" entry seen; no dashboard content seen.

## 6. Interaction patterns

- Keyboard-first: `/` search, Cmd/Ctrl+K command menu, `G then <letter>` go-to-object chords, Cmd+O options and Cmd+Enter open in the side panel, key caps displayed inline as affordances.
- Inline editing: cells and side-panel fields edit in place (side panel shows values as editable chips; empty values as faint placeholder like "ARR").
- Progressive disclosure: row -> side panel -> full page (Open); "+2 More" tabs; Options -> Fields -> hidden fields; Compact view toggle; aggregation picked per column.
- Hover: nav and toolbar items get a 4% black wash; selected nav row keeps it.
- Soft delete with "See deleted records"; import/export CSV in command menu.
- Workflow: Test then Activate. No setup checklist or real-time status feedback was observed.

## 7. Responsive / mobile

Only marketing-page behavior observed: at ~750px the page collapses to a hamburger and the embedded app mock shows a narrow sidebar of icons only (search, home, chat, settings, object icons) with the table clipped horizontally (horizontal scroll). Real app mobile layout: not observed. Docs mention a collapsible sidebar.

## 8. Ideas worth borrowing for rightnow-ai

- Same chrome for every list: icon+title, one blue primary button top right, view switcher with count under it, text buttons Filter / Sort / Options. Use it for Leads, Campaigns, Mailboxes.
- 13px/500 UI text with 4-step gray ramp (#333 / #666 / #999 / #B3B3B3) and hairline borders; no shadows in tables.
- Type icon in every column header; pills (999px) for urls/emails; avatar chips for owners and accounts.
- Row-click opens a right side panel with tabs (Home, Tasks, Notes, Files) and footer "Open" with shortcut. For leads: Home / Emails / Activity / Notes tabs.
- Right-docked command menu with grouped actions and `G then X` navigation chords; show key caps.
- Kanban: pastel stage pills, count badge, per-column aggregation (count, sum), compact toggle, field picker with visible/hidden lists - ideal for the CRM pipeline.
- Workflow action picker grouped Data / Flow / Core / Human input with colored icon tiles; reuse for automations and sequence step types (Send email, Delay, Filter/Condition, Task).
- Sidebar: workspace switcher at top, per-user Favorites (saved views), then objects, with small colored icons; selected = 4% gray wash.
- Calculate footer row for column totals (e.g., sent, replied counts in campaigns table).
- Selected-state and filter chips avoid color; reserve blue for the single primary action.

## 9. Why it works

Twenty looks good because it is restrained: nearly everything is 13px Inter in four grays on white, separated by hairlines, so the data is the only thing with weight and the single blue button is the only loud element. Every object uses the same skeleton (title, view bar, typed columns, side panel), so once a user understands Companies they understand People, Opportunities and Workflows. Typed icons and chips (logos, avatars, pills, check/cross booleans) make a dense grid scannable at a glance without color noise. The sidebar reads like a plain list of nouns (Companies, People, Opportunities, Tasks, Notes, Workflows), which states exactly what the product is for, and the progressive path row -> side panel -> full page, plus visible keyboard shortcuts, lets beginners click and experts fly. Caveat: this analysis is based on the marketing-page app mock and doc screenshots, not a live signed-in session.
