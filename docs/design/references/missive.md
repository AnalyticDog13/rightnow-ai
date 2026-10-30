# Missive UI reference

Missive is a shared team inbox (email, SMS, chat) with labels, tasks, rules and a command bar. It has no cold-email sequences, leads table or CRM kanban, so the useful parts for rightnow-ai are the inbox shell, the conversation view, rules, and the density and polish.

Values marked "(est.)" were read off images, not measured. The in-app screens are marketing or docs screenshots, not a live logged-in app.

## 1. Sources

Viewed:
- https://missiveapp.com/ (hero and product carousel; mobile 390 wide)
- https://missiveapp.com/docs/advanced-features/rules/ (text plus 2 images)
- https://missiveapp.com/docs/get-started/missive-interface (annotated overview image and full text)
- https://missiveapp.com/docs/advanced-features/command-bar (text only)

Not viewed:
- Docs URLs I guessed (`/docs/get-started/the-interface`, `/docs/getting-started/the-interface`) returned 404. The real path is `/docs/get-started/missive-interface`.
- Missive's own mobile app screens were not shown on any page I opened.
- Labels, compose, analytics and the rules editor UI itself were not viewed. Only a rules result screenshot was.

Screenshots, in `C:\Users\willi\AppData\Local\Temp\claude\C--Users-willi-OneDrive-Desktop-GitHub-Repositories-rightnow-ai\f8a7d979-9487-46fe-b300-dcca3fab7b2a\scratchpad\screenshots\missive\`:
- `home.png`: hero with the marketing site's own styling
- `home-app.png`: the product screenshot carousel, lower half. It shows the sidebar with team spaces and labels, a conversation list with a label chip, a message with an attachment card, the internal chat, an inline task and an undo toast.
- `home-app2.png`: the product screenshot, upper half. It shows the sidebar, a list with unread rows, and an empty "Team Inbox" state.
- `rule-editor.png`: conversation header and the "Rule applied" event.
- `interface-overview.png`: the 4-column anatomy diagram, with a selected row, a snoozed row and a read row.
- `home-mobile.png`: marketing page at 390x844.

## 2. Information architecture and navigation

The app is four columns, named in the docs: sidebar, conversation list, conversation view, and a right icon sidebar.

Proportions in the 1920px screenshot (est.):
- Sidebar: about 17% of width.
- Conversation list: about 25%, with a full-width Search field on top and a filter icon.
- Conversation view: about 50%.
- Right icon rail: about 4%.

The window has macOS traffic lights at top-left of the sidebar, an avatar with a green presence dot, and a "+" compose button with a dropdown.

### Left sidebar
Order is fixed and personal first:
- A bell icon opens the Activity feed (mentions, reactions, calendar reminders), with an unread dot.
- **Inbox**: the personal workspace, with a count pair such as `2 | 4` (blue chip for unread, grey for total).
- Tasks (a count such as 12).
- Calendars.
- Snoozed.
- Drafts.
- Sent.
- All: the full history across every account.
- "+ Pin to sidebar" in muted text. Users can pin Snoozed, Drafts, labels, saved searches or a single conversation. Custom sections can be added, sorted by drag, or sorted by name or unread count via right-click.
- **Team spaces** group header with `...` and `+` on hover. Each team has an emoji-style rounded-square icon, a colour, and a disclosure triangle. Expanding a team reveals Inbox, Tasks and Room (team chat) as children.
- **Labels** group below, each with a coloured tag icon.
- The user's own row (avatar and name) is pinned at the bottom. The rules page says Rules is reached from the avatar menu.

The sidebar can be Fixed or Floating (collapses to the left edge and slides open on hover). Toggle: Cmd/Ctrl+S.

### Top of each column
- No breadcrumbs. Location is shown by the highlighted sidebar row, a rounded pill with a slightly darker grey fill.
- Search is a field at the top of the list column. It searches within the selected mailbox. A filter icon sits to its right.
- Conversation header: stacked participant avatars with a count ("2") and a chevron (share and access menu), then **Assign to me** as a split button, then icons for reply, snooze (clock), archive, trash and "...".

### Command bar
`Cmd/Ctrl+K` or `Cmd/Ctrl+E` opens a popup with one input. Typing "sno" suggests either the Snooze action or opening the Snoozed mailbox. The docs say it consolidates every action behind one shortcut.

### Right rail
Vertical icon stack: Details/contact (person), Tasks (check), Calendar, AI assistant (OpenAI-style knot icon), "..." for integrations, and a help "?" at the bottom. Its mode is Auto, Fixed or Floating.

### Marketing site nav
- Logo.
- Product (dropdown).
- Pricing.
- Customers.
- Resources (dropdown).
- On the right: Log in, Book a demo, and a filled blue **Try for free** button.
- On mobile it collapses to Log in, Sign up, and a hamburger.

## 3. Visual language

### Colour
The app screenshots show a light theme only. Dark mode was not shown.

| Role | Value |
|---|---|
| Marketing primary blue | `#2266ED` (measured, `rgb(34,102,237)`) |
| Marketing text | `#333333` (measured) |
| Marketing page background | `#FFFFFF` (measured) |
| Selected list row | saturated blue, about `#1F66E5` (est.), white text |
| Unread row | pale blue, about `#E6F0FD` (est.), with a blue dot |
| Read row | white |
| Snoozed-due row | pale orange, about `#FDF3E4` (est.), with an orange clock time and dot |
| Sidebar | very light grey, about `#F4F5F6` (est.) |
| List column | white |
| Conversation canvas | light grey, about `#F3F4F5` (est.), with white cards on it |
| Internal chat bubbles | light blue-grey, about `#E4EBF6` (est.), grey for own messages |
| Team/source stripe | 3px coloured left edge on list rows (red, orange or yellow by team) |
| Label chips | pale tint fill with a saturated text and icon (e.g. "CES 2025" pale blue with blue text, "Disney" with a blue outline) |
| Unread counters | blue-tinted chip with blue number next to a grey chip |

