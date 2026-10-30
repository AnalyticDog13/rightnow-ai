# Loops (loops.so) - UI design reference

Scope note: the live app (app.loops.so) requires login and was not accessed. Everything below comes from Loops' own in-app screenshots embedded in the public docs and from the marketing site, which renders the workflow editor as a live HTML mock. Values marked "(est.)" are eyeballed from images. Screens not seen (audience table, campaign list, sending-domain settings, campaign metrics page) are NOT described; `/docs/campaigns/metrics` returned 404.

## 1. Sources

URLs viewed:
- https://loops.so (marketing home, incl. in-page HTML workflow editor mock) - `home.png`
- https://loops.so/docs/workflows (text + 12 images)
- https://loops.so/docs/creating-emails/editor (text + image list)
- https://loops.so/docs/contacts/filters-segments (text + image list)

Screenshots (folder `C:\Users\willi\AppData\Local\Temp\claude\C--Users-willi-OneDrive-Desktop-GitHub-Repositories-rightnow-ai\f8a7d979-9487-46fe-b300-dcca3fab7b2a\scratchpad\screenshots\loops\`):
`home.png`, `building-loop.png` (workflow editor, Build tab), `metrics.png` (workflow Metrics tab), `loop-email.png` (workflow with Send email node), `audience-filters.png` (Audience filter node inspector), `editor-text.png` (email editor), `filter-form.png` (filter row + property dropdown), `segments.png` (breadcrumb + segment dropdown + count + table header).

Not opened as images but listed: triggers.png, timer.png, view-full-metrics.png, slash-menu.png, brace-menu.png, save-segments.png, writing-mode.png.

## 2. Information architecture & navigation

Seen only inside the workflow editor (a full-screen, 3-pane tool) and one contacts view. The global app shell (main sidebar item list) was not visible in any screenshot.

- Left navigation panel (about 27% of editor width (est.)): top row = Loops logo mark with a chevron dropdown (workspace/account switcher), a search icon (command search), and a panel-collapse icon. Under it a workflow-name dropdown ("Onboarding workflow v") to jump between workflows. Below, two vertical tabs: "Build" and "Metrics" (active one has a light grey filled rounded row).
- Center: canvas with a dot grid.
- Right inspector panel (about 25% width (est.)): top bar with panel toggle icon, a status word ("Draft", green text in the email editor), "Exit" (text button) and "Start" (solid near-black button). Below: contextual settings for the selected node. With nothing selected it shows "Overview" (last-edited date, Sends / Opens / Clicks mini stats), "Mailing list" dropdown, and "Guardian" with "Docs" link and a "Checks passed [2]" row (validation checklist).
- Both side panels collapse; Cmd/Ctrl + / toggles both. Canvas: pinch/ctrl+scroll zoom, a "Zoom" button resets to 100%.
- Breadcrumb used in node-detail screens: "New users v / Audience filter" (workflow dropdown, slash, node name).
- Docs sidebar sections (product areas implied): Get started, Editing emails, Workflows (Guide, Triggering, Pausing, Branching, Experiments), Events, Goals, Contacts, Transactional email, Integrations, SMTP, Account; plus Campaigns, Themes, Components, Audience segments, Contact properties in the CLI list.
- Marketing site: top nav "Product, Guides, Customers, Pricing, Docs", ghost-outline "Log in" pill, dark "Start for free" pill; the hero embeds the editor in a mock browser window with breadcrumb "Onboarding / Workflow".

## 3. Visual language

Marketing site (measured with evaluate_script):
- Page background rgb(249,249,248) = #F9F9F8 warm off-white. Text #21201C (warm near-black).
- H1 "One platform for every email": Newsreader (serif), 44px, weight 500. Wordmark "Loops" also serif. Body/UI font: Inter (docs body stack `Inter, -apple-system, ...`).
- Accent: a vertical stripe at the right edge of the viewport in yellow-orange-red-maroon bands (approx #FFB21A, #FF8A1F, #FF4D00, #7A1A10 (est.)); logo mark orange ring (#F5560A (est.)). Used only as brand decoration; the app itself is neutral.

In-app (from screenshots, light mode only seen; no dark mode seen):
- Surfaces: white (#FFFFFF / ~#FDFDFC) panels on an off-white canvas with a faint dot grid (dots ~#E5E5E5, ~16px pitch (est.)). Panel dividers are 1px very light grey (#EDEDED (est.)).
- Primary button: near-black fill (#14161F-ish (est.)), white 14px medium text, radius about 6px, height about 32px (est.). Nodes use radius about 8px, hairline border plus a very soft shadow.
- Text: titles #1F2328-ish (est.) at 15-16px weight 500; secondary text grey (#9CA3AF (est.)) at 12-13px ("Subject not set", "Wait 5 days").
- Selected state = 1px darker (near-black) border on the node plus slightly larger shadow; selected tab row = light grey fill (#F3F3F2 (est.)).
- Status: "Draft" in plain text (green in editor); "Checks passed" count in a small light-green circle badge with green number.
- Iconography: thin 1.5px line icons, monochrome grey; node icons are filled-glyph style (lightning bolt for trigger, funnel for audience filter, clock for timer, paper plane for send email, filled square for Exit Workflow). Trash icon top right of inspector.
- Imagery: every docs screenshot is the UI floated on a photographic backdrop of clouds with teal/amber light; the marketing site uses clean flat UI and logo wall.
- Density: airy. Node cards are about 215x85px at 1100px-wide image scale; vertical gap between nodes about 60px with a thin arrow connector. Inspector rows are ~36-44px high with generous 20px side padding.

## 4. Components

- Workflow node card: icon + bold title (e.g. "Send email") + one-line grey summary underneath (state-at-a-glance: "Subject not set", "Wait 5 days", "All contacts", "2 filters"). Single column, centered, connected by thin arrows. Hovering an arrow reveals a circular "+" button (seen as an outlined circle between Audience filter and Send email) to insert a node. Terminal node "Exit Workflow" with filled-square icon, always present.
- Metrics overlay on a node: in the Metrics tab, under each Send email node a 3-cell strip "Sends 103 | Opens 83% | Clicks 6%" (label 12px grey above, value ~28px semibold), with a "View metrics" text link below. Same three stats appear as a compact "Overview" row in the inspector (Sends 0 / Opens 0 / Clicks 0, small cells with light grey fill).
- Inspector sections: title (16-18px medium) + one-sentence description in grey + primary action button ("Edit email", "Edit Audience"). Then labelled subsections ("Email preview" with a send-test paper-plane icon, "Filter scope").
- Segmented control: "Filter scope: [All following nodes | Next node only]", two cells, selected cell white with border on a grey track, with a one-line explanatory sentence beneath that changes with selection.
- Dropdown/select: bordered input, ~40px high, chevron right, leading icon (list icon in "Mailing list"). Popover menus: white, radius ~8px, soft shadow, 15px items with ~47px row pitch in the larger zoomed version; check mark right of selected item (e.g. "All Contacts v" vs "Waitlist"; property list First Name, Last Name, Email, Source, User Group, User ID, Subscribed, Created At...).
- Filter builder row: [property combobox with clear x] [operator select "Contains"/"Equals"] [value input "Type to start filtering"] [trash icon]; below, "+ Add filter" text button; match-mode choice "All of these are true" / "Any of these are true". Live summary line: "**121 subscribed contacts** currently in audience (i)".
- Table (contacts preview under the filter): column headers Email (with a book/bookmark icon), First Name, Last Name, Source; headers about 16px, hairline column separators, large row height (est. 48-56px). "Browse" toggle with layers icon and "..." overflow menu in the card header.
- Email editor right panel: tabs "Styled / Plain / Code" and language "EN" globe; "Theme" with dropdown "Default theme", "..." and "Edit"; "Block styles" with copy/delete icons, alignment 3-way icon toggle, numeric Border / X Padding / Y Padding inputs with tiny leading glyphs, Background color "+ Color"; "Text" with style dropdown "Heading 3 v" whose "Turn into" menu lists Paragraph, Heading 1/2/3, Numbered List, Bullet List, Quote, Code Block (each with a glyph; check on current).
- Editor canvas: borderless, "Sender / Sender Name" and "Subject line" as ghost placeholder inputs on top, an icon toolbar (image, {} variables, button, divider, globe/social, columns, section, undo, redo) and a "Writing mode" toggle at right. Typing "/" opens slash menu; "{" opens variable menu (docs).
- Badges: "Draft" status text; green count circle. Toasts, modals, empty states, and charts: not observed (only text/number stats, no chart seen).
- Buttons: primary dark pill-rect (Start, Next, Edit email); text button (Exit); icon-only buttons (search, panel toggle, send test). Marketing site: dark pill "Start for free", white outlined pill "Book a demo".

## 5. Key screens

### 5.1 Workflow editor, Build tab (`building-loop.png`, maps to rightnow-ai sequence/automation builder)
Three-pane. Center vertical flow: Event received ("No event specified") -> Audience filter ("All contacts") -> Timer ("Wait 5 days") -> Send email ("Subject not set") -> Exit Workflow. Right inspector (nothing selected) = Overview + Mailing list + Guardian validation. Primary action: "Start" (top right of inspector). Hierarchy: the flow reads top to bottom as a sentence; empty/unset fields are shown honestly as grey placeholder summaries rather than hidden.

### 5.2 Workflow editor, Metrics tab (`metrics.png`, `loop-email.png`)
Same canvas, but left tab "Metrics" is active; each email node is followed by its Sends/Opens/Clicks strip and "View metrics". Analytics are inline on the flow itself, not on a separate dashboard; drill-in via link.

### 5.3 Send email node inspector (`loop-email.png`)
Selected node gets a dark border. Inspector: "Send email - Contacts will receive this email when they reach this step", "Edit email" button, then "Email preview" rendered live (centered text, black pill button "Finish account setup"). Merge tags appear as `{firstName}` and bold `[PRODUCT_NAME]` placeholders.

### 5.4 Audience filter node (`audience-filters.png`)
Inspector: title, sentence "Only subscribed contacts meeting these filter conditions will proceed.", "Edit Audience" button, current summary ("Sending to all contacts"), then "Filter scope" segmented control (All following nodes / Next node only).

### 5.5 Segment/filter editor (`filter-form.png`, `segments.png`)
Full-page card titled "All Contacts v" (dropdown picks saved segments, e.g. "Waitlist"), filter rows, "+ Add filter", live audience count, and a contacts table preview underneath. Breadcrumb "New users v / Audience filter" shows we are inside a workflow node.

### 5.6 Email editor (`editor-text.png`)
Two-pane: left is a clean document-like canvas (very wide margins, sender + subject on top, toolbar of block icons), right is a style inspector that changes with the selected block. Header right: "Draft" (green), send-test paper plane, dark "Next" button. "Writing mode" hides the chrome (Cmd/Ctrl + /). Auto-saves; no Save button.

### 5.7 Marketing home (`home.png`)
Serif H1 left-aligned, grey 24px lede with underlined key terms, two buttons, logo strip (Framer, Linear, Perplexity, Sanity, Granola, Sketch, Modal, Clerk, Reuters, Zed, Ollama), then a live HTML editor mock inside a mock browser chrome with traffic-light dots and breadcrumb. Node variants seen: "Contact added", "Audience filter - 2 filters", Branch inspector ("Routes a contact to a branch from left to right. If no branches match, the contact exits the workflow.").

## 6. Interaction patterns

- Add step: hover the arrow between nodes, click "+" (docs). Branching = additional node type; trigger types include contact property updated, contact created, external event.
- Select node -> inspector re-targets; click empty canvas -> inspector returns to workflow summary with validation ("Guardian" checks that must pass before Start). Start/Pause toggle lives in the inspector header. Exit button leaves the editor.
- Command search icon in left panel; Cmd/Ctrl+K searches docs. Cmd/Ctrl + / toggles panels (workflow) or Writing mode (email). Editor: "/" slash menu, "{" variable menu, Markdown shortcuts, hover-"+" to add blocks, drag to reorder, auto-save.
- Segmented controls come with a live explanatory sentence (progressive disclosure of consequences).
- Filters update live: audience count text shows currently matching subscribed contacts; filters are re-evaluated at send time.
- Honest empty state: nodes display "Subject not set", "No event specified" instead of hiding incompleteness; validation panel counts passed checks.
- Hover/focus: nodes lift with shadow; selected = dark outline. Real-time status was only seen as the Draft label and metrics numbers.

## 7. Responsive / mobile behavior

Not observed in the app (no login; I did not resize). Docs claim the email editor is "mobile-friendly so you can write and design emails on any device", and that panels can collapse. Marketing site at ~1280px: nav collapses nothing, content left-aligned in a single column.

## 8. Ideas worth borrowing for rightnow-ai

- Sequence builder as a vertical node flow with one-line grey summaries per node ("Wait 3 days", "Subject not set"), connectors with a hover "+" insert point, and a permanent terminal "Exit" node. Fits multi-step sequences and automations.
- Persistent 3-pane builder: left = navigator (campaign switcher dropdown + Build / Metrics tabs), center = canvas, right = inspector. Collapse both panels with one shortcut.
- "Build | Metrics" toggle that overlays Sends / Opens / Clicks (add Replies, Bounces) under each step, reusing the same canvas, instead of a separate analytics page.
- Right-inspector pre-flight checklist ("Guardian: Checks passed 2") that blocks Start until sender, subject, schedule, mailbox, unsubscribe are valid; maps to rightnow-ai's freshness and quota gates.
- Filter-row pattern [property][operator][value][trash] + "+ Add filter" + "All / Any" + live "N contacts currently in audience" count; also reuse as saved Views for leads and as automation conditions. Include activity filters (sent / not sent / opened / clicked / replied).
- Segmented "Filter scope" control with a sentence that explains the effect; use for "applies to: this step / all following steps".
- Email editor: ghost Sender/Subject fields, block toolbar, "/" and "{" menus for variables, Writing mode, auto-save, Styled/Plain/Code tabs (plain text matters for cold email), send-test icon, status "Draft" text.
- Single dark primary button per screen (Start / Next / Edit email); everything else is text or outline.
- Quiet neutral palette with warm off-white (#F9F9F8) page, white panels, hairline borders, tiny shadows; brand color reserved for logo/marketing.
- Serif display headline + Inter UI text for marketing/landing pages.

## 9. Why it works

Loops looks good because it removes almost everything that is not the task. The workflow editor is three quiet panes: a navigator, a single centered column of identical rounded cards, and an inspector that only shows what the selected card needs. A warm off-white background, white surfaces, hairline borders, one near-black button per screen, and thin grey icons give strong hierarchy through weight and spacing instead of color or decoration. Each node states its own status in plain words under its title ("Wait 5 days", "Subject not set"), so a viewer can read the whole automation top to bottom like a sentence and see what is unfinished without opening anything. Settings never sprawl: choosing a node reveals a short sentence explaining what it does, one primary action, and a few labelled controls, and controls like the filter scope toggle explain their consequence inline. Metrics reuse the same canvas, so the user learns one picture and sees performance attached to the exact step that produced it. The marketing site tells the same story in one serif sentence ("One platform for every email") followed by the real editor, so the product's purpose is obvious before any explanation.
