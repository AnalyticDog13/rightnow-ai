# rightnow-ai design spec

Status: draft for review, input for the UI redesign (branch `ui-redesign`). The builder implements from this file
alone.
Inputs: the 15 reference specs in `docs/design/references/*.md` (shortlist: `docs/design/SHORTLIST.md`),
`docs/PRODUCT_SPEC.md` (PS-UI-01..08 and the feature sections), and the current UI in `apps/web`.

How to read it: Part A is the synthesis (what makes a good UI, and what made a good reference spec). Part B is the
rightnow-ai spec: principles, tokens, shell, components, every screen, accessibility, implementation order and the
acceptance checklist. Every borrowed pattern carries "(from: X)", where X is the reference file name. Values in
Part B are decisions, not estimates.

---

# Part A. What makes a good UI (and a good design spec)

## A1. Patterns that recur in the clearest UIs

The products whose specs end with the most convincing "why it works" (Attio, Close, lemlist, Twenty, Apollo,
Loops, Missive) share the same handful of decisions. None of them is about decoration.

1. **Neutral chrome, color only for meaning.** White or warm off-white surfaces, one gray ramp, hairline borders;
   saturated color appears only in status pills, stage dots, deltas and the one primary action (attio, lemlist,
   close, twenty, missive, apollo, folk). Apollo states it best: the contrast budget is spent in exactly two places,
   "what do I do next" and "what state is this in" (apollo §9).
2. **One primary action per screen, in a reserved style.** Apollo's yellow, folk's and Loops' near-black, Instantly's
   blue: whatever the color, only one element per screen wears it (apollo §4, folk §4, loops §4, instantly §4).
3. **One page skeleton, repeated everywhere.** Title (+ count) and underline tabs, a toolbar with search and filters
   left and the primary button right, then a table or board, then pagination (instantly §5, attio §9, twenty §2,
   hubspot §4, lemlist §9). Users learn one page and can read all of them.
4. **Borders for structure, shadows only for things that float.** Every reference that measured anything reports
   1px hairlines on static surfaces and a soft large-blur shadow only on menus, popovers, drawers, toasts and
   dragged cards (close §3, attio §3, front §3, smartlead §3).
5. **Status is a tinted pill: dot or icon + word.** Pale tint, saturated text, never color alone (instantly §4,
   smartlead §4, close §3, twenty §4). The set of colors is small (green, amber, red, gray, plus one info hue) and
   learned once.
6. **Every number carries its context.** "0/0 + % used" (instantly §4), percent over raw count (customerio §4),
   "vs previous period" deltas (lemlist §4), opens labelled "directional" and bots excluded (apollo §5.2).
7. **Builders are one vertical lane.** Trigger or first step at the top, cards joined by a connector, the delay as a
   pill on the connector, a fixed end; per-step results on the same canvas (close §5, loops §5.1-5.2, hubspot §5.1,
   apollo §5.3, lemlist §5, customerio §5).
8. **Pre-flight before anything irreversible.** Customer.io's "Review (2)", Loops' "Guardian: Checks passed",
   lemlist's red dot on the invalid step, Smartlead's "Review and Launch" (customerio §6, loops §5.1, lemlist §5,
   smartlead §5).
9. **Plain-language sentences instead of forms.** "When ... If ... Then ..." (front §5.4), "Trigger: When an
   Opportunity is [created or updated]" (close §5), "Wait 5 days", "Subject not set" as node summaries (loops §4).
10. **Empty states that hand over the real next action.** Connect Google / Microsoft buttons in an empty table
    (attio §4), three stacked action cards (folk §4), choice cards (hubspot §4, front §5.2).
11. **Defaults first, knobs second.** "Suggested 1, Max 4" under each warm-up field (instantly §5), Basics before
    Advanced, recommended tags (smartlead §6), an amber callout only where a choice can hurt deliverability
    (instantly §4).
12. **Keyboard as a visible affordance.** Cmd/Ctrl+K palette and key caps shown next to actions (twenty §2,
    missive §2, attio §2, lemlist §2).

## A2. What each product did best

| Product | Best-executed idea | Where |
|---|---|---|
| Attio | Quietest chrome of the set; quiet "Help and first steps 1/6" progress instead of a blocking modal; empty table offers the real Connect buttons | attio §2, §4, §6 |
| Instantly | Warm-up as a first-class column (health score, flame toggle, "x/y + % used"); "Suggested / Max" helper text; amber warning only on risky options | instantly §4, §5 |
| lemlist | Deliverability hub: one filter bar across tabs, KPI card (label + (i) + number + delta + sparkline), score ring in table cells, numbered setup cards that grey out future steps with a reason | lemlist §4, §5, §6 |
| Close | Measured, honest density (224px sidebar, 33px rows, 13px cells); bulk bar replaces the filter bar; run timeline with check / hourglass per step | close §2, §3, §5 |
| Superhuman | Triage by split tabs with muted counts; selected row = faint tint + 3px left accent bar; warm near-black text | superhuman §4, §5 |
| folk | Persistent bottom-of-sidebar job card with a live counter; three-card empty state; "Saving changes..." autosave text | folk §2, §4 |
| Pipedrive | Kanban column header with sum and count; deal card with exactly four facts and one status icon; rotting age pill | pipedrive §4, §8 |
| Customer.io | Header that says what and whether it runs; KPI sparkline cards; "Review (n)" gate; node type stripe | customerio §4, §5 |
| Loops | Node summaries that state incompleteness ("Subject not set"); one dark button; segmented control with a sentence explaining the consequence | loops §4, §6 |
| Smartlead | Campaign tabs in the order of work with a persistent "Review and Launch"; checkbox rows with one-line reasons and numeric guidance; the only real mobile app observed (bottom tabs, 2x2 stat cards) | smartlead §2, §5, §7 |
| Missive | Row color semantics (unread, selected, snoozed) and inline timeline events ("Rule applied [chip]"); undo toast instead of a confirm | missive §4, §6 |
| Front | When / If / Then rule builder with "Rule insights" blast radius; settings tables whose first cell is name + one-line description; connect-mailbox tile picker | front §5 |
| HubSpot | Delay as a clickable band between step cards ("Delay: 1 business day"); settings rows = bold label + gray sentence + control; ON/OFF toggle with text | hubspot §5 |
| Twenty | 13px UI with a four-step gray ramp; row -> side panel -> full page; right-docked command menu with key caps | twenty §3, §5 |
| Apollo | Status as a row of filled/outline icons with text pills only for exceptions; per-step live counters on the sequence editor; "Not sent reason" as a filter | apollo §4, §5 |

## A3. What the spec-writing itself taught

Most actionable sections (the builder can use them directly):

- **Measured values from live DOM.** Close's tour iframe (224px sidebar, 33px rows, 13px cells, exact hex) and
  Twenty's live mock (13px/500, #333/#666/#999/#B3B3B3 ramp, 0.67px hairlines) are the only numbers in the set that
  are not guesses. Specs that measured the marketing site instead of the app (attio, lemlist, superhuman, loops)
  said so, which is the second-best outcome.
- **State inventories.** Lists of every status and what it looks like (missive §3 row colors, apollo §4 status icon
  row, smartlead §5 keyboard chords, instantly §4 the 11 status filter options) translate one-to-one into tokens.
- **Screen-to-our-route mapping.** Specs that ended each key screen with "maps to rightnow-ai X" (customerio,
  loops, hubspot, front) made reuse decisions obvious.