Colour is semantic: it marks source (stripe), state (row background) and category (label chips). Everything else is neutral grey and white.

### Typography
- Product UI (from screenshots): a neutral grotesque, most likely Inter or system sans (est.), with about 13-14px list text.
- The list row has three lines: sender in semibold, subject in regular dark, preview in muted grey.
- Time stamps are right-aligned, small and grey.
- Docs site: Inter, 14px body (measured).
- Marketing h1: "Tiempos Headline" serif, 56px, weight 400, `#333`. It is a deliberate contrast against the sans UI.
- Marketing body: Arial/sans fallback, with the subhead in grey.

### Spacing and density
- List row height is about 58px (est., at 1x) with a 3-line layout. Date group headers ("Today", "Yesterday") are about 24px grey bands.
- Sidebar rows are about 26px tall (est.).
- Compact but airy: the density comes from small type, not from tight padding.

### Radii, borders, shadows
- Sidebar rows and selected list rows use roughly 6-8px radii. Message cards and chat bubbles use 12-16px. Chips are fully pill-shaped or 6px.
- Marketing buttons have an 8px radius (measured).
- Columns are separated by hairline 1px grey borders or by a change of background.
- Shadows are only on floating things: the message action cluster under a message (a small raised pill group with reply, reply all, forward and "..."), the toast, and the device frame.
- The inline attachment card has a hairline border and a small shadow.

### Iconography and illustration
- Thin outline icons, 16-18px (est.), monochrome grey, rounded line caps. Active items use a filled blue variant (Drafts pencil, team inbox tray).
- Team icons are emoji-like rounded squares with soft tinted backgrounds.
- Avatars are circles. Company logos appear as a small rounded square (Disney) or as a favicon-sized glyph at the start of a list row. Channel badges (Instagram, WhatsApp) overlay the avatar corner.
- The only illustration in the app is the large grey tray glyph with "Team Inbox" as the empty state.

## 4. Components

### Conversation list (the app's table)
- Row anatomy: sender avatar or logo, participants or subject in semibold, time at right, subject line, preview line. Indicators are inline at the right of the subject: task progress `0/3` with a circle-check, message count, attachment, labels as chips, assignee avatar.
- Unread: blue dot at left of the subject line, pale blue row.
- Selected: solid blue row, with all text white and the labels staying tinted.
- The left stripe shows team/source.
- Group headers by date.
- Filtering is via the filter icon next to Search. Saved searches can be pinned to the sidebar.
- Bulk actions were not shown.

