# HubSpot UI reference (CRM + Sequences + Workflows)

Scope note: no live app login was available. Everything below comes from HubSpot knowledge-base screenshots and the saasui.design gallery (a 2020-era demo-account UI). The 2025 sequence/workflow screenshots show the current "Canvas" design language (rounded outlines, black primary buttons, maroon links); the saasui images show the older teal/orange look. They differ visibly, so each observation is tagged **[2025 KB]** or **[older demo]**. Values marked (est.) are read off images.

## 1. Sources

Pages viewed:
- https://knowledge.hubspot.com/sequences/create-and-edit-sequences (page text/image list; live CSS read)
- https://knowledge.hubspot.com/workflows/create-workflows (image list; live CSS read)
- https://www.saasui.design/application/hubspot (15 screens: signup, login, dashboard, tables, modals, profile, onboarding)

Screenshots, in `C:\Users\willi\AppData\Local\Temp\claude\C--Users-willi-OneDrive-Desktop-GitHub-Repositories-rightnow-ai\f8a7d979-9487-46fe-b300-dcca3fab7b2a\scratchpad\screenshots\hubspot\`:
- `seq-add-email.png` (Add automated email side panel), `seq-settings.png` (sequence Settings tab), `seq-delay.png` (delay popover on a step)
- `dashboard.png` (Sales Dashboard), `table1.png` (Contacts index), `profile.png` (contact record + Note composer), `onboarding.png` (Inbox empty state "Say hello.")
- `wf-add-action.png` (workflow trigger card + "+" connector + End), `wf-trigger.png` (enrollment trigger image; captured but not studied closely)
- `seq-page.png` (KB article viewport)

Not seen: the full sequence editor screen, a deals board (kanban), the workflow canvas with branches, and real reports tables. Nothing is described for those.

## 2. Information architecture and navigation

- **App shell [older demo]:** a single top bar, about 60px tall (est., 1920 wide capture), dark slate navy (~#33475B est.). There is no persistent left sidebar. Left to right: orange sprocket logo, then dropdown menus: **Contacts, Conversations, Marketing, Sales, Service, Automation, Reports**. Right side: search icon, marketplace icon, settings gear, bell, then avatar plus user name with a dropdown caret. The active menu item gets a slightly darker block behind it.
- Each top item opens a dropdown of sub-pages (for example Contacts holds Contacts, Companies; Sales holds Deals, Tasks, Sequences). Product areas map to the top-level menu, not to a sidebar.
- **Secondary sidebar only inside a hub tool:** Inbox has a left rail (about 220px, est.) titled "Inbox" with a collapse chevron (double angle), a list item "All conversations  0", and "Inbox Settings" with a gear pinned at the bottom.
- **Page header pattern:** large teal title with a caret (it is a view/dashboard switcher), for example "Contacts v" with a small count under it ("2 Contacts"), and "Sales Dashboard v". Right-aligned actions: a secondary outline button and a filled orange primary ("Create contact", "Add report").
- **Record page [older demo]:** a "< Contacts" back chip at the top left works as the breadcrumb, then a three-column layout (see section 5).
- **Search:** a top-bar magnifier icon (no visible command palette in these captures). Tables have their own inline search ("Search name, phone, e...").
- **Bottom-docked guided-tour bar [older demo]:** a teal strip along the bottom with steps "Identifying opportunities / Building relationships / Deals / Reporting" and an "Exit demo" button.
- **Floating help:** a purple-blue pill bottom-right, "Chat | Help".
- **Sequences:** a sequence has three tabs along the top of its editor: **Steps, Settings, Automate** [2025 KB].

## 3. Visual language

- **KB site live values (measured):** body font "HubSpot Sans", sans-serif, 16px, weight 300, color rgb(31,31,31) (#1F1F1F), page background rgb(252,252,250) (#FCFCFA, warm off-white). H1 is "HubSpot Serif", 32px, weight 400. Nav links 14px, weight 500. This shows the current brand pairing: a geometric sans for UI, a serif for headlines.
- **2025 app UI [2025 KB]:** rounded-geometric sans (HubSpot Sans; the "a" and "g" shapes are single-storey and friendly). Titles around 20-24px semibold black (est.), field labels 14px semibold, helper text 13-14px regular gray (#516F90-ish est.). Links are dark maroon and underlined (~#4B0F3A est.). Primary buttons are solid black with white text; secondary are 1px dark-outline white buttons. Radius is about 4-6px on buttons and inputs, 8px on cards (est.), a fully rounded pill on search inputs. Toggles are a split "ON [check]" / "OFF" block: black fill with white label when on, light gray when off.
- **Older demo palette [older demo]:** navy top bar (~#33475B), orange primary (~#FF7A59, the HubSpot "sorbet"), teal links and titles (~#0091AE), page body white, content area behind cards light gray-blue (~#F5F8FA), card background white, info icons in gray-blue dots. Chart series: orange, lavender purple, pink, teal, tan. A selected card gets a 3px teal outline (the dashboard's tour highlight).
- **Light only:** no dark mode seen.
- **Borders over shadows:** cards use a 1px light-gray border (~#DFE3EB est.), with a soft shadow only on floating elements (tour tooltips, popovers, the note composer, the floating chat pill).
- **Density:** medium and airy. Table rows are about 45px high (est., from `table1.png`: rows ~44px apart on a 1920 capture). Header row about 50px. Content margin from page edge about 55px (est.). Card inner padding about 25px.
- **Iconography:** thin outline icons, 16-20px, in gray; record action icons are 40px circles with a light-blue fill and a label below (Note, Email, Call, Log, Task, Meet).
- **Illustration:** flat isometric spot illustrations (email tray, laptop with chat, forms page) on empty states, plus the brand sprocket as a default contact avatar.

## 4. Components

**Tables/lists (Contacts index, `table1.png`) [older demo]**
- Structure: title row, then a **view tabs row**, then a **filter bar**, then the table, then pagination.
- View tabs: "All contacts" (pin icon + caret, active, has a boxed white tab with a bottom edge), "My contacts", "Unassigned contacts", "+ Add view", "All views". Pinned views carry a pin glyph. This is saved filtered views as tabs.
- Filter bar: search box with magnifier (about 245px wide), quick filter dropdowns "Contact owner v", "Create date v", "Last activity date v", then "More filters" with a sliders icon. Right side: gray buttons "Table actions v" and "Save view" (disk icon).
- Header: uppercase small gray column names (NAME, EMAIL, PHONE NUMBER, CONTACT OWNER, ASSOCIATED COMPANY), each with a sort double-arrow, a select-all checkbox column at the left, columns separated by vertical hairlines. The table scrolls horizontally (the last column "L..." is clipped).
- Cells: avatar chip (orange sprocket circle) plus teal link name; email as teal link; empty values as "--"; owner as a gray silhouette avatar plus "Unassigned" link; associated company as logo + link.
- Footer: "< Prev [1] Next >" and "25 per page v".
- Bulk actions: not seen (no rows selected in the capture).

**Cards**
- Dashboard report cards [older demo]: white card on gray-blue background, title in 22px light teal-gray with an info dot, a muted "Date Range: Last year | Frequency: Monthly" subtitle line, then the chart. 2-column grid with about 25px gutters; each card roughly 850px wide on a 1920 capture.
- Association cards in the record sidebar: a white bordered box with company logo, link, domain with external-link icon, and phone.
- Settings cards [2025 KB]: a titled section (bold 20px "Follow-up emails", "Tasks", "Campaigns") above a bordered rounded box that holds one or more setting rows.

**Forms/inputs**
- 2025: 1px dark-gray outline, ~4px radius, ~44px tall (est.), label above in semibold, helper text underneath in gray. Select = outline box with a solid down-triangle at the right. Search = fully rounded pill with a magnifier at the right. Time pickers = clock icon + value, with an arrow between start and end ("8:00 AM -> 6:00 PM").
- Number stepper input with up/down chevrons in a split cell (delay popover).

**Buttons**
- 2025: primary = black fill, white label, ~4px radius ("Save"); secondary = white with 1px dark border ("Cancel", "Create template").
- Older: primary = orange fill, white text ("Create contact", "Add report"); secondary = white with orange border and orange text ("Import", "Create dashboard", "Actions v"); tertiary = gray-fill ("Table actions", "Save view"); in-record "Create Note" = slate blue (~#516F90).
- Link-style buttons: teal text with a "+" ("+ Add view", "+ Add").

**Tabs**
- 2025 underlined tabs: "Steps | Settings | Automate", active = bold with a 4px black bar under it, centered across the editor.
- Record tabs: "Activity | Notes | Emails | Calls | Tasks | Meetings", active = a thick slate-blue underline (~3px).

**Drawers, panels, modals**
- **Right side panel** for adding an automated email step: header "Add automated email" with an X, divider line, then section "Email template - Choose an existing template or create a new one", a "Create template" outline button, an "All templates" dropdown, a pill search "Search templates", then a list of bordered rows (title as maroon underlined link, "Updated 3 years ago by Reed Gilbride" as gray meta). Panel about 345px wide (est., 1920 capture ~690px at 2x).
- **Popover** anchored to the delay label: arrow nub, label "Business days" with an info icon, stepper input, "Save" (black) + "Cancel" (outline).
- **Docked composer** (Note): bottom-right floating panel with a slate-blue header bar ("Note", collapse chevron, expand arrows, X), a text area ("Start typing to leave a note..."), a formatting toolbar (B, I, U, clear formatting, "More v", link, image, snippet, document, attach), and a footer: disabled "Save note" button, checkbox "Create a task to follow up", and "Associated with 2 records v" link.
- **Tour tooltip** (dark slate card with arrow): "1 of 12", message text, white "Next: Your deal funnel" button.

**Badges/pills:** not really present in the captures. Status is carried by text, small colored dots in chart legends, and link-styled values (Unassigned). Sequence-level states are not visible.

**Toasts:** not observed.

**Empty states:** centered big bold title "Say hello.", one-line subtitle, then four equal outlined cards (Email, Chat, Forms, Facebook Messenger) each with an isometric illustration, a label, and a check-mark benefit list below ("Manage and respond to emails from your inbox"). Each card is about 200x200px (est.) with a 1px teal border. Contact "Deals (0)" empty copy: "Use deals to track all your revenue opportunities." with "+ Add".

**Charts (dashboard)**
- Line chart with 2 series (revenue goal in light gray with hollow dots, closed amount in orange with circle markers), light dotted horizontal gridlines, y-axis title rotated, x-axis title bold below, legend above the plot with hollow circle swatches.
- Stacked horizontal bar "Deal Forecast" with a big number ($90,439) on top, a vertical QUOTA marker with a $60,000 flag, and purple/pink/coral segments.
- Funnel table "Deal Stage Funnel": stage name, count bar in coral with value inside, conversion % in a trapezoid connector column.
- "Activity this month" multi-series chart with dot legend (Email sent to contact, Task, Call, Meeting).

**Editors:** rich-text note editor with toolbar (above). Sequence step emails show a body preview with a highlighted personalization token ("Company: Company name" in blue highlight on light-blue), "See more" expander, "Add A/B test" link button, and a "..." overflow menu on the step card.

## 5. Key screens

### 5.1 Sequence editor, Steps tab [2025 KB; only fragments seen]
- Three tabs (Steps, Settings, Automate) at the top center of the editor.
- Steps are vertical cards connected by a downward arrow. Between two steps sits a delay label in a gray band above the next card: **"Delay: 1 business day"** (bold value, clickable). Clicking opens the popover (stepper + Save/Cancel). Each step card shows an icon circle (coral), the email subject/name ("Email #2"), a body preview with a token highlighted, "See more", "Add A/B test" at the bottom-right, "..." menu on the right, and an "Actions v" menu on the delay band's right.
- Step types per the page text: automated email, manual task, call task (the page's panel images show "Add automated email" and an "add email template to task" panel).
- Primary action: add a step (side panel). Hierarchy: the step card is white on a light-gray canvas; delay is subordinate gray text.
- Maps to: rightnow-ai sequence builder with per-step delay in days.

### 5.2 Sequence Settings tab [2025 KB] (`seq-settings.png`)
- Single centered column about 930px wide on a 1920 capture (~465px at 1x, est.). Sections with bold section headings: **Follow-up emails**, **Tasks**, **Campaigns**.
- Row 1: "Execute steps on business days only" with description, toggle ON at the right. Sub-block "Automated email send window - When enrolling a contact, you can customize the specific send time & time zone." with "Send window" start/end time fields (8:00 AM -> 6:00 PM) and a lightning-bolt note "HubSpot will choose times with the highest open rate during this range. Learn more".
- Row 2: "Email reminders - Receive an email reminder at the time you choose." toggle OFF.
- Row 3: "Add to marketing campaign" dropdown "Select a campaign".
- Pattern: every setting = bold label, one-line gray explanation, control at the right (toggle) or below (field). Maps to campaign scheduling settings (send window, business days only).

### 5.3 Add automated email side panel [2025 KB] (`seq-add-email.png`)
Described in section 4. Primary action: pick a template row. Hierarchy: one clear heading, one create button, filter dropdown, search, scannable list with title + attribution.

### 5.4 Workflow canvas start [2025 KB] (`wf-add-action.png`)
- Light-gray canvas. A white card "Trigger enrollment for contacts" (flag icon, bold) with "When this happens" and an inner bordered "Group 1" holding a dropdown-style field "Manually triggered only". Card footer: clipboard icon at left, "Re-enroll off" (cycle icon) and a maroon "Details" link, split by a vertical divider.
- A vertical line goes down to a circular **"+" button** (about 28px, white with gray border) then to an "End" card (flag icon, smaller, centered). Coach arrow is a doc annotation, not part of the UI.
- Pattern: a linear flow where "+" nodes between cards insert actions; trigger at the top, End always at the bottom. Other workflow features listed in the article's image names (not viewed closely): minimap toggle, minimap error state, settings, "turn on workflow" panel, undo/redo, "create with AI".
- Maps to: rightnow-ai automations editor.

### 5.5 Contacts index [older demo] (`table1.png`)
Described in section 4. Primary action: orange "Create contact". Secondary: "Import", "Actions v". Hierarchy: title/count > view tabs > filters > table. Total 2 rows, so most of the page is blank white (no empty-fill illustration).

### 5.6 Contact record [older demo] (`profile.png`)
- Three columns: **left (~230px)** identity card (big orange avatar, name with pencil edit icon, job title "Salesperson at HubSpot, Inc.", six circular quick actions Note / Email / Call / Log / Task / Meet, then collapsible "About this contact" with stacked label/value fields: First name, Last name, Email, Phone number, Contact owner, Last contacted, Lifecycle stage, Lead status). **Center** tabs (Activity, Notes, Emails, Calls, Tasks, Meetings) with a "Create Note" button right and the timeline below. **Right (~230px)** collapsible association cards: Company (1), Deals (0) with "+ Add", Tickets (0), with a double-chevron collapse control at the top. A docked Note composer overlaps the bottom-right.
- Primary action: the quick-action icons. Hierarchy: identity > actions > properties on the left, history in the middle, related records on the right.

### 5.7 Sales dashboard [older demo] (`dashboard.png`)
- Title "Sales Dashboard v" (dashboard switcher), buttons "Create dashboard", "Actions v", orange "Add report". Gray-blue background, 2x2 grid of report cards. A product tour tooltip ("1 of 12 ...") highlights the first card with a teal outline.
- Primary action: "Add report". Hierarchy: each card has a title, a date-range line, then the visualization.

### 5.8 Inbox empty state [older demo] (`onboarding.png`)
Left rail "Inbox" with "All conversations 0" and "Inbox Settings", main area onboarding "Say hello." with four channel cards. No message list or reading pane was seen. Not observed: the populated inbox, the deals board, the analytics detail pages.

## 6. Interaction patterns

- **Onboarding/setup:** a guided tour with step count ("1 of 12"), a dark tooltip with a single "Next: <topic>" button, and a teal-outlined spotlight on the target; plus a bottom progress strip of four phases with "Exit demo". Empty inbox is a "connect your first channel" choice grid.
- **Inline editing:** pencil icon next to the contact name; property values are shown as plain text and edited in place (implied by the pencil and label/value layout).
- **Popover editing:** clicking the "Delay: 1 business day" label opens a small popover with Save/Cancel instead of a modal.
- **Progressive disclosure:** "See more" on email previews; collapsible sections in the record sidebars (chevrons beside "About this contact", "Company (1)", etc.); "More filters" behind the quick filters; "Table actions v" and "Actions v" menus.
- **Docked composer:** note editor collapses (chevron), expands (arrows), closes (X); the Save button stays disabled until text exists; inline "Create a task to follow up" checkbox links the note to a task.
- **Hover/keyboard shortcuts:** not observed.
- **Real-time status feedback:** the workflow article names a "turn on workflow" panel and minimap errors; not seen in detail. Sequence send window note shows HubSpot picks send times by open rate within the window (a "smart" behavior surfaced as a one-line note with a bolt icon).

## 7. Responsive / mobile

Not observed. All captures are desktop widths (about 1920 wide). The KB page uses a centered narrow column. Inferred only from the layouts: the table scrolls horizontally with a clipped last column.

## 8. Ideas worth borrowing for rightnow-ai

- **Views as tabs above the table** ("All leads | Replied | Bounced | + Add view | All views") with a pin glyph on pinned ones, and a "Save view" button on the right of the filter bar. Cheap saved filters for leads and inbox.
- **Filter bar recipe:** search box, three quick dropdown filters, a "More filters" link, "Table actions" and "Save view" at the right.
- **Sequence steps as stacked cards joined by arrows, with the delay as a clickable band between them** ("Delay: 1 business day") that edits in a small popover. Show the unit in words ("business days").
- **Sequence Settings tab as stacked settings cards:** bold label, one-line gray explanation, toggle or field at the right. Include "Execute steps on business days only" and a "Send window 8:00 AM -> 6:00 PM" time-range pair with time zone note; this maps directly to rightnow-ai's quotas and send windows.
- **Right-side drawer for choosing a template** (title row with X, create button, filter dropdown, search pill, bordered rows with "Updated N ago by <name>").
- **Three-column record page for a lead:** identity + quick actions on the left, tabbed activity timeline in the center, related records on the right.
- **Circular quick-action buttons with labels underneath** for Note / Email / Task / Log.
- **Docked, collapsible composer** that keeps the page visible behind it, with a disabled Save until valid and a "create follow-up task" checkbox.
- **Workflow editor as a vertical flow with "+" nodes** between cards and a fixed "End" node; trigger card footer shows "Re-enroll off" status and a "Details" link. Good model for the automations builder.
- **Empty states that offer 3-4 choices as illustrated cards with a short checklist of what you get**, instead of a lone "no data" message.
- **Dashboard cards:** title + info dot, a muted "Date Range | Frequency" line, then the chart; one quota marker line on a forecast bar (maps to daily sending quota vs actual).
- **Tour tooltip with "n of N" and a single labeled Next button** for first-run coaching.
- **Split ON/OFF toggle with explicit text** (accessible; does not rely on color alone).

## 9. Why it works

HubSpot reads as friendly and clear because it uses very few visual ideas and repeats them: one dark top bar for navigation, one accent color for the single primary action on each page (orange in the older UI, black in the newer one), and links in a second color so you can tell what is clickable at a glance. Pages are organized the same way every time (title and count, view tabs, filters, table; or identity, timeline, related records), so after seeing one screen you can predict the next. Each setting or step is a card with a bold label and a plain-language sentence under it, and complex flows (sequences, workflows) are reduced to a single vertical line of cards with a visible delay or "+" between them, which makes the logic of "what happens, then what" readable without a manual. White surfaces with thin borders on a quiet gray background, generous padding, and a rounded sans-serif keep the density comfortable. Empty states and a guided tour explain what the product is for ("Connect your first channel", "Deals track all your revenue opportunities"), so a new user always knows the next action.