- **Exact copy.** Literal labels ("Wait for 1 day", "Checks passed 2", "Subject not set", "Continue without
  channels") carry more design than adjectives.
- **"Why it works" paragraphs** were the best source for principles, because they had to name causes.

Least actionable:

- **"(est.)" colors read off downscaled screenshots** (apollo at ~755px wide, pipedrive 900px crops). Useful for
  hue family, useless as values. Part B therefore chooses its own values and verifies contrast.
- **Marketing mockups taken for product UI** (superhuman's stylised renders, apollo's "holographic" renders): the
  spec writers flagged it, but density and states cannot be trusted.
- **Mobile and dark mode were almost never observed.** Only Smartlead's native app shows a phone layout; no live
  app dark mode was seen anywhere. Part B's mobile shell and dark palette are therefore reasoned from principles and
  the one Smartlead data point, and say so.
- **Interaction without states.** "Hover reveals actions" without the keyboard and touch equivalent, or "toast"
  without duration and placement, cannot be implemented as written.

Rule adopted for Part B: every component lists sizes, states, tokens and accessibility; every screen lists layout
(desktop and mobile), hierarchy, primary action, empty-state copy and the reference it borrows from; every color has
a measured contrast ratio.

---

# Part B. rightnow-ai design spec

## B0. Direction: "Signal Desk"

A cold-email operator works like a dispatcher: dozens of mailboxes, each with a daily allowance and a health
state, feeding sequences that must never burst, double-send or lie. The interface is a **desk**: warm paper
surfaces, ink controls, ruled hairlines, ledger-style mono labels. Color is a **signal**: it appears only when a
mailbox, campaign, lead or message is in a state that matters, and a single teal "signal" hue marks where you are
and what has focus.

What makes it ours (no single reference looks like this):

| Choice | Ours | Closest references and how we differ |
|---|---|---|
| Neutrals | Warm paper `#F8F7F4` canvas, white surfaces, warm ink `#1C1B18` | Warm off-whites in loops, folk, superhuman, hubspot; they pair them with blue, purple or yellow accents |
| Primary action | Ink-filled button (inverted to paper in dark mode) | Dark primaries in folk, loops, hubspot 2025, apollo (secondary dark); we pair it with a teal signal instead of yellow/maroon |
| Signal hue | Teal `#0B6F75` / dark `#45C2C7`: active nav marker, selection, focus ring, links, chart series 1 | No reference uses teal as the selection/focus color (customerio uses it for a builder button only) |
| Type | IBM Plex Sans (UI) + IBM Plex Mono (micro-labels, table headers, numbers in meters, DNS, key caps) | References use Inter, system, Averta, custom faces; none uses Plex; mono headers echo apollo §3 |
| Shape | Soft rectangles (6px controls, 12px cards, 16px dialogs); fully round only for status pills and dots | Most references round buttons to pills (front, close); we keep pills for state so "round = state" is a rule |
| Signature components | **Send meter** (today's sent / allowance, always in the shell) and **signal stripe** (3px left edge on rows and cards carrying the worst state) | Built from folk's persistent sidebar job card, instantly's "x/y + % used", missive's source stripe, superhuman's left bar |

## B1. Design principles

1. **Sending safety is always on screen.** Today's sent / allowance and the sending state are visible in the shell
   on every page; each campaign says in sentences why it is or is not sending; held, failed and unknown-outcome
   sends have their own tabs and counts, never a footnote. (from: folk §2 import card, instantly §4 daily sent x/y, customerio §6 "Live" banner)
2. **State before story.** Every account, campaign, lead and message shows its state as a pill (word + dot/icon)
   in the first two columns or the first line; health is a 0-100 ring with a band label. Color is never the only
   carrier. (from: instantly §4, lemlist §4 score ring, smartlead §9)
3. **Color is signal, not decoration.** Chrome is paper, ink and hairlines. Saturated color is reserved for status,
   the teal signal (selection, focus, links) and charts. A screen with nothing wrong is almost monochrome.
   (from: attio §9, apollo §9, missive §3)
4. **Every number has its denominator.** "142 / 300", "4.1% of 1,203 sent", "Opens (estimated)". Rates computed
   from fewer than 20 sends show "Not enough data". (from: customerio §4, apollo §5.2, instantly §4)
5. **One screen, one job, one primary action.** One H1, one ink button per view region (page header, drawer
   footer, dialog footer). Everything else is secondary, ghost or link. (from: apollo §4, folk §9, loops §8)
6. **Honest by construction.** Unknown outcomes say "Outcome unknown", estimates say "estimated", unfinished steps
   say "Subject not set", unsubscribe and suppression are visible states with their reason, nothing animates to
   imply activity that is not happening. (from: loops §6 honest empty nodes, apollo §6 guardrails)
7. **Defaults first, knobs second.** Recommended values are pre-filled and printed under the label ("Recommended
   10, max 40"); advanced settings sit behind a disclosure; an amber callout appears only next to an option that can
   hurt deliverability. (from: instantly §5-6, smartlead §6, hubspot §5.2)

## B2. Design tokens

All tokens are CSS custom properties on `:root` (light) and `.dark` (dark; next-themes `attribute="class"` already
sets it). Tailwind 4 reads them through `@theme inline` (section B7.1). Contrast ratios were computed with the WCAG
2.x formula against the surface named in the "on" column; AA needs 4.5:1 for text, 3:1 for large text, icons, focus
rings and input borders.

### B2.1 Color: neutrals

| Token | Role | Light | Dark | Contrast notes |
|---|---|---|---|---|
| `--bg` | App canvas (behind cards), auth page | `#F8F7F4` oklch(0.976 0.004 85) | `#121210` oklch(0.181 0.004 107) | - |
| `--surface` | Cards, tables, drawers, inputs | `#FFFFFF` | `#1A1917` oklch(0.212 0.004 85) | - |
| `--surface-sunken` | Sidebar, table header, kanban column, inbox canvas, code blocks | `#F0EFEA` oklch(0.951 0.006 95) | `#161614` oklch(0.197 0.003 107) | - |
| `--surface-elevated` | Menus, popovers, tooltips, toasts, command palette | `#FFFFFF` | `#22211E` oklch(0.242 0.005 85) | dark relies on lighter tone + border, not shadow |
| `--hover` | Row / nav / ghost-button hover | `#EAE8E2` | `#262522` | fg on hover: 14.06 (L), 12.74 (D) |
| `--active-nav` | Selected nav item fill | `#E6E4DD` | `#2A2926` | fg on it: 13.54 (L), 12.09 (D) |
| `--border` | Hairlines between rows, card edges, dividers | `#E3E1DB` | `#2E2D29` | decorative (no AA requirement) |
| `--border-strong` | Secondary button edge, table frame, column separators | `#CFCCC4` | `#3D3B36` | decorative |
| `--input` | Input, select, checkbox and textarea boundary | `#8F8B81` | `#6B6860` | 3.40 on surface (L), 3.16 (D): passes 1.4.11 |
| `--fg` | Primary text, headings, icons | `#1C1B18` oklch(0.222 0.006 92) | `#ECEAE4` oklch(0.937 0.008 92) | 17.22 on surface, 16.08 on bg (L); 14.60 / 15.59 (D) |
| `--fg-muted` | Secondary text, labels, inactive tabs, table headers | `#5E5B53` oklch(0.471 0.013 90) | `#A8A59C` oklch(0.722 0.013 92) | 6.78 surface, 6.33 bg, 5.89 sunken (L); 7.13 / 7.36 sunken / 6.54 elevated (D) |
| `--fg-subtle` | Meta (timestamps, IDs), placeholders, helper text | `#6B6860` oklch(0.518 0.013 90) | `#8E8B82` oklch(0.637 0.014 92) | 5.6 surface, 4.9 sunken (L); 5.16 surface, 4.73 elevated (D). Never on tinted backgrounds |
| `--fg-disabled` | Disabled labels | `#A8A59C` | `#5E5B53` | exempt (disabled), always paired with `cursor:not-allowed` |
| `--overlay` | Scrim behind drawers, dialogs, palette | `rgb(28 27 24 / 0.40)` | `rgb(0 0 0 / 0.60)` | - |

### B2.2 Color: action, signal, focus

| Token | Role | Light | Dark | Contrast |
|---|---|---|---|---|
| `--primary` | Primary (ink) button fill, checked checkbox, switch on | `#1C1B18` | `#ECEAE4` | - |
| `--primary-fg` | Text on primary | `#FFFFFF` | `#121210` | 17.22 (L), 15.59 (D) |
| `--primary-hover` | Hover fill | `#34322D` | `#D6D3CB` | text stays >= 12:1 |
| `--signal` | Active nav marker, selected row bar, links, focus ring, tab underline, chart-1 accent | `#0B6F75` oklch(0.494 0.082 202) | `#45C2C7` oklch(0.748 0.108 199) | 5.92 surface, 5.53 bg, 5.10 on tint (L); 8.19 / 8.75 / 6.59 (D) |
| `--signal-tint` | Selected row, selected filter chip, active palette row | `#E2F1F1` | `#10302F` | fg on it 14.83 (L), 11.75 (D) |
| `--ring` | Focus outline color | `var(--signal)` | `var(--signal)` | >= 5.5:1 against every surface |
| `--danger-btn` | Destructive button fill (darker than `--danger-solid` so white text passes) | `#B42318` | `#C2352A` | white text 6.57 (L), 5.47 (D) |

### B2.3 Color: semantic (status pills, callouts, deltas)

Each semantic has three tokens: `-fg` (pill/callout text and icon), `-tint` (pill/callout background) and
`-solid` (dots, chart marks, meter fills, stripe). Pill text is always `-fg` on `-tint`.

| Semantic | Meaning in rightnow-ai | `-fg` L / D | `-tint` L / D | fg-on-tint L / D | `-solid` L / D (vs surface) |
|---|---|---|---|---|---|
| `success` | Healthy, sending, delivered, replied, won | `#16704A` / `#5CCB92` | `#E5F3EA` / `#12291D` | 5.31 / 7.65 | `#2E9A66` 3.54 / `#3FB57C` 6.79 |
| `warning` | Needs a look soon, degraded, held, paused campaign, risky | `#8A4B00` / `#F1B24A` | `#FCEFD9` / `#2D2210` | 5.99 / 8.31 | `#B87300` 3.82 / `#E0A030` 7.73 |
| `danger` | Blocked, failing, bounced, needs attention | `#B42318` / `#FF8A7E` | `#FCEBE9` / `#351713` | 5.70 / 7.16 | `#D92D20` 4.83 / `#F0574A` 5.16 |
| `info` | In progress: re-warming, syncing, scheduled, sending, running subsequences | `#3B49B0` / `#9BA5FF` | `#ECEDFB` / `#1D2040` | 6.53 / 6.92 | `#5464D8` 5.01 / `#7C88F0` 5.55 |
| `neutral` | Draft, paused by user, cancelled, not interested, archived | `#4A4842` / `#C9C6BD` | `#EEEDE8` / `#262522` | 7.80 / 8.97 | `#8F8B81` 3.40 / `#6B6860` 3.16 |
| `ai` | AI-generated text marker, AI suggestions to review | `#6D3FB5` / `#C4A2FF` | `#F1EBFB` / `#271D3A` | 5.95 / 7.53 | `#8B5CD6` / `#A985F0` |

Rule: the teal `--signal` is never used for a status. Info is indigo (hue 272) so it cannot be confused with the
signal (hue 202) or success (hue 158).

### B2.4 Color: charts

Series order is fixed; every series also has a distinct dash or marker so charts work without color.

| Token | Default use | Light | Dark | vs surface L / D |
|---|---|---|---|---|
| `--chart-1` | Sent / volume / warm-up sent | `#0E8A90` | `#3BB9BF` | 4.15 / 7.43 |
| `--chart-2` | Replied | `#5363D6` | `#8592F5` | 5.09 / 6.21 |
| `--chart-3` | Clicked | `#B7790B` | `#E3A63A` | 3.65 / 8.18 |
| `--chart-4` | Variant / segment 4, positive replies when not using success | `#B0428F` | `#E07BC4` | 5.22 / 6.53 |
| `--chart-5` | Opened (estimated), always dashed `4 3` | `#6B7280` | `#9AA1AD` | 4.83 / 6.76 |
| `--chart-6` | Segment 6 | `#5E7D1F` | `#9CC255` | 4.74 / 8.58 |
| `--chart-grid` | Gridlines | `#E9E7E1` | `#2A2926` | decorative |
| `--chart-axis` | Tick labels | `var(--fg-muted)` | `var(--fg-muted)` | 6.78 / 7.13 |

Semantic overrides: Bounced and "landed in spam" always use `--danger-solid`; inbox / delivered always
`--success-solid`; "to send" / planned uses `--neutral-solid`.

### B2.5 Typography

Families (via `next/font/google` in `app/layout.tsx`, `display: "swap"`, exposed as CSS variables):

- `--font-sans`: **IBM Plex Sans**, weights 400, 500, 600; fallback `ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif`.
- `--font-mono`: **IBM Plex Mono**, weights 400, 500; fallback `ui-monospace, "SFMono-Regular", Consolas, monospace`.

Numbers: `font-variant-numeric: tabular-nums` on `table`, `.num`, stat values, meters, pagination, timestamps and
counts. Never animate numbers.

| Role | Family | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `display` | Sans | 32 / 40 | 600 | -0.015em | Auth brand line only |
| `h1` | Sans | 24 / 32 | 600 | -0.01em | Page title (one per page) |
| `h2` | Sans | 16 / 24 | 600 | 0 | Section and card titles |
| `h3` | Sans | 14 / 20 | 600 | 0 | Sub-sections, drawer sections, step titles |
| `body` | Sans | 14 / 20 | 400 | 0 | Default text, table cells, inputs |
| `body-strong` | Sans | 14 / 20 | 500 | 0 | Names in rows, nav items, buttons |
| `small` | Sans | 13 / 18 | 400 | 0 | Secondary lines, descriptions, helper text |
| `micro` | Mono | 11 / 16 | 500 | 0.06em, UPPERCASE | Table headers, nav group labels, field micro-labels, KPI labels in dense strips (from: apollo §3 mono headers, folk §3 uppercase micro-labels) |
| `kpi` | Sans | 28 / 32 | 600 | -0.01em | Stat tile values (tabular) |
| `kpi-sm` | Sans | 20 / 28 | 600 | 0 | Values inside drawers and step counters |
| `mono` | Mono | 13 / 20 | 400 | 0 | DNS records, IDs, API key prefixes, headers, JSON payloads |
| `kbd` | Mono | 11 / 16 | 500 | 0 | Key caps |
| `pill` | Sans | 12 / 16 | 500 | 0 | Status pills, chips, count badges |

Mobile (< 768px): `h1` 20 / 28; inputs, selects and textareas use 16px text (prevents iOS zoom); everything else
unchanged.

### B2.6 Spacing, sizing, density

4px base. Tailwind's default spacing scale already matches (`1` = 4px); use only these steps:
`0.5` 2px, `1` 4, `1.5` 6, `2` 8, `3` 12, `4` 16, `5` 20, `6` 24, `8` 32, `10` 40, `12` 48, `16` 64.

| Measure | Value |
|---|---|
| Page gutter | 32px at >= 1280, 24px at 768-1279, 16px below 768 |
| Page max width | none for list/board/inbox pages; 1200px for the dashboard; 720px for settings forms and auth-adjacent pages |
| Vertical rhythm | 24px between page sections, 16px between a section title and its content, 12px between cards in a grid |
| Card padding | 20px (16px below 768) |
| Control height | 36px default, 32px small, 44px large and on touch (see B4.1) |
| Table row | 44px single-line, 56px two-line (name + meta), header 36px |
| Touch target | >= 44 x 44px for every interactive element below 768px (padding may provide it) |

### B2.7 Radii

| Token | Value | Use |
|---|---|---|
| `--radius-xs` | 4px | Checkbox, key cap, small chips (tags), progress bars |
| `--radius-sm` | 6px | Buttons, inputs, selects, nav items, segmented controls, tooltips |
| `--radius-md` | 8px | Menus, popovers, toasts, bulk bar, kanban cards, message cards in lists |
| `--radius-lg` | 12px | Cards, table frames, stat tiles, kanban columns, thread message cards |
| `--radius-xl` | 16px | Dialogs, command palette, mobile sheets (top corners only) |
| `--radius-full` | 9999px | Status pills, dots, avatars, count badges, toggles |

Shape rule: **round means state** (pills, dots, rings); everything you click is a soft rectangle.

### B2.8 Borders, elevation, shadows

- Static surfaces (cards, tables, sidebar, inputs): 1px `--border` (inputs `--input`), **no shadow**.
  (from: close §3, attio §3, smartlead §3)
- Floating layers get elevation:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--shadow-1` | `0 1px 2px rgb(28 27 24 / 0.06)` | `none` | Secondary button resting lift, sticky table header when scrolled |
| `--shadow-2` | `0 6px 20px -4px rgb(28 27 24 / 0.14), 0 0 0 1px var(--border)` | `0 6px 20px -4px rgb(0 0 0 / 0.55), 0 0 0 1px var(--border-strong)` | Menus, popovers, tooltips, toasts, dragged kanban card |
| `--shadow-3` | `0 24px 64px -12px rgb(28 27 24 / 0.28), 0 0 0 1px var(--border)` | `0 24px 64px -12px rgb(0 0 0 / 0.70), 0 0 0 1px var(--border-strong)` | Drawers, dialogs, command palette |

- **Signal stripe**: a 3px left edge (`box-shadow: inset 3px 0 0 var(--<semantic>-solid)`) on table rows, inbox
  rows and kanban cards whose object is in a warning or danger state; selected rows use `--signal`. It duplicates
  the pill, never replaces it. (from: missive §3 source stripe, superhuman §4 left accent bar, customerio §4 node
  stripe)

### B2.9 Motion

| Token | Value | Use |
|---|---|---|
| `--dur-1` | 100ms | Hover and press color changes |
| `--dur-2` | 160ms | Menus, popovers, tooltips (fade + scale 0.98 -> 1), tab underline move |
| `--dur-3` | 220ms | Drawer / sheet slide (translateX 16px -> 0 + fade), dialog (scale 0.98 -> 1 + fade), toast in |
| `--dur-4` | 1200ms | Skeleton shimmer cycle; "Sending" dot pulse uses 2000ms |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | Entrances |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exits (run at 70% of the entrance duration) |

No motion on numbers, layout shifts or page transitions. `prefers-reduced-motion: reduce`: all transitions and
animations become 0.01ms, shimmer becomes a static `--surface-sunken` block, the Sending dot does not pulse
(B6). next-themes keeps `disableTransitionOnChange` so theme switches never animate.

### B2.10 Z-index layers

| Token | Value | Layer |
|---|---|---|
| `--z-sticky` | 10 | Sticky table header, sticky first column, page toolbar, bulk bar |
| `--z-sidebar` | 20 | Desktop sidebar |
| `--z-topbar` | 30 | Mobile top bar, desktop top strip |
| `--z-popover` | 40 | Menus, selects, popovers, tooltips |
| `--z-drawer` | 50 | Drawer and its scrim (native `<dialog>` top layer also applies) |
| `--z-dialog` | 60 | Dialogs |
| `--z-palette` | 70 | Command palette |
| `--z-toast` | 80 | Toasts |
| `--z-skip` | 100 | Skip link |

Native `<dialog>.showModal()` (used by every drawer and dialog today) renders in the browser top layer; the
z-index tokens order the non-modal layers around it.

### B2.11 Focus ring

- Default: `outline: 2px solid var(--ring); outline-offset: 2px;` on `:focus-visible` only.
- Inputs, selects, textareas: `outline-offset: 1px` and border color `--ring`.
- Rows and list items that receive focus (inbox rows, palette rows, kanban cards): `outline-offset: -2px` (inset)
  so the ring is not clipped by overflow containers.
- On ink (primary) buttons in light mode the ring sits outside, on the paper, so it keeps 5.5:1.
- Never remove a focus style without replacing it.

## B3. Layout and navigation

### B3.1 Breakpoints

Tailwind 4 defaults, unchanged: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536.

| Range | Shell | Sidebar | Content |
|---|---|---|---|
| < 768 (mobile) | Top bar + left drawer | Hidden; drawer on demand | Single column, 16px gutter |
| 768-1279 (tablet / small laptop) | Sidebar rail + content | 64px icon rail, labels as tooltips; user can expand (overlay, 232px) | 24px gutter |
| >= 1280 (desktop) | Sidebar + content | 232px expanded; user can collapse to rail (persisted) | 32px gutter |

Acceptance widths: 390px (mobile) and 1440px (desktop). Playwright runs at 1280x720, which is the expanded shell.

### B3.2 App shell (desktop)

```
+----------------+--------------------------------------------------------+
| RN  RightNow   |  [breadcrumb on record pages]       [Search or jump  ⌘K]| <- 48px top strip
|     <workspace>|--------------------------------------------------------|
|                |  H1 Page title            [secondary] [Primary action] |
| Dashboard      |  One-line description                                   |
| OUTREACH       |  Section tabs (link tabs or ARIA tabs)                  |
|  Email Accounts|  Toolbar: search, filters ............ count, actions   |
|  Warm-Up & D.. |  +---------------------------------------------------+ |
|  Campaigns     |  | table / board / cards                             | |
|  Leads         |  +---------------------------------------------------+ |
| CONVERSATIONS  |                                                         |
|  Unified Inbox |                                                         |
|  CRM           |                                                         |
| INSIGHT        |                                                         |
|  Analytics     |                                                         |
|  Automations   |                                                         |
| ...            |                                                         |
|  Settings      |                                                         |
| [Send meter]   |                                                         |
| [theme][signout][collapse]                                               |
+----------------+--------------------------------------------------------+
```

DOM order (keyboard and e2e tests depend on it): skip link -> `<aside>` (brand, `<nav aria-label="Main">`, send
meter, footer buttons) -> content column (top strip, `<main id="main-content" tabIndex={-1}>`). The first focusable
element after the skip link must be the first Main nav link, so nothing focusable sits above the nav in the sidebar.

**Sidebar** (232px, `--surface-sunken`, 1px right `--border`, sticky full height, its own scroll):

1. **Brand block** (56px tall, padding 12px 16px, not interactive): 28px `--primary` rounded-6 tile with "RN" in
   Plex Mono 12/500 `--primary-fg`; to its right "RightNow" `body-strong` and the workspace name below in `small`
   `--fg-muted`, truncated with a `title`. (from: attio §2, twenty §2, folk §2 workspace block; ours is static
   because the product is single-owner)
2. **`<nav aria-label="Main">`** containing exactly the 10 PS-UI-01 links, in this order and with these exact
   labels and existing icons (lucide). Each group is a `<p id="nav-g-outreach">` label in `micro` text
   (`--fg-subtle`, padding 16px 10px 4px) followed by `<ul aria-labelledby="nav-g-outreach">`; labels are never
   links, so the nav still holds exactly 10 links. Groups follow the order of work (from: lemlist §2 Find & Manage / Engage / Analyze,
   smartlead §2 Engage / Inbox health / Performance, apollo §2 grouped rail):

   | Group label | Link label (exact) | Route | Icon | Badge |
   |---|---|---|---|---|
   | (none) | Dashboard | `/dashboard` | `LayoutDashboard` | - |
   | OUTREACH | Email Accounts | `/accounts` | `Mail` | - |
   | | Warm-Up & Deliverability | `/deliverability` | `Flame` | - |
   | | Campaigns | `/campaigns` | `Megaphone` | - |
   | | Leads | `/leads` | `Users` | - |
   | CONVERSATIONS | Unified Inbox | `/inbox` | `Inbox` | unread count (existing; `aria-label="{n} unread"`) |
   | | CRM | `/crm` | `KanbanSquare` | - |
   | INSIGHT | Analytics | `/analytics` | `BarChart3` | - |
   | | Automations | `/automations` | `Workflow` | - |
   | (bottom, after a 1px divider, pushed down with `mt-auto`) | Settings | `/settings` | `Settings` | - |

   Nav item: 36px tall, radius 6, padding 0 10px, gap 10, icon 16px `--fg-muted`, label `body-strong` `--fg`.
   Hover `--hover`. Active (`aria-current="page"`, also for sub-routes: `/campaigns/*` and `/scheduled` activate
   Campaigns; `/leads/*` and `/blocklist` activate Leads; `/deliverability/*` activates Warm-Up & Deliverability;
   `/settings/*` activates Settings): fill `--active-nav`, icon `--fg`, plus a 3px x 16px `--signal` bar at the
   item's left inner edge (from: superhuman §4 left accent bar). Link text content must stay exactly the label
   (the e2e test compares link texts); the unread badge renders only when > 0 (existing behaviour).
   Settings must remain inside the same `<nav aria-label="Main">` (last link).
3. **Send meter** (signature component, B4.17) at the bottom of the sidebar above the footer, 16px horizontal
   margin. (from: folk §2 persistent job card, instantly §4 daily sent x/y)
4. **Footer row** (48px, 1px top border): theme toggle (existing `ThemeToggle`, ghost icon button), "Sign out"
   (ghost sm button with `LogOut` icon, existing behaviour), collapse toggle (ghost icon button, `PanelLeftClose` /
   `PanelLeftOpen`, `aria-label="Collapse sidebar"` / `"Expand sidebar"`, `aria-expanded`), right-aligned.

**Collapse behaviour.** Rail = 64px: brand tile only, nav icons centered with the label kept in the DOM as
`sr-only` (link text unchanged) plus a tooltip (B4.12) on hover/focus, group labels hidden, send meter becomes a
28px ring (B4.17 compact), footer stacks icon buttons vertically. Default: expanded at >= 1280, rail at 768-1279.
The toggle overrides the default and is stored in `localStorage["rn.sidebar"] = "rail" | "full"` (wrapped in
try/catch; failure falls back to the default). At 768-1279 "Expand sidebar" opens the full sidebar as an overlay
(232px, `--shadow-3`, scrim, Escape closes) instead of pushing content. (from: close §2 collapsible to 44px rail,
lemlist §2 collapsible sidebar)

**Top strip** (desktop and tablet, 48px, `--bg`, 1px bottom `--border`, sticky, `--z-topbar`): left = breadcrumb
(record pages only, B3.5); right = command palette trigger (B3.4): a 240px secondary-style button, `Search`
icon, text "Search or jump to..." `--fg-subtle`, right-aligned key cap "⌘K" (Mac) or "Ctrl K" (others).
(from: pipedrive §2 topbar search, close §2, customerio §2 search with ⌘K chip)

### B3.3 Page header pattern

Every page starts with the same block (component `PageHeader`, B4.18). (from: instantly §2 title + tabs,
twenty §2 title + primary right, front §9 one H1 + one primary top right)

| Slot | Spec |
|---|---|
| Title | `h1`, one per page; text stays as today (tests read it) |
| Status | Optional status pill right after the title (campaign detail) |
| Description | Optional `small` `--fg-muted`, max 72ch, one or two sentences (honest-limits copy lives here) |
| Actions | Right-aligned on the title row: at most one primary button, up to two secondary; below 768 they wrap under the title, full width if one, 50/50 if two |
| Section tabs | Optional, under the description, full width, 1px bottom border; link tabs between sibling routes (B4.7) or ARIA tabs within a page (existing `Tabs`) |
| Spacing | 24px below the header block before content; title row min height 36px |

Sibling-route section tabs (link tabs inside `<nav aria-label="Section">`, `aria-current="page"` on the current):

| Group | Tabs (label -> route) | Replaces |
|---|---|---|
| Campaigns | Campaigns -> `/campaigns`; Scheduled emails -> `/scheduled` | "Scheduled emails" / "Back to campaigns" text links |
| Leads | Leads -> `/leads`; Lead lists -> `/leads/lists`; Blocklist -> `/blocklist` | "Lead tools" nav, "Back to leads" links |
| Deliverability | Overview -> `/deliverability`; Inbox placement -> `/deliverability/placement` | "Inbox placement tests" / "Back to deliverability" links |
| Settings | Workspace -> `/settings`; API keys -> `/settings/api-keys` | the "API keys" text link |

### B3.4 Command palette (Cmd/Ctrl+K)

Justified: 10 nav items plus 5 sibling routes, a keyboard-heavy operator, and five references converge on it
(from: attio §2, lemlist §2, customerio §2, missive §2, twenty §2).

- Opens with Cmd+K (Mac) / Ctrl+K (others) anywhere, or the top-strip trigger; on mobile, the top-bar search icon.
- Native `<dialog>` (`showModal`), 640px wide (calc(100vw - 32px) on mobile, full-screen sheet below 768),
  positioned 12vh from the top, `--surface-elevated`, `--radius-xl`, `--shadow-3`.
- Input row 52px: `Search` icon, input `body` 16px "Type a page or action...", Esc key cap at right.
- Results: grouped `micro` headings "Go to" and "Actions"; row 40px, icon 16px + label + right key cap or route
  hint in `--fg-subtle`; active row `--signal-tint`; `role="listbox"` + `aria-activedescendant`, Up/Down, Enter,
  Esc. Filtering is a case-insensitive substring match on labels.
- v1 content (no new APIs): "Go to": the 10 nav labels + Scheduled emails, Lead lists, Blocklist, Inbox
  placement, API keys. "Actions": "Connect an email account" (-> `/accounts`), "Import leads" (-> `/leads`),
  "Create a campaign" (-> `/campaigns`), "Toggle dark mode". Record search is out of scope.
- Empty result: "No page or action matches "{query}"." in `small` `--fg-muted`.

### B3.5 Breadcrumbs

Only on record pages, in the top strip: `<nav aria-label="Breadcrumb">`, `small`, separator `ChevronRight` 12px
`--fg-subtle`, last item `aria-current="page"` `--fg`. Currently one: campaign detail "Campaigns > {campaign
name}" (replaces the "All campaigns" link). Sibling routes use section tabs instead. Below 768 the breadcrumb shows
only the parent as a back link "< Campaigns" at the top of the page content. (from: attio §2 breadcrumbs only on
record pages, close §2 one-level back link)

### B3.6 Mobile shell (< 768px): top bar + drawer

Decision: **top bar + left drawer**, not a bottom tab bar.
Why: PS-UI-01 fixes 10 primary destinations and e2e tests require exactly one `<nav aria-label="Main">` with those
10 links; a bottom bar holds 4-5 items and would need a second, partial nav plus a "More" bucket. The only observed
mobile bottom bar (from: smartlead §7) belongs to a native companion app that drops campaign creation; ours must keep
every feature on the web. The existing shell already uses a menu button with `aria-controls="sidebar"`, so the
change is presentational.

- **Top bar**: 56px, `--surface`, 1px bottom border, sticky, `--z-topbar`, padding 0 4px. Left: menu button 44x44
  (`Menu` / `X`, `aria-label` "Open menu" / "Close menu", `aria-expanded`, `aria-controls="sidebar"`, as today).
  Then "RightNow" `body-strong`. Right: send meter chip (B4.17 compact: ring + "142/300") and a 44x44 search icon
  button (`aria-label="Search or jump to"`) that opens the palette.
- **Drawer**: the same `<aside id="sidebar">`, rendered `position: fixed; inset: 0 auto 0 0; width: min(300px,
  85vw)`, `--surface-sunken`, `--shadow-3`, slides in from the left (`--dur-3`), scrim `--overlay` behind it.
  Closes on: scrim tap, Escape, any nav link (route change, existing effect), the X button. Focus moves to the first
  nav link on open and back to the menu button on close; Tab cycles inside while open; `body` scroll is locked.
  Nav items are 44px tall in the drawer. The send meter shows full size at the bottom.
- **Content**: 16px gutter, single column, `h1` 20/28. **No horizontal page scroll**: `html, body { overflow-x:
  clip }` is not allowed as a fix; every wide element must contain its own scroll (rules below).
- **Tables** (B4.6 mobile rules): the table keeps its markup and lives in a horizontally scrolling frame; the
  checkbox and identity column are sticky-left; non-essential columns are hidden below 768 with
  `hidden md:table-cell` on both `th` and `td` (per-table priority lists in B5). No duplicated card markup (tests
  locate rows with `tbody tr` and buttons by unique accessible name).
- **Drawers -> full-screen sheets**: every right drawer becomes `inset: 0`, width 100vw, height 100dvh, radius 0,
  header sticky with the close button 44x44 at the right, footer actions sticky at the bottom with
  `padding-bottom: max(16px, env(safe-area-inset-bottom))`.
- **Dialogs**: below 768 they become bottom sheets: full width, `max-height: 90dvh`, top radius 16, slide up.
- **Multi-pane screens** (inbox, CRM board): one pane at a time (B5).
- **Touch targets**: every control >= 44x44 (buttons get `min-h-11` below 768; icon buttons 44; checkboxes get a
  44px label hit area).

## B4. Components

Existing primitives are restyled in place; names and props are kept so call sites do not churn (B7.2).

### B4.1 Button (`components/ui/button.tsx`)

| Variant (cva key) | Fill | Text | Border | Hover | Active | Use |
|---|---|---|---|---|---|---|
| `default` (= primary) | `--primary` | `--primary-fg` | none | `--primary-hover` | `--primary-hover` + inset `0 1px 0 rgb(0 0 0/.2)` | The one primary action per region |
| `outline` (= secondary) | `--surface` | `--fg` | 1px `--border-strong` | `--hover` | `--active-nav` | Everything else that is a button |
| `ghost` | transparent | `--fg` | none | `--hover` | `--active-nav` | Toolbars, row actions, icon buttons |
| `destructive` (new) | `--danger-btn` | `#FFFFFF` | none | 8% darker (`color-mix(in oklab, var(--danger-btn), black 8%)`) | same | Confirming a destructive action in a dialog footer |
| `danger-ghost` (new) | transparent | `--danger-fg` | none | `--danger-tint` | same | Row actions Disconnect, Delete, Remove |
| `link` (new) | none | `--signal` | none | underline | - | Inline actions in sentences |

| Size | Height | Padding x | Text | Icon | Gap |
|---|---|---|---|---|---|
| `sm` (new) | 32px | 10px | 13/18 500 | 14px | 6px |
| `default` | 36px | 14px | 14/20 500 | 16px | 8px |
| `lg` (new) | 44px | 18px | 14/20 500 | 16px | 8px |
| `icon` | 36x36 | 0 | - | 16px | - |
| `icon-sm` (new) | 32x32 | 0 | - | 14px | - |

Shared: radius 6, `transition: background-color var(--dur-1), color var(--dur-1)`, focus ring B2.11. Disabled:
`opacity: .45; cursor: not-allowed` (keep `disabled:pointer-events-none` off so the cursor shows; disabled buttons
keep their accessible name). Loading: leading `Loader2` 14px spinning (static under reduced motion),
`aria-busy="true"`, label unchanged, button disabled. Below 768: `default` and `sm` get `min-height: 44px`, icon
buttons 44x44. Split button (inbox Reply): primary + 1px `--primary-fg` 20% divider + 32px caret segment.
Icon-only buttons always have `aria-label`. (from: instantly §4, folk §4, loops §4 one dark button)

### B4.2 Input, select, textarea, label, helper text

| Element | Spec |
|---|---|
| Input | 36px (44 below 768, 16px text), radius 6, 1px `--input`, `--surface`, padding 0 10px, text `body` `--fg`, placeholder `--fg-subtle`. Hover border `--fg-muted`. Focus: border `--ring` + outline 2px `--ring` offset 1. Invalid (`aria-invalid="true"`): border `--danger-solid`, message below in `small` `--danger-fg` with `AlertCircle` 14px, linked by `aria-describedby`. Disabled: `--surface-sunken`, `--fg-disabled`. Read-only: `--surface-sunken`, normal text (from: attio §4 read-only gray). |
| Leading icon / unit suffix | Search icon 16px at 10px left (input padding-left 32px); unit suffix "per day", "%", "min" in `small` `--fg-subtle` inside the right edge (from: instantly §4 unit text inside input) |
| Select | Native `<select>` (keyboard and screen-reader safe), same box as Input, `appearance: none`, `ChevronDown` 14px `--fg-muted` at 10px right (wrapper span), padding-right 30px |
| Filter select (toolbar) | Same, 32px tall, text `small`, value prefixed by its name when not default ("Status: Paused"); default text `--fg-muted` (from: lemlist §4 "Status: All", instantly §4) |
| Textarea | min-height 88px, padding 8px 10px, `resize: vertical`, same states |
| Label | `small` 13/18 500 `--fg`, 6px above the control; required marker " (required)" in `--fg-subtle` text, not an asterisk alone |
| Helper text | `small` `--fg-subtle`, 4px below the control; recommended values use the form "Recommended 10, max 40" (from: instantly §5 "Suggested 1, Max 4") |
| Field group | Settings rows: label + helper on the left (max 50% width), control on the right, 1px `--border` between rows, row padding 14px 0; stacks below 768 (from: hubspot §5.2, front §4 settings rows) |
| Risk callout | When an option can hurt deliverability (e.g. slow warm-up off for a new account, daily limit above recommended): warning Callout (B4.11) directly under the field (from: instantly §4 amber callout) |

### B4.3 Checkbox, radio, switch, segmented control

- **Checkbox**: native input, 16x16, radius 4, `accent-color: var(--primary)`, 1px `--input` border; in tables a
  40px wide cell; below 768 the label/cell gives a 44x44 hit area. Indeterminate select-all uses the native
  `indeterminate` property.
- **Radio**: native, 16x16, `accent-color: var(--primary)`; options stacked 8px apart, each with optional helper
  line.
- **Switch** (boolean settings that take effect on save, e.g. "Enable warm-up", "Track opens"): native
  `<input type="checkbox" role="switch">` (label unchanged, so `getByLabel(...).check()` keeps working), track 32x18
  radius full, off `--input` track, on `--primary` track, thumb 14px `--surface`, plus visible text "On"/"Off" in
  `small` `--fg-muted` right of the track (from: hubspot §4 split ON/OFF with text). Use checkboxes, not switches,
  inside tables and multi-select lists.
- **Segmented control** (2-4 mutually exclusive views: analytics granularity, inbox reply mode): 32px, track
  `--surface-sunken` radius 6 padding 2px, selected segment `--surface` + `--shadow-1` + `--fg`, others
  `--fg-muted`; implemented as a radio group. When the choice changes behaviour, a one-line sentence below explains
  the effect (from: loops §4 Filter scope with explanation).

### B4.4 Status pill, badge, chip

**Pill anatomy**: inline-flex, height 22px, padding 0 8px, gap 6px, radius full, `pill` text 12/16 500,
background `--{semantic}-tint`, text `--{semantic}-fg`, leading 6px dot in `--{semantic}-solid` **or** a 12px
lucide icon in `--{semantic}-fg` (icons named in the tables). Variant `outline`: transparent background, 1px
`--{semantic}-solid` border (used for terminal "removed" states: Disconnected, Archived, Unsubscribed). The word is
always present; the pill is plain text to assistive tech (no role); a `title` / tooltip may add the reason (e.g. the
account's `lastError.message`), and the same reason is reachable by keyboard in the drawer.
(from: instantly §4 pill with leading dot, smartlead §4 tinted pills, apollo §4 text pills for exceptions)

Shared component: `components/status-pill.tsx` exporting `StatusPill({ tone, icon?, outline?, children })` plus
the mapping tables below as `const` records. `campaigns/status-badge.tsx` and the deliverability `BADGE` map use it.

**Email account display status** (`STATUS_LABEL` in `accounts-table.tsx`, plus Disconnected; PS-ACC-14):

| Label (exact) | Tone | Mark | Stripe |
|---|---|---|---|
| Active | success | dot | - |
| Paused | neutral | `Pause` icon | - |
| Paused until later | neutral | `Clock` icon | - |
| Re-warming | info | `Flame` icon | - |
| Inactive | warning | dot | warning |
| Soft bounce error | warning | `AlertTriangle` | warning |
| Connection error | danger | `PlugZap` | danger |
| Sending error | danger | `AlertCircle` | danger |
| Needs attention | danger | `AlertCircle` | danger |
| Disconnected | danger, outline | `Unplug` | danger |

**Deliverability lifecycle** (`AccountDeliverability["status"]`): Active success dot; Inactive warning dot;
Re-Warming info `Flame`; Paused neutral `Pause`; Needs Attention danger `AlertCircle`.

**Warm-up state** (`WARMUP` map): Active success `Flame`; Paused neutral `Pause`; Blocked danger `Ban`; No peers
warning `Users`; Suspended danger `AlertCircle`; not enabled -> neutral "Off".

**Mailbox sync**: synced within `SYNC_MAX_STALENESS_SEC` -> no pill, `small` `--fg-subtle` "Synced 3 min ago";
syncing -> info "Syncing" with `Loader2` (static under reduced motion); stale beyond the gate -> warning "Waiting
for sync"; failing -> danger "Sync failing".

**DNS** (domain level `ok | warn | block`): ok -> success "DNS OK"; warn -> warning "DNS warning"; block -> danger
"DNS blocks sending"; not yet checked -> neutral "DNS not checked". Per-record mini chips (SPF, DKIM, DMARC, MX) use
the same tones at height 20px with the record name in `micro` mono. (from: smartlead §3 SPF/DKIM/DMARC check
chips)

**Campaign display status** (`CampaignDisplayStatus`, PS-UI-06):

| Label (exact) | Tone | Mark |
|---|---|---|
| Draft | neutral | `Pencil` |
| Active | success | dot (pulses 2s while the campaign status endpoint says sending; static otherwise) |
| Paused | warning | `Pause` |
| Completed | neutral | `CheckCircle2` |
| Running Subsequences | info | `GitBranch` |
| Accounts Unhealthy | danger | `AlertCircle` |
| Bounce Protect | danger | `ShieldAlert` |
| Archived | neutral, outline | `Archive` |

**Campaign lead state** (`CampaignLeadState` + `StopReason`):

| State / reason | Label | Tone |
|---|---|---|
| QUEUED | Queued | neutral |
| ACTIVE | In sequence | info |
| PAUSED | Paused | warning |
| COMPLETED | Completed | neutral (`CheckCircle2`) |
| STOPPED + REPLIED / COMPANY_REPLIED | Replied / Company replied | success |
| STOPPED + AUTO_REPLIED | Auto-replied | neutral |
| STOPPED + UNSUBSCRIBED | Unsubscribed | neutral, outline |
| STOPPED + BOUNCED | Bounced | danger |
| STOPPED + COMPLAINED | Complained | danger |
| STOPPED + SEND_FAILED | Send failed | danger |
| STOPPED + ACCOUNT_UNASSIGNED | No sending account | warning |
| STOPPED + SUPPRESSED / SKIPPED / MANUAL | Suppressed / Skipped / Stopped manually | neutral |

Keep any label the UI already prints; this table assigns tones.

**Lead interest** (`INTEREST` in `leads/labels.ts`): Interested success; Meeting booked success `CalendarCheck`;
Meeting completed success `CalendarCheck2`; Won success `Trophy`; Out of office neutral `Plane`; Not interested
neutral; Wrong person neutral `UserX`; Lost danger; No show warning `CalendarX`. No interest set -> no pill.

**Lead verification** (`VERIFICATION`): Verified success `BadgeCheck`; Pending info; Not verified neutral; Invalid
danger; Risky warning; Catch-all warning; Job change warning.

**Suppression reason** (`REASON`, blocklist): Unsubscribed neutral outline; Hard bounce danger; Complaint danger;
Manual neutral; Not interested neutral; Erased (GDPR) neutral outline.

**Scheduled / message status** (`scheduled-view.tsx` tabs): Scheduled info `Clock`; Sending info `Loader2`; Sent
success; Held warning `PauseOctagon` ("Held" always shows its reason on hover and in the release dialog); Failed
danger; Outcome unknown warning `HelpCircle` (tooltip: "The provider may or may not have accepted it. It will not
be resent automatically."); Cancelled neutral. (from: apollo §8 HELD as amber pill with reason)

**Reply category** (inbox): Interested success; Meeting requested success `CalendarCheck`; Not interested neutral;
Wrong person neutral; Neutral neutral; Out of office neutral `Plane`; Unsubscribe neutral outline; Automated neutral
`Bot`; Uncertain warning `HelpCircle`.

**CRM**: stage kind Open neutral, Won success `Trophy`, Lost danger; task Open neutral, Done success, Awaiting
approval warning; overdue due date -> danger date chip.

**Automations / webhooks**: run OK success, Failed danger; webhook Active success, Error danger; delivery Pending
neutral, Sending info, Delivered success, Failed danger.

**Badges and chips** (not states):

| Kind | Spec |
|---|---|
| Count badge (nav, tabs) | min-width 18px, height 18px, radius full, padding 0 5px, Plex Mono 11/16 500, tabular. Nav unread: `--signal` fill, `#FFFFFF` (L) / `--bg` (D) text. Tab counts: `--surface-sunken` fill, `--fg-muted` text, `aria-hidden="true"` (tab accessible names are matched exactly by tests) |
| Tag chip | height 20px, radius 4, padding 0 6px, `--surface-sunken`, 1px `--border`, text 12 `--fg-muted`; overflow shows "+N" chip with a `title` listing the rest (from: lemlist §4 "+1" overflow) |
| Variable chip (editor) | `{{firstName}}` in Plex Mono 12, `--signal-tint` fill, `--signal` text, radius 4 (from: lemlist §3 variable chip) |
| AI marker | 12px `Sparkles` icon in `--ai-fg` before AI-generated or AI-suggested content; review queues use an `ai` pill "AI draft" (from: apollo §4 purple AI text, attio §3 sparkle for computed values) |
| "New"/"Beta" | not used (single-owner, no upsell) |

### B4.5 Stat tile / KPI card (`components/stat-tile.tsx`)

(from: lemlist §4 KPI card, customerio §4 sparkline card, apollo §4 stat strip with deltas)

```
+--------------------------------------+
| Sent today            (i)    ~~~~~~  |  label small fg-muted + info button; sparkline 64x24 top-right
| 142 / 300                            |  value kpi 28/32; denominator 16/24 fg-muted
| ▲ 12% vs prior 7 days                |  delta chip (optional)
| Accepted by the provider (not ...)   |  note small fg-subtle (existing `note` / `title`)
+--------------------------------------+
```

- Card: `--surface`, 1px `--border`, radius 12, padding 16px (20px >= 1280), min-height 104px, `role="group"`
  `aria-label={label}` (existing).
- Value: `kpi`, tabular; a denominator renders as ` / 300` in 16/24 400 `--fg-muted` (add an optional `of` prop;
  existing callers that pass "142 / 300" in `value` keep working).
- Info: the existing `title` text stays visible on the page (keyboard/touch); additionally a 20px ghost
  `Info` icon button with a tooltip of the same text (`aria-label="About {label}"`).
- Delta chip (optional prop `delta: { value: number; unit: "%" | "pp"; better: "up" | "down"; base: string }`):
  height 20, radius full, `pill` text, `TrendingUp`/`TrendingDown` 12px; tone success when the change is in the
  `better` direction, danger when against it, neutral when |change| < 0.5 or the base has < 20 sends (text "Not
  enough data"). Text format: "▲ 12.4% vs prior 7 days". The arrow glyph is `aria-hidden`; the chip's text says
  "up 12.4% versus prior 7 days" via `sr-only`.
- Sparkline (optional `trend: number[]`): 64x24, recharts `LineChart` without axes, stroke 1.5 `--fg-muted`, last
  point 3px dot `--fg`; only when >= 3 points; `role="img"` with an `aria-label` that lists the values (as
  `HealthTrend` does today).
- Meter variant (`variant="meter"`): replaces the value with a capacity meter (B4.17 full) for "Allowance used".
- Grid: `grid-cols-1` < 640, `grid-cols-2` 640-1023, `grid-cols-4` >= 1024, gap 12px.

### B4.6 Data table (`components/table-kit.tsx` + table markup)

(from: close §4 bulk bar replaces filters, twenty §4 typed headers and hairlines, instantly §4 toolbar, apollo §4
status icons, lemlist §4 rows-per-page footer, hubspot §4 view tabs)

**Frame**: `--surface`, 1px `--border`, radius 12, `overflow: hidden` on the frame, inner
`overflow-x: auto` scroll container (the existing `Card className="overflow-x-auto p-0"`), `table` width 100%,
`border-collapse: separate; border-spacing: 0`.

**Header**: 36px, `--surface-sunken`, bottom 1px `--border`, cells padding 0 12px (first 16px), `micro` text
(Plex Mono 11/16 500 uppercase, `--fg-muted`). Sticky: `position: sticky; top: 0; z-index: var(--z-sticky)` inside
the scroll container (page-level sticky is not attempted). Sortable header (`SortTh`): the whole label is a button;
inactive sortable columns show `ChevronsUpDown` 12px `--fg-subtle`; active shows `ArrowUp`/`ArrowDown` 12px `--fg`;
`aria-sort` stays.

**Body rows**: 44px single-line, 56px when the first cell has a meta line; cells padding 0 12px (first 16px),
`body` text, bottom 1px `--border` (none on the last row), `vertical-align: middle`. Identity cell = name in
`body-strong` + meta in `small` `--fg-subtle` (e.g. from name, "3 steps · created 2 Oct"). Numbers right-aligned,
tabular; percentages show the count in `--fg-subtle` after them ("4.1% · 49"). Empty value "-" in `--fg-subtle`.
Truncate long text with ellipsis + `title`.
Hover `--hover`. Selected (`aria-selected="true"`, existing): `--signal-tint` + 3px inset left `--signal` stripe.
Warning/danger object: 3px inset left `--warning-solid` / `--danger-solid` stripe (selection stripe wins).
Row click: whole-row click handlers are not added; drawers open from the control that opens them today (a name
link/button or a row action), so keyboard users keep the same tab stops and tests keep the same button names.

**Row actions**: right-most column "Actions", right-aligned, `ghost` `sm` buttons with icon + short label, 4px gap;
destructive ones use `danger-ghost`. Keep every existing action visible and keep its `aria-label` (e2e tests click
them by name); do not move them into an overflow menu in this redesign. Below 1024 the labels collapse to
`icon-sm` buttons (the `aria-label` already names them).

**Toolbar** (above the frame, 12px gap): left = search input (240px, `Search` icon, type `search`) + filter selects
(32px, B4.2) + the existing `TagSelect`; right = result count in `small` `--fg-muted` tabular ("142 accounts") and
optional view actions. Wraps on small screens; search goes full width below 640.

**Bulk bar** (`BulkToolbar`, role toolbar, `aria-label="Bulk actions"` unchanged): when >= 1 row is selected it
**replaces the toolbar row** in place (same height 48px, no layout jump): inverse surface (`--fg` background,
`--bg` text), radius 8, padding 0 8px 0 12px; left "{n} selected" `body-strong` + "Clear" ghost button (inverse
hover `rgb(255 255 255 / .12)` light / `rgb(0 0 0 / .12)` dark); then the actions as inverse ghost buttons; sticky
`top: 48px` (below the top strip). Selection persists across pagination only where it does today.

**Pagination** (`Pager`, `NextPage`): footer row inside the frame, 48px, top 1px `--border`, padding 0 16px; left
"1-25 of 142" `small` tabular `--fg-muted` (when the total is known); right "Previous page" / "Next page" secondary
`sm` buttons (labels unchanged). Cursor lists keep the single "Next page" button, styled the same.

**Empty state (in table)**: a single full-width row (`td colSpan`), padding 48px 24px, centered B4.14 inline
variant. Filtered-empty copy: "No {objects} match these filters." + ghost "Clear filters" when filters are active.

**Loading**: 5 skeleton rows at row height with 3-4 bars (12px tall, radius 4, `--surface-sunken`, shimmer
`--dur-4`); the table has `aria-busy="true"`; screen readers get a `sr-only` "Loading {objects}" status.

**Error**: a Callout (danger) above the frame with the message and a secondary "Try again" button; the existing
`role="alert"` messages keep their role.

**Mobile (< 768)**: the frame scrolls horizontally inside itself; the checkbox cell and the identity cell are
`position: sticky; left: 0` (checkbox) and `left: 40px` (identity) with `--surface` background and a right
`box-shadow: 4px 0 6px -4px rgb(28 27 24 / .12)` once scrolled; columns marked "md+" in B5 get `hidden
md:table-cell`. The page itself never scrolls horizontally.

### B4.7 Tabs (`components/tabs.tsx`) and link tabs

- Tab list: height 40px, `display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none`, no wrapping (replace
  `flex-wrap`), 1px bottom `--border`; a 24px fade mask on the overflowing edge.
- Tab: padding 0 12px, `body-strong` 14/20 500, inactive `--fg-muted`, hover `--fg` + `--hover` top-rounded fill,
  active `--fg` + 2px `--signal` underline (`-mb-px`), focus ring inset. Optional count badge (B4.4, `aria-hidden`)
  after the label, and an optional 6px `--warning-solid` dot for "needs attention" (e.g. a sequence step with an
  unset subject; from: lemlist §5 red dot on the invalid step tab, customerio §2 dot on Drafts).
- Keep the existing WAI-ARIA behaviour (arrow keys, Home, End, automatic activation, one tab stop).
- Link tabs (`components/section-tabs.tsx`, new): same look, `<nav aria-label="Section">` with `<a
  aria-current="page">`; no `role="tab"` (they navigate).
- Below 768: tablist scrolls horizontally; the active tab scrolls into view on mount.

### B4.8 Drawer / side sheet (account, lead, opportunity, rule and webhook editors)

(from: instantly §4 account details drawer, twenty §4 side panel, hubspot §4 right panel)

- Keep native `<dialog>` + `showModal()` (focus trap, Escape, top layer; tests use `getByRole("dialog")`).
  Restyle: `margin: 0 0 0 auto; height: 100dvh; max-height: 100dvh; width: min(640px, 100vw)` (account drawer 640,
  lead and opportunity 560, editors 560), `--surface`, left 1px `--border`, `--shadow-3`, radius 0, padding 0,
  `::backdrop { background: var(--overlay) }`, enter: translateX(16px) + fade, `--dur-3` `--ease-out`.
- Header: sticky, 56px, padding 0 20px, bottom 1px `--border`: title `h2` 16/24 600 (existing heading element and
  id), status pill(s), right-aligned close button (ghost, `X` icon + visible text "Close", keep the name "Close").
- Jump bar (long drawers only, e.g. the account drawer): a sticky row of link chips under the header ("Settings ·
  Sync · Domain · Warm-up · Re-warm"), each scrolling to its section `id`. Sections are **not** hidden behind tabs
  (tests expect all sections present).
- Body: padding 20px, sections separated by 24px and a 1px `--border` with `h3` titles.
- Footer: sticky, 64px, top 1px `--border`, padding 0 20px, primary right ("Save"), secondary left of it. Inline
  `role="status"` results sit in the footer's left side (existing messages).
- Mobile: full-screen sheet (B3.6).

### B4.9 Modal / dialog

- Native `<dialog>`, centered, width 480 (confirmations, release/held dialogs), 640 (forms such as import, SMTP
  connect), 800 (import wizard mapping step); `--surface`, radius 16, `--shadow-3`, padding 24px, max-height
  `calc(100dvh - 64px)` with the body scrolling.
- Title `h2` 18/26 600, optional description `small` `--fg-muted`; footer right-aligned, 8px gap, primary last;
  destructive confirmations use the `destructive` button. Multi-step dialogs show "Step 2 of 4: Map columns" as the
  `h3` (existing copy) plus a 4-segment progress bar (4px, `--signal` done, `--surface-sunken` todo) under the title
  (from: smartlead §4 3-step stepper, front §5.3 numbered steps).
- Existing `window.confirm()` prompts stay (e2e tests accept them with `page.once("dialog")`); replacing them with a
  styled ConfirmDialog is a later change with test updates.
- Mobile: bottom sheet (B3.6).

### B4.10 Toast

Not added as a general mechanism: results stay inline (`role="status"` / `role="alert"`) next to the control that
caused them, because tests read them there and because the result belongs where the user looked (principle 5).
One toast exists: after an inbox action that removes the current row from view (archive, mark done, delete
conversation), a toast confirms it. Spec: bottom-center (bottom-right >= 1024), 360px max, `--fg` background with
`--bg` text (inverse, like the bulk bar), radius 8, padding 10px 12px, `small` text, optional "Undo" button
(inverse text, underlined, 500) and a close `X`; `role="status"`, auto-dismiss 6s, paused on hover/focus, never for errors. (from: missive §4 archive
toast with Undo, attio §4 bottom-right toast) Undo only where an API to revert exists; otherwise no Undo.

### B4.11 Callout (inline notice, banner)

For honest-limits copy, warnings next to fields, campaign "why not sending", errors above tables.
`role="note"` (info) / `role="status"` (success) / `role="alert"` (danger, only when it appears in response to an
action). Box: radius 8, padding 12px 14px, `--{tone}-tint` background, 1px `--{tone}-solid` at 30% opacity
(`color-mix(in oklab, var(--x-solid) 30%, transparent)`) border, 16px icon (`Info`, `CheckCircle2`,
`AlertTriangle`, `AlertCircle`) in `--{tone}-fg`, title `body-strong` `--fg`, body `small` `--fg`, optional link
or action at the end. Neutral tone (gray) for disclaimers such as "Warm-up and re-warm-up cannot guarantee inbox
placement..." (from: lemlist §3 pale-blue info banner, instantly §4 amber warning callout, smartlead §4 dismissible
banners).

### B4.12 Tooltip

For rail labels, icon buttons and pill reasons. `--fg` background, `--bg` text, `small` 12/16, radius 6,
padding 6px 8px, max-width 280px, `--shadow-2`, offset 6px, show after 400ms hover or immediately on keyboard focus,
hide on Escape. Content must also be available without hover (aria-label, visible note, or drawer). Implementation:
a small CSS-positioned span with `role="tooltip"` and `aria-describedby`; no library. Never put interactive content
in a tooltip.

### B4.13 Menus and popovers

Used sparingly (row actions stay visible, B4.6). Spec for any menu: `--surface-elevated`, radius 8, `--shadow-2`,
padding 4px, item 32px (44 on mobile), `body` text, icon 16px, hover/active `--hover`, destructive items
`--danger-fg`, separators 1px `--border` with 4px margin; keyboard: Up/Down, Home/End, Enter, Escape returns focus
to the trigger.

### B4.14 Empty state (`components/empty-state.tsx`, rewritten)

The current component is a phase-placeholder ("arrives in ...") and is unused; replace it with:
`EmptyState({ icon, title, body, actions, variant: "inline" | "page" })`.

- **inline** (inside a table/list/board column): 40px circle `--surface-sunken` with a 20px icon `--fg-muted`,
  title `h2` 16/24 600, body `small` `--fg-muted` max 48ch, actions row (one primary or secondary + optional link),
  centered, padding 48px 24px. (from: attio §4, instantly §4 one bold line + one hint, smartlead §4)
- **page** (first-run, nothing exists yet): left-aligned within a 640px column: title `h2`, body, then 2-3 **action
  cards** stacked (each 72px: 32px icon tile `--surface-sunken`, `body-strong` title, `small` description,
  `ChevronRight`; whole card is one button/link; 1px `--border`, radius 12, hover `--hover`).
  (from: folk §4 three stacked action cards, hubspot §4 choice cards, front §5.2 connect options)
- Copy rules: title says what is missing in plain words; body says the next step and any honest constraint; actions
  are the real controls (never "Learn more" alone). Exact copy per screen is in B5.

### B4.15 Setup checklist (dashboard)

(from: lemlist §6 numbered step cards with greyed future steps and a reason, attio §6 quiet n/6 counter,
front §6 setup guide with thin progress bar)

- Card at the top of the dashboard while any step is open; hidden when all are done (no dismiss needed).
- Header: `h2` "Get ready to send" + `small` "{done} of 4 done" + 4px progress bar (`--success-solid` fill on
  `--surface-sunken`, `role="progressbar"`, `aria-valuenow`).
- Steps (ordered list, each row 56px): 24px number circle (done: `--success-solid` with `Check` 14px white;
  current: 2px `--fg` ring with number; locked: `--surface-sunken` with number `--fg-subtle`), title `body-strong`,
  description `small` `--fg-muted`, action at right (secondary `sm` link-button) for the current step only; locked
  steps show the reason in `--fg-subtle` instead of an action.
- Steps and their completion source (all data the dashboard already loads, or one cheap count):
  1. "Connect an email account" -> done when `d.accounts.length > 0`; action "Connect account" -> `/accounts`.
  2. "Add your physical address" (required in every email footer) -> done when the workspace `physicalAddress` is
     set (add the field to the dashboard's workspace read); action "Open Settings" -> `/settings#workspace`.
  3. "Import leads" -> done when the workspace has >= 1 lead (`prisma.lead.count`, workspace-scoped); action "Import
     leads" -> `/leads`.
  4. "Launch your first campaign" -> done when any campaign was ever launched
     (`prisma.campaign.count({ where: { workspaceId, launchedAt: { not: null } } }) > 0`); action "Create campaign" -> `/campaigns`; locked until steps 1 and 3 are done with reason
     "Needs an account and leads first".
- Footer advice line (always shown in the card): `Info` 14px + "Warm new accounts for at least two weeks before
  full volume." (existing guidance, from deliverability page copy).

### B4.16 Charts (recharts)

(from: lemlist §4 thin gridlines and hollow legend markers, instantly §4 warm-up bars with spam in red,
apollo §5.2 funnel with pale remainder, customerio §4 series checklist)

- Wrapper `Figure` (existing in `analytics/charts.tsx`): card (B4.5 surface rules), header row = `h2` title +
  optional (i) + right-aligned legend; chart height 240px (160px in drawers and cards < 480px wide); the existing
  data-table alternative stays (a "Show as table" disclosure below each chart, `small` link-button).
- Axes: `axisLine={false}`, `tickLine={false}`, tick `fill: var(--chart-axis)`, 12px Plex Sans tabular; Y axis
  width 40, max 5 ticks; X axis dates "Oct 3" (workspace timezone, PS-UI-07).
- Grid: `CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 3"`.
- Lines: `strokeWidth={2}`, `dot={false}`, `activeDot={{ r: 4 }}`, `type="monotone"`; "Opened (estimated)" always
  `strokeDasharray="4 3"` and labelled "(estimated)". Areas (volume): same stroke + fill gradient from 16% to 0%
  opacity of the series color.
- Bars: `radius={[3, 3, 0, 0]}`, `maxBarSize={24}`, 4px gap; stacked warm-up bars: inbox `--success-solid`, spam
  `--danger-solid`, planned `--neutral-solid`. Funnel: horizontal bars, value + percent of previous stage at the bar
  end, remainder drawn as a pale bar (`--surface-sunken`).
- Colors come from CSS variables (`stroke="var(--chart-1)"`), replacing the hard-coded `COLORS` array, so dark mode
  works.
- Tooltip (custom `content`): `--surface-elevated`, 1px `--border`, radius 8, `--shadow-2`, padding 8px 10px; date
  `micro`; one row per series: 8px square swatch, label, value right-aligned tabular; `cursor` = 1px `--border-strong`
  vertical line (lines) or `--hover` band (bars).
- Legend: custom, above the plot: 8px square swatch (dashed outline for estimated series) + `small` label; clickable
  to hide a series only where the existing chart already supports it.
- `isAnimationActive={false}` everywhere (existing; also satisfies reduced motion).
- Accessibility: chart container `role="img"` + `aria-label` summarizing the data ("Sent per day, Oct 1 to Oct 7:
  120, 140, ..."); the table alternative is the full-fidelity version.

### B4.17 Send meter and capacity meter (signature)

**Full (sidebar, dashboard tile)**: card `--surface`, 1px `--border`, radius 8, padding 10px 12px.
Row 1: `micro` "SENT TODAY" left; state pill right (rules under "Data"): success dot "Sending", neutral
`CheckCircle2` "Done for today", or neutral "Idle". Row 2: "142 / 300" in Plex Mono 14/20 500 tabular, `--fg`. Row 3: 6px bar, radius 4, track
`--surface-sunken`, fill `--chart-1` below 100% and `--neutral-solid` at 100% (capacity reached is normal, not an
error, so the meter never turns amber or red); a 1px `--fg-muted` tick marks the workspace daily cap when one exists
(from: hubspot §4 quota marker). `role="meter"` `aria-valuemin=0` `aria-valuemax={allowance}`
`aria-valuenow={sent}` `aria-label="Sent today"` `aria-valuetext="142 of 300 sends used"`. The whole card links to
`/dashboard` (only when not on the dashboard; it is outside the Main nav, so the nav test is unaffected).

**Compact (rail, mobile top bar)**: 28px SVG ring (3px stroke, same color rules) with nothing inside, followed by
"142/300" in Plex Mono 12 (mobile top bar only); `role="meter"` with the same attributes.

**Data**: `GET /api/v1/dashboard` (existing route, returns `dashboardSummary`) fetched on mount and every 60s,
like the unread count, and again on a window event `sending:changed` that `CampaignBuilder.go` dispatches after
launch / resume / pause (same pattern as `inbox:unread-changed`). Fields used: `sentToday`, `allowanceToday`,
`remainingToday`, `workspaceCap`, `campaigns.length` (non-inactive campaigns). State rule: "Sending" when
campaigns > 0 and remaining > 0; "Done for today" when campaigns > 0 and remaining = 0 (reaching the allowance is
normal, so it is not a warning); "Idle" when campaigns = 0. The shell never invents other reasons; the campaign page's status banner explains them.
A failed fetch hides the meter (no stale numbers).

**Per-account capacity** (accounts table, deliverability, account drawer): inline 64x6 bar + "12 / 40" tabular,
same color rules; the sent / limit / left text stays exactly as the tests read it ("0 / 125 / 125").

### B4.18 Page header (`components/page-header.tsx`, new)

Props: `title`, `description?`, `status?` (ReactNode), `actions?` (ReactNode), `tabs?` (ReactNode: `SectionTabs` or
nothing; ARIA `Tabs` stay inside page bodies because they own their panels). Layout per B3.3. Renders `<h1>`.

### B4.19 Sequence step editor (campaign "Sequences" tab)

(from: close §5 single vertical lane with "Wait N days" header strip, hubspot §5.1 clickable delay band,
loops §4 node summaries and hover "+", apollo §5.3 per-step counters, lemlist §5 A/B tabs and validation outline)

```
 ┌ Step 1 ───────────────────────────── Email · 2 variants ─┐
 │ [A] [B] [+ Add variant]                       ● A active │
 │ Subject  [Quick question, {{firstName}}            ]{}   │
 │ Body     [rich text ...............................]     │
 │ Weight [1]   [x] Active   Tone [..] Offer [..] ✦ Generate │
 │                                [Preview] [Save variant]  │
 └──────────────────────────────────────────────────────────┘
          │
      ( Wait 3 days  ✎ )      <- delay pill on the connector
          │
 ┌ Step 2 ...                                               ┐
          │
      [+ Add step]
```

- Lane: single column, max-width 760px, centered on >= 1280 (left-aligned below); 2px `--border-strong` vertical
  connector between cards, 32px tall, centered.
- Step card: `--surface`, 1px `--border`, radius 12, padding 16px 20px. Header row: `h3` "Step {n}" (existing heading
  text; tests look it up by name) + summary `small` `--fg-muted` ("Email · 2 variants · 1 active") + right-aligned
  step actions (ghost `sm`). Invalid step (no active variant, empty subject or body): 1px `--warning-solid` border +
  `AlertTriangle` + text "Subject not set" / "No active variant" in the summary (from: loops §6 honest unset state,
  lemlist §5 invalid outline).
- Delay pill (on the connector, from step 2 on): height 28px, radius full, `--surface`, 1px `--border-strong`,
  `small` 13 500 "Wait 3 days" + `Pencil` 12px; activates the existing delay inputs (value + MINUTES/HOURS/DAYS
  select) in a popover (B4.13 surface) with "Save" / "Cancel". Step 1 shows "Sends when the lead starts" instead.
- Variants: chip row (segmented look, 28px): "A", "B", ... + "+ Add variant" ghost; selected chip `--fg`
  background / `--bg` text; an inactive variant chip shows `--fg-subtle` text with an "(off)" suffix;
  auto-paused variants show the existing auto-pause reason as a warning Callout.
- Fields: Subject input with a right-side `{}` "Insert variable" ghost icon button (existing `aria-label`s); body
  rich text (`components/rich-text.tsx`) min-height 160px, toolbar 32px ghost icon buttons; variables render as
  variable chips; AI generation (Tone, Offer, "Generate draft") sits in a collapsible "Write with AI" row marked
  with the AI sparkle; generated text gets the `ai` pill "AI draft" until edited.
- "+ Add step" secondary button at the end of the lane, centered.
- Per-step live counters (Sent, Replied, Bounced) in the header are **not** part of this redesign (no step stats are
  loaded on this tab); the header leaves room for them.
- Mobile: lane full width, card padding 16px, delay pill stays centered, variant chips scroll horizontally.

### B4.20 Inbox list row and thread view

(from: superhuman §4 one-line density and left bar, missive §4 row semantics and inline events, front §4 3-line
list, smartlead §5 thread timeline, close §5 inbox as a to-do queue)

**List row** (72px, padding 10px 12px 10px 16px, bottom 1px `--border`, `role` stays as today):
- Line 1: 8px unread dot (`--signal`, only when unread; `sr-only` "Unread"), sender/lead `body-strong` (600 when
  unread, 500 read), right-aligned time `kbd`-sized Plex Mono 11 `--fg-subtle` ("14:02", "Oct 3").
- Line 2: subject `body` `--fg`, truncated.
- Line 3: preview `small` `--fg-muted` truncated + right-aligned chips: reply category pill (B4.4) and campaign tag
  chip; reminder due -> warning `Clock` chip "Reminder due".
- Selected: `--signal-tint` + 3px left `--signal` bar. Hover `--hover`. Checkbox (bulk) appears at the left edge
  (always visible on touch, on hover/focus-within on desktop with `opacity` only, so it stays in the a11y tree).
- Date group headers ("Today", "Yesterday", "This week", "Older"): 28px, `micro` `--fg-subtle`, sticky inside the
  list, `--surface` background.
- "Load more" = the existing outline button, full width, at the end.

**Thread view**:
- Canvas `--surface-sunken`; header (sticky, 56px, `--surface`, bottom border): subject `h2` 18/26 600 truncated,
  pills (category, campaign), actions right: existing buttons as ghost `sm` with icons; destructive in
  `danger-ghost`.
- Messages: white cards (`--surface`, 1px `--border`, radius 12, padding 16px 20px, 12px gap): header = initials
  avatar 28px (`--surface-sunken`, `--fg-muted` Plex Mono 11), name `body-strong` + address `small` `--fg-subtle`,
  time right; outbound messages get a `micro` "SENT FROM {mailbox}" line; body via the existing sandboxed
  `message-frame`.
- Events (opened, stage changed, enrolled, rule applied, held): centered `small` `--fg-subtle` line with a 12px icon
  between messages (from: missive §4 "Rule applied [chip]").
- Composer docked at the bottom of the thread pane: `--surface`, top border, radius 12 top corners, reply mode as a
  segmented control, rich text min 120px, footer: macro select, "Manage macros" ghost, primary "Send" right. The
  existing held / disabled logic and labels stay.
- Lead panel: right column 320px at >= 1440 (`--surface`, left border); below 1440 a ghost "Lead" button in the
  thread header opens it as a drawer (B4.8).

### B4.21 Kanban column and card (CRM)

(from: pipedrive §4 column header with sum and count, twenty §4 stage pill + count, close §5 value rollup band,
pipedrive §8 rotting age pill, attio §4 colored stage dots)

- Board: horizontal flex, gap 12px, `overflow-x: auto` inside the content area, `scroll-snap-type: x proximity`.
- Column: 288px wide, `--surface-sunken`, radius 12, padding 8px, max-height `calc(100dvh - 220px)` with its own
  vertical scroll. Header (sticky in the column, 52px): 8px stage dot (Open stages `--neutral-solid`, Won
  `--success-solid`, Lost `--danger-solid`) + `h2` 14/20 600 stage name (existing heading) + count badge; line 2
  `small` tabular `--fg-muted` "$12,400 · 6 deals" in the workspace currency.
- Card: `--surface`, 1px `--border`, radius 8, padding 10px 12px, 8px gap between cards. Line 1 lead name or email
  `body-strong` truncated; line 2 company `small` `--fg-muted`; line 3: value `small` tabular, owner initials 20px,
  right-aligned next-task chip (`Clock` + due date; overdue -> danger tone; none -> warning "No next step"). Stale
  (no activity for 14 days): warning stripe + chip "14d" (from: pipedrive §8 rotting).
- Drag: lifted card `--shadow-2`, `cursor: grabbing`, placeholder 1px dashed `--border-strong` radius 8 at card
  height; drop target column gets `--signal-tint` background. The existing keyboard-accessible move control stays.
- Empty column: centered `small` `--fg-subtle` "No deals in this stage".
- Mobile: columns 85vw, `scroll-snap-align: start`, one column visible at a time with a peek of the next.

### B4.22 Automation rule card / row

(from: front §5.4 When / If / Then blocks with rule insights, close §5 sentence-style trigger, missive §5 toggle per
row with greyed disabled state)

- Rules table rows keep their table (tests read rows); the name cell shows the rule as a sentence: "When **a reply
  is classified Interested** · if **campaign is Q4 outbound** · then **move to stage Meeting**" in `small`, bold
  parts `--fg`, connectors `--fg-muted`; disabled rules render the whole row in `--fg-muted` with a neutral "Off"
  pill.
- Rule editor (existing drawer): three stacked sections titled `micro` "WHEN", "IF", "THEN", each a bordered block
  (radius 8, padding 12px) of sentence rows with inline selects; "+ Add condition" / "+ Add action" ghost buttons;
  footer "Save rule" primary, Cancel ghost (existing labels).
- Runs: status pills (OK / Failed) + relative time + the affected lead as a link.

### B4.23 Health and score indicators

- **Health ring**: 32px SVG (24px in dense rows), 3px stroke, track `--surface-sunken`, arc proportional to score,
  number centered in Plex Mono 11/16 500 (12/16 for 32px). Bands (display only; the score logic is unchanged):
  90-100 Good `--success-solid`; 70-89 Fair `--warning-solid`; 0-69 Poor `--danger-solid`; null -> dashed track,
  "-" and label "Not enough data". `role="img"` `aria-label="Health 94 of 100, good"`. Next to it the band word in
  `small` where space allows. A throttle ("Throttled to 20/day") renders as a warning chip next to the ring.
  (from: lemlist §4 score ring, instantly §4 health score column)
- **Health trend**: the existing 80x24 sparkline (`HealthTrend`), stroke `--fg-muted`, last point dot colored by
  band.
- **Progress bars** (re-warm, import, campaign completion): 6px, radius 4, track `--surface-sunken`, fill
  `--chart-1` (in progress) or `--success-solid` (complete); keep native `<progress>` or `role="progressbar"`
  elements and their names (tests use them); style the native element via `::-webkit-progress-value` /
  `::-moz-progress-bar` and `accent-color`.
- **Campaign progress ring** in the campaigns list: 28px ring of completed / total leads with the percent in Plex Mono
  10 (from: smartlead §4 progress ring), plus the existing `<progress>` kept for the accessible name where it exists.

## B5. Screen-by-screen

Conventions for every screen: `PageHeader` (B3.3) first; all existing headings, labels, `aria-label`s, button names
and asserted strings stay; "md+" marks columns hidden below 768.

### B5.1 Root `/` (`app/page.tsx`)

No UI: it redirects to `/dashboard` (unchanged). Signed-out users are redirected to `/sign-in` by the app layout.

### B5.2 Dashboard `/dashboard`

Pattern: operator's morning glance: readiness, capacity, results, what needs me. (from: lemlist §4 KPI row,
apollo §5.5 "recent activity" strip and prioritized cards, front §6 setup guide, close §9 "what needs me now")

Desktop (content left-aligned, max-width 1200px):
1. `PageHeader`: title "Dashboard", description "Today's sending, the last 7 days, and what needs you." No primary
   action.
2. Setup checklist (B4.15) while incomplete.
3. Section "Today" (`h2`, existing id): 4 stat tiles: "Sent today" as a **meter tile** (`142 / 300`, note "of
   today's allowance", tooltip text unchanged), "Remaining capacity", "Workspace daily cap" ("No cap" stays),
   "Allowance used" (existing `<progress id="allowance">` keeps its label; styled per B4.23).
4. Section "Last 7 days": 3 tiles "Reply rate", "Positive reply rate", "Bounce rate" with the existing rate tooltips
   visible as notes; bounce rate tile adds the danger stripe when > 2% (display rule only).
5. Two-column row at >= 1024 (stacked below):
   - Left (60%): "Active campaigns" card: each campaign a 56px row: name link (`body-strong`), status pill,
     28px progress ring + "{completed} of {total} leads done, {sentToday} sent today" (existing text kept inside the
     row), the existing `<progress>` restyled as a 6px bar under the row. Empty: "No active campaigns." +
     link-button "Open campaigns".
   - Right (40%): "Due now" card: tasks list (title link + lead email `--fg-subtle`), then the reminders line
     ("{n} inbox reminders due" link). Empty: "No tasks due." (existing text).
6. "Email accounts" health strip (`h2` link to `/accounts`, existing): grid of account chips (3 columns >= 1024, 2
   >= 640, 1 below): each chip 48px: health ring 24px, email truncated, status pill; problem accounts sorted first
   and carry the stripe. Copy stays "{displayStatus}, health {score}" for screen readers via the ring's label.

Mobile: everything single column; tiles 1 per row below 640 (2 per row from 640); the checklist actions become full
width under each step.
Empty (fresh workspace): the checklist is the hero; tiles show 0 values honestly; "Active campaigns" empty copy as
above.

### B5.3 Email Accounts `/accounts`

Pattern: Instantly's accounts table with warm-up as a column and a right drawer (from: instantly §5), Front's
connect tile picker (from: front §5.3), folk's sender card with last sync (from: folk §5).

Desktop:
- `PageHeader`: "Email Accounts"; description "Mailboxes that send your campaigns. Sending pauses automatically when
  an account needs attention."; actions (admins): the existing `ConnectMenu` presented as a primary "Connect
  account" button that opens a 480px dialog with three tile buttons (Google, Microsoft, "IMAP / SMTP"), each a 72px
  card (provider logo or lucide `Mail` icon, title, one-line description: "Gmail or Google Workspace via OAuth",
  "Outlook or Microsoft 365 via OAuth", "Any mailbox with IMAP and SMTP access"); unconfigured providers are
  disabled with the reason "Not configured on this server (see docs/ops/GOOGLE_SETUP.md)". The IMAP/SMTP tile opens
  the existing `ConnectSmtp` dialog (640px, B4.9). Keep every existing button label and flow.
- Toolbar: search ("Search email, name or tag"), "Status" filter select, tag select; right: "{n} accounts".
- Table columns: [checkbox] | Email (identity: email `body-strong` + from name meta; plain text, the drawer stays
  on the existing Limits / Re-warm / Reconnect buttons so no extra tab stop or button name is added) | Provider
  (md+) | Status (pill per B4.4; `title` = last error) | Health (ring from `health.score` + band word; md+) |
  "Today: sent / limit / left" (header text unchanged; cell keeps "0 / 125 / 125" text plus the 64x6 capacity bar
  under it) | Tags (chips; md+) | Actions (Pause/Resume, Re-warm, Limits, Reconnect, Disconnect (danger-ghost),
  Delete (danger-ghost); labels and aria-labels unchanged). `ApiAccount.health.score` already exists; no API
  change is needed.
- Bulk bar (existing `BulkBar`): inverse bar per B4.6 with its selects and buttons restyled as inverse controls.
- Drawer (existing `AccountDrawer`, 640px, B4.8): header = email + status pill + health ring; jump bar "Settings ·
  Sync · Domain · Warm-up · Re-warm"; sections in the existing order with `h3` titles:
  - Settings form: two-column grid of fields (one column below 768) with helper text using the recommended values
    from the deliverability guidance ("Recommended 30 per day"); boolean options as switches; Save in the sticky
    footer; the existing clamp message ("Daily limit was set to 125") stays in the footer `role="status"`.
  - Sync: last sync time, sync pill (B4.4), existing buttons.
  - Domain (`DomainSection`): `h3` "Domain: {domain}" (unchanged), DNS pill + per-record chips, the record table in
    `mono` text inside `--surface-sunken` code blocks with a copy button per value.
  - Warm-up (`WarmupSection`): top row = warm-up state pill + "Enable warm-up" switch; 30-day stacked bar chart
    (inbox / spam / planned) 160px tall; numeric fields with "Recommended" helpers; "What warm-up does" as a neutral
    Callout (honest-limits copy unchanged).
  - Re-warm (`RewarmSection`): progress bar (existing `aria-label="Re-warm progress"`) with "Day 4 of 14 · 13 per
    day" text; buttons unchanged; cancel as `danger-ghost`.
  - Test send (admins): unchanged controls in a bordered block.
Mobile: priority columns = checkbox, Email, Status, Today, Actions (icon-sm buttons); drawer full-screen.
Empty (no accounts): `EmptyState` page variant: title "Connect your first mailbox", body "RightNow sends from your
own Google, Microsoft or IMAP/SMTP mailboxes. Warm a new mailbox for at least two weeks before full volume.",
action cards: "Connect Google", "Connect Microsoft", "Connect IMAP / SMTP" (same handlers as the connect dialog;
from: attio §4 empty table with Connect buttons, folk §4 action cards). Non-admins see the title and body with
"Ask a workspace admin to connect a mailbox."

### B5.4 Warm-Up & Deliverability `/deliverability` and `/deliverability/placement`

Pattern: lemlist's deliverability hub (tabs, score rings, mailbox warm-up summary table) (from: lemlist §5),
Instantly's warm-up chart with spam in red (from: instantly §5).

`/deliverability`:
- `PageHeader`: title "Deliverability" (unchanged text); section tabs "Overview | Inbox placement"; description:
  the existing disclaimer sentence (tests read it exactly) as the description.
- Guidance: the existing 3-item list as a neutral Callout titled "Recommended limits" (text unchanged).
- Summary strip (new layout of existing data, no new queries): 4 small tiles computed from `rows`: "Accounts
  sending" (Active count / total), "Needs attention" (count, danger stripe when > 0), "Re-warming" (count), "DNS
  issues" (warn + block count).
- Table (existing columns, header labels unchanged): Account (identity, sticky) | Status (pill) | Idle days (md+) |
  Allowance ("{n} of {target} per day" + capacity bar; throttle chip) | Health (ring + existing `HealthTrend`
  sparkline) | Last 30 days (stacked `small` lines kept; md+) | DNS (pill link "DNS ok for {domain}": keep the
  accessible name pattern) | Warm-up (pill) | Warnings (warning chips, md+) | Actions (Re-warm, Resume at full
  volume; names unchanged). Rows with Needs Attention or DNS block carry the danger stripe.
- "How the score is computed": the existing `<details>` styled as a disclosure card (summary `body-strong` with a
  `ChevronRight` that rotates 90deg; list text unchanged).
- `#dns` section (when `?domain=`): `DomainSection` inside a card with `scroll-margin-top: 64px`.
- Deliverability settings (admins): card titled "Deliverability settings" (unchanged), settings rows (B4.2).
Mobile: priority columns = Account, Status, Health, Actions.
Empty: existing copy "No email accounts yet. Connect one." as `EmptyState` inline with a primary "Connect account"
link-button to `/accounts`.

`/deliverability/placement`:
- `PageHeader`: title "Inbox placement" (unchanged), same section tabs, description = the existing explanatory
  paragraph (it states the quota cost and header differences honestly).
- Run form in a card: account select + primary "Run test" (existing label) for admins.
- Results table: Seed mailbox | Provider (md+) | Folder (pill: Inbox success, Spam danger, Missing warning
  "Not found", Pending info). 
Empty: "No placement tests yet." + "Mark one of your own mailboxes as a placement seed in its account settings,
then run a test." with link "Open Email Accounts".

### B5.5 Campaigns list `/campaigns`

Pattern: Smartlead's campaign rows with progress ring and status tabs (from: smartlead §4), Close's per-row
metrics (from: close §4), lemlist's filter row with the create button right (from: lemlist §5).

- `PageHeader`: "Campaigns"; section tabs "Campaigns | Scheduled emails"; description "Sequences that send from
  your mailboxes on a schedule."; primary action: the existing create form moves into the header as an inline form
  on >= 768 (input 240px "New campaign name" + primary "Create campaign"; labels unchanged) and below 768 stacks
  under the title, full width.
- Toolbar: search, tag select; right "{n} campaigns".
- Table: [checkbox] | Name (identity: name link `body-strong` + meta "{total} leads"; md+ shows tags as chips under
  the name) | Status (pill) | Progress (28px ring + "{completed} / {total}" tabular) | Sent today (tabular,
  right-aligned) | Actions (Pause / Resume / Archive, names unchanged). Accounts Unhealthy / Bounce Protect rows
  carry the danger stripe.
- Bulk bar per B4.6.
Mobile: priority columns = checkbox, Name, Status, Actions; ring hidden (the status pill + name stay).
Empty: `EmptyState` inline: title "No campaigns yet", body "A campaign sends a sequence of emails to a lead list
from your connected accounts, inside your sending schedule.", action: focus the "New campaign name" input (ghost
button "Name your first campaign"). Filtered empty per B4.6.

### B5.6 Campaign detail `/campaigns/[id]`

Pattern: Customer.io's header that says what and whether it runs (from: customerio §5), Smartlead's tabs in the
order of work with a persistent launch button (from: smartlead §5), Loops' Guardian / Customer.io's Review(n)
pre-flight (from: loops §5.1, customerio §6), Close's run timeline semantics for status reasons (from: close §5).

- Top strip breadcrumb "Campaigns > {name}" (replaces "All campaigns"; mobile: "< Campaigns" back link above the
  title).
- `PageHeader`: title = campaign name (`h1`, unchanged text), status pill (B4.4); actions right: secondary
  "Analytics" (link to `/analytics?campaignIds={id}`, `BarChart3` icon; keep the link name "Analytics"), then the
  primary lifecycle button: "Launch" (Draft) / "Resume" (Paused, Bounce Protect, Accounts Unhealthy, Completed) /
  secondary "Pause" (Active). One primary only.
- **Sending status panel** (existing `StatusBanner`, restyled): a card directly under the header, 1px border,
  radius 12, padding 12px 16px; first line `body-strong` with a 8px dot: success "Sending" or warning "Not sending
  right now" (text unchanged); then each reason as a row with a 16px icon: blocking reasons `AlertCircle`
  `--danger-fg`, notes `Info` `--fg-muted`; reasons that point to a tab end with a link-button "Open {Tab}" that
  switches the tab (e.g. no_accounts -> Accounts, held_messages -> link to `/scheduled`). (from: customerio §6 Live
  banner, loops §5.1 checks)
- **Launch blockers** (422 issues, existing `role="alert"` box): danger Callout titled "This campaign cannot launch
  yet:" (unchanged), each issue a row with the existing FIX sentence and a link-button to the tab that fixes it;
  the count of blockers also shows as a warning dot on the matching tab (B4.7). Launch warnings: warning Callout
  (`aria-label="Launch warnings"` unchanged).
- Tabs (existing `Tabs`, labels unchanged): **Leads | Sequences | Accounts | Schedule | Options | Subsequences**
  (Subsequences only after launch, as today). Default tab stays Leads (tests start there). Order follows the order
  of work: who, what, from where, when, how.
  - Leads tab: enroll form in a card (Lead source select + primary "Enroll leads"); a stat strip "Lead status
    totals" (existing `aria-label`) as compact tiles with lead-state pills (B4.4) and counts (from: apollo §5.4
    stage-count strip); table "Campaign leads" with state pills; status filter select.
  - Sequences tab: the step editor (B4.19).
  - Accounts tab: account picker table with status pill + capacity bar per account; tag-based selection explained
    in one sentence.
  - Schedule tab: each schedule as a definition row card (Name, preset select, Days as 7 toggle chips "M T W T F S
    S" (checkboxes styled as chips, labels unchanged), From / To time inputs, Timezone) (from: lemlist §5 schedule
    rows); "Add schedule" secondary; a one-line note: "Emails are spaced across the window; backlog is never
    burst-sent." (honest constraint, principle 6).
  - Options tab: grouped settings cards with `h3` titles: "Sending" (Daily limit, Max new leads per day, gaps,
    Per-company daily limit, Prioritize new leads, Match lead's email provider, Provider routing rules), "Stopping"
    (Stop on reply, Stop on auto-reply, Stop for the whole company on reply, Bounce protection), "Tracking" (Track
    opens, Track clicks: helper "Opens are estimated: image blocking and privacy proxies distort them"), "Content"
    (Text only, First email text only, Include unsubscribe link in the footer, Opt-out message), "A/B" (Auto-optimize
    A/Z, Winner metric, Reset variant balance daily), "Other" (Campaign name, Tags, CC, BCC, Evergreen, Email risky
    addresses, Pipeline value per lead). Field labels unchanged; one primary "Save options" sticky at the bottom of
    the tab on mobile, at the end of the form on desktop.
  - Subsequences tab: list of subsequence cards (trigger sentence + steps count + status pill) using the step
    editor for their steps.
- Preview (existing `PreviewPanel` dialog, 640px): rendered email in a framed `--surface` card with From / To /
  Subject rows in `small`, lead picker select.
Mobile: header actions wrap under the title (primary full width); tabs scroll horizontally; sending panel full
width.
Empty states: Leads tab "No leads in this campaign yet. Choose a lead list or filter above and enroll them.";
Sequences tab "No steps yet. Add a first step with at least one active variant." + primary "+ Add step"; Accounts tab
"No sending accounts assigned." + link "Connect account" when none exist.

### B5.7 Scheduled emails `/scheduled`

Pattern: Apollo's email log with a "not sent reason" (from: apollo §5.1, §8), Close's runs view semantics
(from: close §5).

- `PageHeader`: title "Scheduled emails" (unchanged); section tabs "Campaigns | Scheduled emails"; description "Every
  email the sender will send, is holding, or could not confirm. Held and unknown-outcome emails are never resent
  automatically."
- ARIA tabs (existing, order and labels unchanged: Scheduled, Held, Failed, Outcome unknown, Cancelled) with
  `aria-hidden` counts when the data provides them; Held and Outcome unknown tabs show a warning dot when non-empty.
- Toolbar: search ("Search scheduled emails"); bulk bar per B4.6.
- Table (`aria-label` "{Tab} emails" unchanged): [checkbox] | Lead (email + campaign meta) | Step (md+) | Account
  (md+) | Due / sent at (tabular, workspace timezone) | Reason (Held / Failed / Unknown tabs: the reason text in
  `small`, with a pill) | Actions (Release, Cancel, Retry; names unchanged).
- Release dialog (existing, `h2` id "release-title"): 480px dialog explaining what release does; primary "Release".
Mobile: priority columns = checkbox, Lead, Due, Actions.
Empty per tab: Scheduled "Nothing is waiting to send."; Held "No held emails. Emails are held when the send outcome
must be checked by a person."; Failed "No failed emails."; Outcome unknown "No emails with an unknown outcome.";
Cancelled "No cancelled emails."

### B5.8 Leads `/leads`

Pattern: Attio / Twenty table chrome with typed columns (from: attio §4, twenty §4), HubSpot saved views
(from: hubspot §4), Front's CSV preview with inline errors in the import (from: front §5.8), Smartlead's mapping
step with "Auto mapped" pills (from: smartlead §4).

- `PageHeader`: "Leads"; section tabs "Leads | Lead lists | Blocklist"; description "Everyone you can contact.
  Unsubscribed, bounced and blocklisted addresses are never emailed."; actions: primary "Import CSV" (opens the
  existing import wizard; keep its label), secondary export link (existing outline `asChild` button).
- Saved filters (existing `saved-filters.tsx`): a row of chip buttons above the toolbar ("All leads" + saved names,
  selected chip `--signal-tint` + `--signal` text) with "Save filter" ghost at the end (from: hubspot §4 view tabs).
- Toolbar: search ("Search leads"), filter selects (list, interest, verification, label, owner), custom field
  filter (name + contains) behind a "More filters" disclosure; right: "{n} leads".
- Table (`aria-label` "Leads"): [checkbox] | Lead (name or email + company meta; opens the lead drawer) | Interest
  (pill) | Verification (pill; md+) | Lists (chips; md+) | Labels (chips; md+) | Owner (initials; md+) | Last
  activity (md+) | Actions.
- AI personalization review (existing section `h2` "Personalization to review"): a card with the `ai` marker; rows
  show the AI text in `--ai-fg` until approved.
- Bounced leads table (existing): danger-toned section card.
- Lead drawer (560px): header name/email + interest pill + verification pill; sections "Details" (form), "AI",
  "Timeline" (vertical timeline: 24px icon disc per event, `small` text, time right; from: close §5 timeline).
- Import wizard dialog (800px): progress segments for 4 steps, `h3` "Step n of 4: ..." unchanged; mapping table
  columns "CSV column -> Field -> Preview" with auto-matched rows showing a success pill "Matched"; options step
  lists suppression toggles (blocklist, unsubscribes, existing campaign leads) as switches with one-line reasons
  (from: smartlead §4 upload settings toggles); result step shows counts as tiles (imported, skipped duplicates,
  suppressed, invalid).
Mobile: priority columns = checkbox, Lead, Interest, Actions; saved-filter chips scroll horizontally.
Empty: `EmptyState` page variant: title "No leads yet", body "Import a CSV with at least an email column. Duplicates
and blocklisted addresses are skipped.", action cards "Import a CSV file" (opens wizard), "Create a lead list"
(-> `/leads/lists`).

### B5.9 Lead lists `/leads/lists`

- `PageHeader`: title "Lead Lists" (unchanged); section tabs; description "Named groups of leads you can enroll in
  campaigns."; create form inline in the header (input "New list name" + primary "Create list"; existing labels).
- Table "Lead lists": Name (link to `/leads?listId=`) | Leads (tabular) | status breakdown as a 6px stacked bar
  (verified / risky / invalid using success / warning / danger) with counts in the `title` and a `sr-only` text
  (md+) | Actions (rename "Save", delete `danger-ghost`).
Mobile: Name, Leads, Actions.
Empty: "No lead lists yet." + "Lists group leads for enrollment. Create one, then add leads from the Leads table or
an import."

### B5.10 Blocklist `/blocklist`

- `PageHeader`: title "Blocklist" (unchanged); section tabs; description = the existing paragraph (domain exact
  match; never emailed; unsubscribes, bounces, complaints added automatically).
- Add form card: textarea "One address or domain per line" + primary "Add to blocklist" (existing label); CSV
  export/import link-buttons.
- Toolbar: search ("Search blocklist"), reason filter; destructive "Clear all" as `danger-ghost` at the right
  (existing confirm).
- Table "Blocklist": [checkbox] | Address or domain (`mono`) | Reason (pill, B4.4) | Added (md+) | Actions.
Empty: "Nothing is blocked yet. Unsubscribes, hard bounces and complaints will appear here automatically."

### B5.11 Unified Inbox `/inbox`

Pattern: Missive / Front 3-pane shell (from: missive §2, front §5.1), Superhuman split tabs and row density
(from: superhuman §4), Smartlead thread timeline (from: smartlead §5), Close inbox-as-queue (from: close §5).

Desktop (>= 1024): full-height app layout: the page header is compact (title "Unified inbox" `h1` 20/28 on one
40px row with the "Open Scheduled emails" link when relevant), then 3 panes filling `calc(100dvh - 48px - 40px -
gutters)`:
1. Views pane 224px (`--surface-sunken`, radius 12): "Inbox views" nav (existing) as 36px rows with count badges
   (Primary, Others, Unread, Reminders, Sent, Scheduled, All); then filters (Mailbox, Campaign, Interest selects,
   32px); then "Saved views" list + save form.
2. List pane 360px (`--surface`, border, radius 12): search ("Search conversations") + "Has attachment" toggle
   chip; list rows per B4.20; bulk bar replaces the search row when rows are checked.
3. Thread pane fluid (B4.20), with the lead panel right at >= 1440 or behind a "Lead" button.
At 768-1023: views pane collapses into a "View: Primary" select above the list; list 320px + thread.
Mobile (< 768): one pane at a time: views as a horizontally scrolling chip row (Primary, Others, Unread, ...) +
"Filters" button opening a bottom sheet with the selects; list full width; tapping a row shows the thread full
screen with a sticky header "< Conversations" back button; composer sticky at the bottom.
Empty: list "No conversations in this view." (+ "Replies to your campaigns land here.") ; thread pane with nothing
selected: centered `Inbox` icon 40px + "Select a conversation" (`--fg-muted`). Fresh workspace: "No replies yet.
Replies from leads in your campaigns appear here, sorted by interest." with link "Connect account" when there are no
accounts.

### B5.12 CRM `/crm`

Pattern: Pipedrive's board with sums and counts per stage (from: pipedrive §5), Twenty's stage pills and side panel
(from: twenty §4), Close's lead detail timeline (from: close §5).

- `PageHeader`: "CRM"; description "Deals from interested replies, by stage."; primary "New opportunity" (existing,
  lives in the board's toolbar today; move to the header only on the Opportunities tab).
- ARIA tabs (existing labels and order): Opportunities | Tasks | Activity | Pipeline settings (admins).
- Opportunities: filters row (existing `filters.tsx` selects) + board (B4.21) `aria-label="Pipeline board"`;
  opportunity drawer (560px) with header (lead + stage pill + value), details form, "Activity" timeline.
- Tasks: table "Tasks" with due date chips (overdue danger), status pills (Open / Done / Awaiting approval), bulk
  complete.
- Activity: timeline list (24px icon discs colored by event type: email `--chart-1`, reply `--chart-2`, stage change
  `--neutral-solid`, task `--warning-solid`).
- Pipeline settings: stage list with drag handles (or the existing up/down controls) and stage kind pills; currency
  select with the lock explained ("Currency is fixed while any deal has a value.").
Mobile: board columns 85vw with snap; tasks priority columns Title, Due, Status.
Empty: board "No opportunities yet. Mark a reply as Interested in the inbox, or create one here." + primary "New
opportunity"; tasks "No tasks. Tasks you or your automations create appear here."; activity "No activity yet."

### B5.13 Analytics `/analytics`

Pattern: lemlist / Front shared filter bar (from: lemlist §5, front §5.5), Apollo KPI strip + funnel with
"directional" opens (from: apollo §5.2), Customer.io percent-over-count table cells (from: customerio §4).

- `PageHeader`: title "Analytics" (unchanged, tests check the heading); description "Results for the selected range,
  in {timezone}. Opens are estimated."; actions: existing export (secondary).
- Filter bar (existing `aria-label="Analytics filters"`): sticky under the top strip, `--bg` background: date range
  (existing "Date range" control) + campaign / account / list / owner selects (32px) + metric menu; wraps on small
  screens; a "Reset" ghost button when anything is set.
- Summary: KPI tiles (B4.5) for each metric the metric menu shows, with the existing tips as notes; "Opened" tiles
  carry "(estimated)" in the label. Funnel section as horizontal bars with the pale remainder.
- Charts: "Volume over time" (area, chart-1), "Rates over time (%)" (lines), "Funnel", "Variants (A/B)" in a 2-column
  grid at >= 1280 (1 column below), each with "Show as table".
- Tables (Campaigns, Steps, Variants, By day, Email accounts, Bounces, Revenue): B4.6 styling, two-line numeric
  cells (percent over count), totals row first with `--surface-sunken` background and `body-strong`.
Mobile: filter bar becomes a "Filters ({n})" button opening a bottom sheet; tiles 1 per row below 480px and 2 per
row from 480px; charts full width at 200px height; tables scroll inside their frames.
Empty: "No sends in this range." + "Pick a longer range or check that a campaign is active." with a ghost "Last 30
days" quick action.

### B5.14 Automations `/automations`

Pattern: Front's When / If / Then rule builder (from: front §5.4), Missive's row toggles (from: missive §5), Close's
runs history (from: close §5).

- `PageHeader`: title "Automations" (unchanged); description "Rules that act on replies, leads and deals. Built-in
  rules keep sending safe and cannot be turned off."; primary "New rule" (existing `data-opener`) on the Rules tab,
  "New webhook" on the Webhooks tab.
- ARIA tabs (existing, unchanged): Rules | Built-in | Runs | Webhooks.
- Rules: table "Rules" with sentence summaries (B4.22), Active switch per row (existing control restyled), Last run.
- Built-in: table "Built-in rules" with a lock icon and one-line description per rule (from: front §4 name +
  description first cell).
- Runs: table "Runs": time, rule, lead link, OK / Failed pill, error text in `small` for failures; "Next page".
- Webhooks: table "Webhooks" (URL in `mono`, events as chips, status pill, last delivery); editor drawer; "Deliveries:
  {url}" view with the per-day bar chart (`aria-label="Deliveries per day"` unchanged) and deliveries table with
  status pills; payload viewer in a `mono` code block with `--surface-sunken`; signing secret shown once in a
  bordered block with a copy button and a warning Callout "Copy it now. It will not be shown again."
Mobile: tables scroll; editors full-screen sheets.
Empty: Rules "No rules yet. Example: when a reply is classified Interested, move the lead to the Meeting stage." +
primary "New rule"; Runs "No runs yet."; Webhooks "No webhooks. Send events such as reply received or lead
unsubscribed to your own endpoint." + primary "New webhook".

### B5.15 Settings `/settings` and `/settings/api-keys`

Pattern: Attio's narrow settings column with hairline-separated sections (from: attio §2), HubSpot's settings rows
(from: hubspot §5.2), Front's table first cell = name + description (from: front §4).

`/settings`:
- `PageHeader`: "Settings"; section tabs "Workspace | API keys".
- Desktop >= 1024: two columns: a sticky 200px "On this page" nav (`<nav aria-label="Settings sections">`, anchor
  links: Workspace, Members, Labels, Security, AI, Email verification, Audit log; only the sections the role can see)
  and the content column max 720px. Below 1024 the anchor nav becomes a horizontal chip row at the top.
- Each existing section component renders as a card with its existing `h2` and an `id` (`workspace`, `members`,
  `labels`, `security`, `ai`, `verifier`, `audit-log`) and `scroll-margin-top: 64px`; fields as settings rows
  (B4.2).
  - Workspace: name, timezone, currency, daily cap, physical address (helper: "Printed in every campaign email
    footer. Required to launch."), unsubscribe options.
  - Members (admins): table Name/Email | Role (select) | Actions; invite form (email + role + primary "Invite");
    pending invites with expiry.
  - Labels: list of reply labels as pills with rename/delete.
  - Security: 2FA status pill (Enabled success / Off warning) + set-up flow; the TOTP QR in a bordered square with
    the secret in `mono`.
  - AI (admins): provider, model, key status (`hasApiKey` shown as "Key saved" success pill, never the key).
  - Email verification (admins): URL in `mono`, key status pill, warning Callout "Changing the host requires a new
    key." (mirrors the server rule).
  - Audit log: table with action filter (select) and "Next page"; actions in `mono`.
- Non-admin copy stays: "Only workspace owners and admins can change settings."
`/settings/api-keys`:
- `PageHeader`: title "API keys"; same section tabs; description "Keys act as a workspace member. Admin-only actions
  (connect, disconnect, delete, test-send) are not available to keys."
- "Create a key" card (`h2` unchanged): name + scope checkboxes in a 2-column grid + primary "Create key"; the new
  token shown once in a `mono` block with copy button + warning Callout.
- Keys table: Name (+ prefix in `mono` meta) | Scopes (chips, md+) | Created | Last used | Status (Active success /
  Revoked neutral outline) | Revoke (`danger-ghost`, native confirm unchanged).
Mobile: single column, anchor chips scroll horizontally.
Empty: API keys "No API keys yet. Create one to use the REST API or connect another tool."

### B5.16 Check this link `/link-check`

A safety interstitial; keep it plain. Content column max 560px, no page header tabs. `h1` "Check this link"
(unchanged). Card: line 1 `h2`-sized "This link goes to **{host}**" (host in `mono` 16px); the message's shown text
line (`small` `--fg-muted`); the full URL in a `--surface-sunken` `mono` block with `word-break: break-all`. For a
credentialed URL: danger Callout with the existing sentence and **no** Continue button. Actions: primary "Continue"
(opens in a new tab, `ExternalLink` icon) and secondary "Cancel". Invalid target: danger Callout with the existing
`role="alert"` text. Mobile: buttons full width, stacked (Continue first).

### B5.17 Auth: sign-in, sign-up, 2FA, invite (`app/(auth)/*`)

Pattern: Attio's centered onboarding card on a quiet canvas (from: attio §5), folk's paper canvas (from: folk §3).

- Layout (`(auth)/layout.tsx`): `--bg` full height, content column 400px centered vertically (top-aligned with
  15vh top padding below 768), gutter 16px. Above the card: the brand tile (40px "RN") + "RightNow" in `display`
  32/40 600 (replaces the plain text line), and below it one `small` `--fg-muted` line "Self-hosted cold email.
  Your mailboxes, your data."
- Card: `--surface`, 1px `--border`, radius 16, padding 32px (24px below 768), no shadow.
- `h1` 20/28 600 (texts unchanged: "Sign in", "Set up the owner account", "Two-factor authentication", "Join a
  workspace").
- Fields: full-width inputs 44px (`lg`), 16px gap; error line `role="alert"` (existing, keeps its min height) in
  `--danger-fg`; primary button full width `lg` (labels unchanged: "Sign in", "Create owner account", ...).
- Sign-up: the SETUP_TOKEN explanation as a neutral Callout above the form; the "Sign-up is closed" state as a
  neutral Callout with the sign-in link.
- 2FA: a single 6-digit code input, `mono` 20px, letter-spacing 0.3em, `inputmode="numeric"`,
  `autocomplete="one-time-code"`; the expiry sentence as `small` `--fg-muted` with the "start again" link.
- Invite: workspace name in `body-strong` inside the description; invalid invite as a neutral Callout.
- Links: `--signal`, underlined.
- Theme: follows the system (next-themes); no toggle on auth pages.

## B6. Accessibility

Target: WCAG 2.2 AA. The existing e2e suite (`e2e/a11y.spec.ts`) runs axe (wcag2a, wcag2aa) on every nav section
in light and dark mode, walks the tabs on /crm and /automations, and checks the skip link, focus traps and table
conventions; all of it must keep passing.

- **Keyboard.** Every action reachable by Tab in visual order; DOM order = visual order (no CSS `order` tricks).
  Skip link first (keep the existing element and classes, restyle to `--primary` / `--primary-fg`, radius 6, top
  left 8px, `--z-skip`). Tab after the skip link lands on the first Main nav link. Tabs: arrows / Home / End
  (existing). Dialogs and drawers: native `<dialog>` traps focus, Escape closes, focus returns to the opener
  (existing `data-opener` pattern). Command palette: Cmd/Ctrl+K, arrows, Enter, Escape. Mobile drawer: focus trap +
  Escape + return focus. Kanban: the existing non-drag move control stays reachable. No keyboard shortcut is
  required to use any feature; single-letter shortcuts are not introduced (they conflict with screen readers).
- **Focus.** B2.11 ring on every interactive element; never `outline: none` without replacement; sticky headers
  must not cover focused rows (`scroll-margin-top: 96px` on rows and section targets).
- **Contrast.** All text tokens meet 4.5:1 on the surfaces they are allowed on (B2.1-B2.3 tables); `--fg-subtle`
  is never placed on a tinted background; input borders, focus ring, pill dots and chart series meet 3:1. Disabled
  controls are exempt but keep `cursor: not-allowed` and a reason where a reason exists.
- **Color independence.** Every status has a word; charts add dash patterns and direct labels; deltas include an
  arrow and the text "up/down"; the signal stripe always duplicates a pill.
- **Status pills.** Plain text inside a `span`; the reason (error message) is available as `title` and in the
  drawer. Live changes that the user did not trigger (send meter, unread count) are **not** announced (no
  `aria-live` on them) to avoid noise; results of user actions keep their existing `role="status"` / `role="alert"`.
- **Meters and progress.** Send meter `role="meter"` with `aria-valuetext`; progress bars keep native
  `<progress>` or `role="progressbar"` with names (tests use them).
- **Charts.** Container `role="img"` + `aria-label` summary; full data in the "Show as table" alternative (an HTML
  table with `caption`); tooltips are supplemental only.
- **Tables.** `caption` or `aria-label` (existing), `scope="col"` headers, `aria-sort` on sortable headers,
  `aria-selected` on selectable rows, checkbox labels "Select {name}" (existing). Sticky first column must not hide
  focus.
- **Forms.** Every control has a visible `<label>` (or existing `aria-label` for compact toolbar controls); errors
  linked with `aria-describedby` and `aria-invalid`; helper text linked too.
- **Reduced motion.** `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration:
  .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior:
  auto !important } }`; shimmer and the Sending pulse are disabled; drawers appear without sliding.
- **Touch.** 44px targets below 768 (B3.6); no hover-only affordances (row checkboxes and actions are visible or
  `opacity` only, never `display: none` on hover).
- **Zoom / reflow.** Usable at 200% zoom and at 320px width without horizontal page scroll (only table frames and
  the board scroll).
- **Language and titles.** `<html lang="en">` (existing); every page sets `metadata.title` (existing).

## B7. Implementation notes for the builder

### B7.1 Tokens in `app/globals.css` (Tailwind 4)

Replace the current token block. Keep `@custom-variant dark (&:where(.dark, .dark *));`. Shape:

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --bg: #F8F7F4; --surface: #FFFFFF; --surface-sunken: #F0EFEA; --surface-elevated: #FFFFFF;
  --hover: #EAE8E2; --active-nav: #E6E4DD; --border: #E3E1DB; --border-strong: #CFCCC4; --input: #8F8B81;
  --fg: #1C1B18; --fg-muted: #5E5B53; --fg-subtle: #6B6860; --fg-disabled: #A8A59C;
  --primary: #1C1B18; --primary-fg: #FFFFFF; --primary-hover: #34322D;
  --signal: #0B6F75; --signal-tint: #E2F1F1; --ring: var(--signal); --danger-btn: #B42318;
  --success-fg: #16704A; --success-tint: #E5F3EA; --success-solid: #2E9A66;
  --warning-fg: #8A4B00; --warning-tint: #FCEFD9; --warning-solid: #B87300;
  --danger-fg: #B42318;  --danger-tint: #FCEBE9;  --danger-solid: #D92D20;
  --info-fg: #3B49B0;    --info-tint: #ECEDFB;    --info-solid: #5464D8;
  --neutral-fg: #4A4842; --neutral-tint: #EEEDE8; --neutral-solid: #8F8B81;
  --ai-fg: #6D3FB5;      --ai-tint: #F1EBFB;      --ai-solid: #8B5CD6;
  --chart-1: #0E8A90; --chart-2: #5363D6; --chart-3: #B7790B; --chart-4: #B0428F; --chart-5: #6B7280;
  --chart-6: #5E7D1F; --chart-grid: #E9E7E1; --chart-axis: var(--fg-muted);
  --overlay: rgb(28 27 24 / 0.40);
  --shadow-1: 0 1px 2px rgb(28 27 24 / 0.06);
  --shadow-2: 0 6px 20px -4px rgb(28 27 24 / 0.14), 0 0 0 1px var(--border);
  --shadow-3: 0 24px 64px -12px rgb(28 27 24 / 0.28), 0 0 0 1px var(--border);
  --dur-1: 100ms; --dur-2: 160ms; --dur-3: 220ms; --dur-4: 1200ms;
  --ease-out: cubic-bezier(0.2, 0, 0, 1); --ease-in: cubic-bezier(0.4, 0, 1, 1);
  color-scheme: light;
}
.dark {
  --bg: #121210; --surface: #1A1917; --surface-sunken: #161614; --surface-elevated: #22211E;
  --hover: #262522; --active-nav: #2A2926; --border: #2E2D29; --border-strong: #3D3B36; --input: #6B6860;
  --fg: #ECEAE4; --fg-muted: #A8A59C; --fg-subtle: #8E8B82; --fg-disabled: #5E5B53;
  --primary: #ECEAE4; --primary-fg: #121210; --primary-hover: #D6D3CB;
  --signal: #45C2C7; --signal-tint: #10302F; --danger-btn: #C2352A;
  --success-fg: #5CCB92; --success-tint: #12291D; --success-solid: #3FB57C;
  --warning-fg: #F1B24A; --warning-tint: #2D2210; --warning-solid: #E0A030;
  --danger-fg: #FF8A7E;  --danger-tint: #351713;  --danger-solid: #F0574A;
  --info-fg: #9BA5FF;    --info-tint: #1D2040;    --info-solid: #7C88F0;
  --neutral-fg: #C9C6BD; --neutral-tint: #262522; --neutral-solid: #6B6860;
  --ai-fg: #C4A2FF;      --ai-tint: #271D3A;      --ai-solid: #A985F0;
  --chart-1: #3BB9BF; --chart-2: #8592F5; --chart-3: #E3A63A; --chart-4: #E07BC4; --chart-5: #9AA1AD;
  --chart-6: #9CC255; --chart-grid: #2A2926;
  --overlay: rgb(0 0 0 / 0.60);
  --shadow-1: none;
  --shadow-2: 0 6px 20px -4px rgb(0 0 0 / 0.55), 0 0 0 1px var(--border-strong);
  --shadow-3: 0 24px 64px -12px rgb(0 0 0 / 0.70), 0 0 0 1px var(--border-strong);
  color-scheme: dark;
}

@theme inline {
  --color-bg: var(--bg); --color-surface: var(--surface); --color-sunken: var(--surface-sunken);
  --color-elevated: var(--surface-elevated); --color-hover: var(--hover); --color-active-nav: var(--active-nav);
  --color-border: var(--border); --color-border-strong: var(--border-strong); --color-input: var(--input);
  --color-fg: var(--fg); --color-fg-muted: var(--fg-muted); --color-fg-subtle: var(--fg-subtle);
  --color-fg-disabled: var(--fg-disabled);
  --color-primary: var(--primary); --color-primary-foreground: var(--primary-fg);
  --color-primary-hover: var(--primary-hover);
  --color-signal: var(--signal); --color-signal-tint: var(--signal-tint); --color-ring: var(--ring);
  --color-danger-btn: var(--danger-btn);
  --color-success: var(--success-fg); --color-success-tint: var(--success-tint); --color-success-solid: var(--success-solid);
  /* ...same three lines for warning, danger, info, neutral, ai... */
  --color-chart-1: var(--chart-1); /* ...chart-2..6, chart-grid... */
  /* compatibility aliases so existing class names keep working during the migration: */
  --color-background: var(--bg); --color-foreground: var(--fg); --color-card: var(--surface);
  --color-muted: var(--surface-sunken); --color-muted-foreground: var(--fg-muted);
  --color-destructive: var(--danger-fg);
  --font-sans: var(--font-plex-sans), ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
  --font-mono: var(--font-plex-mono), ui-monospace, "SFMono-Regular", Consolas, monospace;
  --radius-xs: 4px; --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px; --radius-xl: 16px;
  --shadow-e1: var(--shadow-1); --shadow-e2: var(--shadow-2); --shadow-e3: var(--shadow-3); /* utilities shadow-e1..e3 */
}

body { background: var(--bg); color: var(--fg); font-family: var(--font-sans); font-size: 14px; line-height: 20px; }
table, .num { font-variant-numeric: tabular-nums; }
input[type="checkbox"], input[type="radio"] { accent-color: var(--primary); }
:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { /* B6 block */ }
```

Notes:
- The compatibility aliases (`bg-card`, `bg-muted`, `text-muted-foreground`, `border-border`, `bg-primary`,
  `text-destructive`) mean the restyle can land screen by screen; delete the aliases in the last step once `grep`
  finds no uses.
- `--radius-*` in `@theme` remaps Tailwind's `rounded-xs/sm/md/lg/xl` to B2.7 (Tailwind 4's own defaults differ);
  check `rounded-xl` call sites (cards use it today and become 16px unless changed to `rounded-lg` = 12px).
- Fonts in `app/layout.tsx`: `import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google"`;
  `IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display:
  "swap" })`, `IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display:
  "swap" })`; add both `.variable` classes to `<html>`. next/font self-hosts the files at build time, so the CSP
  (nonce-based, `e2e/csp.spec.ts`) needs no new font origin; verify the CSP test still passes.
- Status pill classes come from one map (`components/status-pill.tsx`), e.g. tone `success` -> `bg-success-tint
  text-success`, dot `bg-success-solid`.

### B7.2 Restyle vs create

| File | Action |
|---|---|
| `app/globals.css` | Replace tokens (B7.1) |
| `app/layout.tsx` | Add fonts (keep ThemeProvider props, nonce) |
| `components/ui/button.tsx` | Restyle variants; add `destructive`, `danger-ghost`, `link`, sizes `sm`, `lg`, `icon-sm`; keep `default`/`outline`/`ghost` names |
| `components/ui/input.tsx`, `label.tsx`, `card.tsx` | Restyle (card radius 12, padding 20, no shadow) |
| `components/ui/select.tsx` (new) | Styled native select wrapper (B4.2); replace the repeated `h-10 rounded-md border ...` select class strings |
| `components/ui/switch.tsx` (new) | `role="switch"` checkbox (B4.3) |
| `components/status-pill.tsx` (new) | Pill + all mapping tables (B4.4); used by campaigns `status-badge.tsx`, accounts table, deliverability table, scheduled view, leads, inbox, CRM, automations |
| `components/app-shell.tsx` | Rebuild per B3.2 / B3.6 (groups, active rules for sub-routes, rail, top strip, mobile drawer, send meter); keep `aria-label="Main"`, link texts, unread badge, skip-link target, menu button names |
| `components/send-meter.tsx` (new) | B4.17 |
| `components/command-palette.tsx` (new) | B3.4 |
| `components/page-header.tsx`, `components/section-tabs.tsx` (new) | B4.18, B4.7 |
| `components/tabs.tsx` | Restyle; no-wrap scrolling; optional count/dot props |
| `components/table-kit.tsx` | Restyle `SortTh`, `Pager`, `NextPage`, `BulkToolbar`, `TagSelect`; add `TableFrame`, `TableEmpty`, `TableSkeleton` helpers only if two or more tables use them |
| `components/stat-tile.tsx` | Add optional `of`, `delta`, `trend`, `variant="meter"` props (B4.5); existing props unchanged |
| `components/empty-state.tsx` | Rewrite (B4.14) |
| `components/callout.tsx` (new) | B4.11 |
| `components/health-ring.tsx` (new) | B4.23 (+ reuse `HealthTrend`) |
| `app/(app)/analytics/charts.tsx` | CSS-variable colors, axis/grid/tooltip per B4.16 |
| Page files and client components | Use `PageHeader`, `SectionTabs`, pills, table styling per B5; remove the "Back to ..." links replaced by section tabs and breadcrumb |
| Drawers (`account-drawer.tsx`, `lead-drawer.tsx`, `opportunity-drawer.tsx`, rule/webhook editors) | Restyle the `<dialog>` as a right sheet (B4.8); add the jump bar to the account drawer |

Do not add dependencies (no Radix primitives beyond `react-slot`, no headless UI, no animation library). Do not
change APIs, data shapes or copy that tests assert, except where B5 explicitly replaces a navigation link.

### B7.3 Order of work

Each step is shippable and keeps the suite green.

1. Tokens + fonts + compatibility aliases (B7.1). Run lint, typecheck, unit tests, e2e a11y (light and dark).
2. Primitives: Button, Input, Select, Switch, Card, Label, Callout, StatusPill, Tabs, SectionTabs, PageHeader,
   EmptyState, HealthRing, StatTile props.
3. Shell: sidebar groups and active rules, top strip, command palette, send meter, collapse rail, mobile drawer.
4. Table kit + one reference table (Email Accounts) end to end, including mobile priority columns; review it at
   390px and 1440px before rolling out.
5. Screens in this order (highest daily use first): Dashboard, Email Accounts (+ drawer), Deliverability (+
   placement), Campaigns list, Campaign detail (+ sequence editor), Scheduled, Leads (+ import, drawer), Lead lists,
   Blocklist, Inbox, CRM, Analytics (+ charts), Automations (+ webhooks), Settings (+ API keys), Link check, Auth.
6. Remove compatibility aliases and leftover ad-hoc classes (`h-8 px-2 text-xs` -> `size="sm"`; repeated select
   class strings -> `Select`); grep for `bg-muted`, `text-muted-foreground`, `bg-card`, `green-100`, `amber-100`,
   `red-100`, `blue-100` until none remain.
7. Final pass: acceptance checklist below on every screen; ponytail-review on the diff.

### B7.4 Test-safety rules (from reading `apps/web/e2e`)

- `<nav aria-label="Main">` holds exactly the 10 links with exactly the PS-UI-01 labels as their text, in order
  (`auth.spec.ts`); nothing else may be a link inside it.
- The first Tab after the skip link focuses the first Main nav link (`a11y.spec.ts` keyboard test).
- The inbox nav badge keeps `aria-label="{n} unread"` (`inbox-thread.spec.ts`).
- ARIA tab accessible names must stay exact (`getByRole("tab", { name, exact: true })`): counts inside tabs are
  `aria-hidden`. Tab order of Scheduled emails (Scheduled, Held, Failed, Outcome unknown, Cancelled) is fixed (the
  keyboard test presses arrows and End). Campaign default tab stays Leads.
- Keep `window.confirm` prompts (tests accept them via `page.once("dialog")`).
- Keep all `aria-label`s on row actions, tables, filters, progress bars and dialogs; keep visible strings the tests
  assert (e.g. "0 / 125 / 125", the deliverability disclaimer, "Domain: {domain}", "Step n of 4", "How the score is
  computed").
- Only one `dialog` open at a time (tests use `getByRole("dialog")` without a name).
- Each page keeps one visible `h1`; do not add another heading with the same name as an existing one.
- Hidden-on-mobile columns use CSS (`hidden md:table-cell`), never duplicated markup.

### B7.5 Acceptance checklist (per screen)

Check every route in B5 at **1440x900** and **390x844**, in **light** and **dark**:

- [ ] Layout matches B5 for the width (panes, priority columns, sheets, sticky elements).
- [ ] No horizontal page scroll (`document.documentElement.scrollWidth <= innerWidth`); only table frames, tab
      lists, chip rows and the kanban board scroll horizontally.
- [ ] Exactly one primary (ink) button per view region; destructive actions use `danger-ghost` or `destructive`.
- [ ] Every status shows as a B4.4 pill with the mapped tone and a word; no raw Tailwind palette colors remain
      (`green-*`, `amber-*`, `red-*`, `blue-*`).
- [ ] Numbers are tabular; rates show their base or "Not enough data"; opens say "estimated".
- [ ] Empty, loading and error states render with the B5 copy (force them by filtering to nothing and by throttling
      the network).
- [ ] Keyboard: Tab order follows the visual order, focus ring visible on every control, dialogs trap focus and
      return it, Escape closes overlays, palette opens with Cmd/Ctrl+K.
- [ ] Touch targets >= 44px at 390px.
- [ ] `prefers-reduced-motion: reduce` removes slides, shimmer and the Sending pulse.
- [ ] Send meter visible (sidebar on desktop, top bar on mobile) and its numbers match the dashboard.
- [ ] axe (wcag2a, wcag2aa) reports no violations in light and dark (the e2e a11y suite).
- [ ] `npm run lint`, `npm run typecheck`, `npm test` pass; `npm run e2e` passes (on the Windows dev machine with
      `E2E_PROD=1` per CLAUDE.md).