### Buttons
- Marketing primary: filled `#2266ED`, white 600-weight text, 8px radius. Secondary: very light grey fill with hairline border and dark text ("Watch demo").
- In-app:
  - A split button ("Assign to me" with a chevron half) with a white fill, hairline border and a small shadow.
  - Icon-only ghost buttons in the header.
  - A "+" compose button in a white rounded square with a dropdown caret.
  - Inline message actions as grouped icon buttons in a raised pill.

### Chips, badges and pills
- Label chip: icon plus name, pale fill, matching text colour. Appears in the list row, in the conversation header and inside the "Rule applied" event.
- Count chips on the sidebar: a blue-tinted one for unread plus a grey one for total.
- Date chip and assignee chip inside the task card ("Feb 23", avatar, "Sales").

### Cards
- Each email is a white rounded card on the grey canvas, with a logo or avatar, bold name with muted domain in parentheses, address, and timestamp aligned right. A hairline separates the header from the body.
- Under the card, a floating group of action buttons.

### Forms and inputs
- Search: a grey filled field with a magnifier icon, no border.
- Chat composer at the bottom: one rounded white box, placeholder "Chat with your team...", with emoji, "mark as task" check and "+" attach icons at its right. Enter sends, Shift+Enter makes a new line.

### Tabs, drawers, modals
- No tabs observed. The right icon rail works as a tab switcher for a context drawer (Details, Tasks, Calendar, AI, integrations). The drawer can be floating.
- The command bar is the only modal observed.

### Toasts
- Dark charcoal toast pinned to the bottom of the list column: "Conversation archived", with **Undo** and an x.

### Empty states
- A large muted tray icon with the mailbox name ("Team Inbox") centred in the conversation pane.

### Inline timeline events
- Centred small grey text between messages ("Rule applied" with the label chip, assignments, label changes, snooze, merges). Can be hidden in preferences.

### Tasks
- A task is an inline card in the thread: checkbox, text with a bolded keyword, a description icon, date chip and team chip.

### Charts and editors
- Not observed. The docs index lists Analytics but I did not open it.

## 5. Key screens

### Inbox, 4-column app shell (`home-app2.png`, `interface-overview.png`)
- Layout: sidebar, list, conversation, rail, as described above.
- Primary action: Assign, with Reply next to it. Primary hierarchy is "my Inbox, then team Inboxes, then labels".
- Distinct idea: personal Inbox is separate from Team Inbox. A conversation stays in the team inbox until someone claims it. Assigned conversations move to the assignee's Inbox and the team's Tasks. The docs separate **Close** (work done, shows in Tasks) from **Archive** (removes from the inbox view).

### Conversation view (`home-app.png`, `rule-editor.png`)
- Header: avatars of people with access (blue glowing ring means viewing now, grey means archived), the Assign split button, then reply, snooze, archive, trash, more.
- Title is large (about 24px est.) with label chips, a tag button, a star and an eye (watch) icon at the right.
- Below: email cards in white, internal chat in blue-grey bubbles with small avatars, so external and internal talk are visually distinct in one thread.
- Inline task card.
- Bottom: "Chat with your team..." composer.
- Hierarchy: subject, then who, then the message, then team-only layer.

### Rules (docs page text and `rule-editor.png`)
- A rule has Rule type (incoming email, outgoing message, user action), Conditions, Actions, and optional Steps (do something later after a wait).
- Example table: Rule type "Incoming email", Condition "From ends with disney.com", Action "Add label(s) -> Disney".
- Scope: Personal rules versus Organization rules, chosen with a "You" / org selector at the top of the Rules settings list. Only admins and owners manage org rules.
- The list shows a toggle at the right of every row. Disabled rules show in light grey. Each row has a "..." menu with Duplicate and a destination choice (Personal or an organization).
- Order is alphabetical by description, so users prefix "01.", "02.". This is a weak point and not worth copying.
- Result is shown in the thread as "Rule applied [Disney chip]".
- Workload balancing (round-robin, least-busy) and AI rules exist per the nav.

### Marketing home (`home.png`)
- Centred 56px serif headline "Inbox collaboration for teams that run on email", grey subhead, two buttons (blue primary, light-grey secondary), then a large dark laptop frame containing an auto-playing carousel of the real UI. A progress bar under the frame (blue segment on grey track) shows the slide. "6500+ companies rely on Missive every day" follows.

### Not seen
Leads table, kanban/pipeline, campaign or sequence builder, analytics, and mailbox/warm-up settings do not exist in what I viewed.

## 6. Interaction patterns

- Single-key commands plus a command bar: Cmd/Ctrl+K or +E, Cmd/Ctrl+S toggles the sidebar. The docs have a full Shortcuts page, which I did not open.
- Undo toast after archive instead of a confirm dialog.
- Real-time presence: a blue glow ring around an avatar means that person is viewing the conversation now.
- Unread is shown three ways: row tint, left dot, bold sender. The internal chat has a separate unread dot.
- Drag-and-drop reordering of sidebar sections. Right-click to sort. Hover reveals `...` and `+` on group headers.
- Pin to sidebar: any mailbox, label, search or conversation can become a nav item.
- Progressive disclosure: sidebar and right rail can be Floating, collapsed until hover. Events can be hidden. Rail icons open panels on demand.
- Settings path: Settings > Preferences > Appearance for list order, sidebar mode and event visibility.
- No onboarding checklist was observed.

## 7. Responsive and mobile

- Marketing site at 390x844: the nav collapses to Log in, Sign up and a hamburger. The h1 wraps over 3 lines at about 30px. The two CTAs stay on one row. The device frame scales down with the whole 4-column UI still shown, tiny and unreadable.
- The marketing mobile screenshot and the docs say mobile apps exist ("Mac, Windows, and mobile apps" for the sidebar shortcut). No mobile app screens were observed, so I cannot describe their layout.

## 8. Ideas worth borrowing for rightnow-ai

- Use the 4-column shell for the unified inbox: sidebar (views), thread list, thread, context rail. A right icon rail that opens Lead details, Campaign, Notes, Tasks fits well, with Auto/Floating collapse.
- Row colour semantics. Pale blue for unread, solid blue for selected, pale orange for snoozed or follow-up due, and a 3px left stripe for the sending mailbox or campaign colour.
- A single count pair on sidebar items (unread chip plus total) and group headers with hover-only `+` and `...`.
- "Pin to sidebar" for saved views (leads filters, a campaign, a mailbox) so the nav is user-built.
- Distinguish internal notes from external email in one thread: white cards for email, tinted bubbles for team notes, centred small grey text for events (stage changed, enrolled in sequence, lead replied).
- Inline task and date chips in the thread.
- Split button "Assign to me v" as the primary header action, and Close vs Archive as separate meanings (maps to "Mark won/lost" vs "Archive").
- A command bar on Cmd/Ctrl+K that is both actions and navigation.
- Undo toast on archive, mark as interested, and unsubscribe.
- Rules/automations: a 3-part card (trigger, conditions, actions) plus optional "later" steps, a toggle on each row with greyed disabled state, Duplicate to another scope. Improve on it with an explicit drag handle for order, not alphabetical naming.
- Show the effect of automation in the thread ("Rule applied [chip]"), so users trust it.
- Label chips as tinted pill with icon, usable for lead status and campaign tags.
- Serif display headline against a sans UI for the marketing page only.

## 9. Why it works

Missive looks good because it is restrained. The UI is almost entirely white and pale grey with one blue, and colour appears only where it carries meaning: unread, selected, snoozed, the team stripe and label chips. Everything else is thin grey line icons, small type, hairline borders and soft rounded cards, so the content (names, subjects, messages) is the loudest thing on screen. The four columns map to a familiar email mental model (folders, list, message, tools), so anyone who has used Gmail can read the layout at a glance, and the one new idea, a private team chat layered in the same thread in blue-grey bubbles, is made visible with just a different background and avatar. The marketing page reinforces this: a plain statement of what it is ("inbox collaboration for teams that run on email"), two buttons, and a large real screenshot rather than abstract art. Users can follow what the software is for because every screen reads as "who is on this, who owns it, what happens next", through avatars, an Assign button, task chips and inline event lines.
