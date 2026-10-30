# Superhuman (email client) - UI reference

Scope note: Superhuman's real app requires login and is not publicly viewable. This spec is built only from the marketing/changelog product renderings that were actually viewed (stylised UI mockups, not live HTML). Anything measured from the live marketing pages is exact; anything read off the mockup images is marked "(est.)". Settings, sequences, CRM, analytics and warm-up screens were NOT observed (Superhuman Mail has none of them as far as these sources show). help.superhuman.com, Mobbin and saasui.design were not tried/viewed.

## 1. Sources

URLs viewed:
- https://superhuman.com/ (home; hero is now "Superpowers, everywhere you work", Mail + Docs + AI suite)
- https://superhuman.com/apps/mail (Mail product page)
- https://new.superhuman.com/reminders-split-338113 (Headway changelog entry "Reminders Split", May 19)
- Product images: superhumanstatic.com `apps-mail__3_.png`, `SH_Mail_Respond_Faster.png`, `SH_Mail_Follow_Up_On_Time.png`, `SH_Mail_Ask_AI.png`; cloud.headwayapp.co `942-184d...png` (reminders split).

Screenshots (in `C:\Users\willi\AppData\Local\Temp\claude\C--Users-willi-OneDrive-Desktop-GitHub-Repositories-rightnow-ai\f8a7d979-9487-46fe-b300-dcca3fab7b2a\scratchpad\screenshots\superhuman\`):
`mail-top.png`, `apps-mail-3.png` (split inbox + Ask AI, light), `respond-faster.png`, `follow-up.png` (auto reminder + Auto Draft, dark), `reminders-split.png` (changelog page), `reminders-split-img.png` (Reminders split, dark), `ask-ai.png` (Ask AI draft panel, dark), `home.png`, `mail-mobile.png` (390px marketing site, NOT the iOS app).

## 2. Information architecture and navigation

Observed only through mockups of the inbox:
- No persistent sidebar is shown in the inbox. The shell is a single centred column. The only chrome is a hamburger icon (3 horizontal lines) at the far left of the split-tab row, which opens the folder/label menu on demand.
- Top of the inbox = "Splits" tab row with counts: `Important 7 | Calendar 3 | Docs 8 | Other 1` (light mockup); `Important 4 | Reminders 5 | Other 23` (dark mockup, after the "Reminders Split" feature). The active tab is full-contrast dark text; inactive tabs are mid-grey; counts are small, lighter and sit baseline-right of each label.
- Splits are the primary navigation: the inbox is auto-partitioned (Important, Calendar, Docs, Other; optionally Reminders) so the user triages one bucket at a time. Splits are user-toggleable ("Turn on the Reminders split").
- Ask AI is a floating panel anchored bottom-left of the inbox (light mockup) or a left-docked pane with a vertical rail (dark mockup). In the rail: round "ai" avatar button, then a pill containing mail and calendar icons (app switcher between Mail and Calendar).
- Marketing nav (live): logo + wordmark "SUPERHUMAN", links `Products v, Solutions v, AI v, Resources v, Pricing v, Love`, right side `Contact sales` + outlined `Sign in v`. A dismissible-looking banner above it: "Looking for Superhuman Mail? [Learn more ->]".
- Command palette, workspace switcher, breadcrumbs: not observed (the product is known for Cmd+K; not seen here).

## 3. Visual language

Live-measured (marketing pages):
- Font: "Super Sans VF" (custom variable sans), fallback system-ui/-apple-system/Segoe UI/Roboto. Body text colour `#292827` (rgb 41,40,39), warm near-black, not pure black. Weights are unusual variable values: 460 (headings and body, i.e. slightly above regular), 540 (eyebrow/label, e.g. "Mail" at 18px), 600 (buttons), 700 (footer headings).
- Type scale (mail page): H1/H2 45.6px / 460; H3 29.6px / 460; eyebrow 18px / 540; FAQ questions and body 16px / 460. Home hero headline is much larger (~90px est. at 1920 width), centred, white on sky photo.
- Changelog page font: "Graphik Web", 15px, text `#47525D`, white bg.
- Colours: primary purple `#714CB6` (rgb 113,76,182) used for the CTA "Install Mail for Chrome" (radius 12px, padding 6px 20px, 16px/600 white text) and for outline "Get the suite" text. Section backgrounds alternate warm off-white `#F2F0EB` (rgb 242,240,235), deep violet `#281647`, white, and dark maroon `#421D24`. Hero CTA "Get Superhuman": near-black navy pill (~#17142E est.) with a gradient (violet to pink-red) square arrow chip, 12px radius.
- Backgrounds on marketing: full-bleed sky photography with pastel gradient (blue to pink to lavender) and a thin white circle plus dashed guide lines framing the app mockup (blueprint feel).

From mockup images (est.):
- Light inbox: white card on a pastel sky gradient; row hover/selected = very pale lavender-grey (~#F1F2F8) with a 3px lilac-blue left accent bar (~#9B9AE0). Sender text near-black ~#1A1A1A, subject same weight, preview text light grey (~#8A8A8A).
- Dark inbox: card ~#1E1E20 on near-black, rounded ~14px corners with a 1px lighter border; selected row ~#2A2A2D with the same lilac left bar; unread marker = pink-lilac dot (~#D68AD4) left of sender; text off-white. Ask AI panels in dark use deep indigo (~#302B4F) with a lighter-border card and a teal-green "Auto Draft" label (~#3FC9A0) and pink/blue/lilac gradient for the "Ask AI" wordmark and the AI answer card outline.
- Label chips (light mockup): small filled rectangles, ~3px radius, white lowercase text: `recruiting` pink (~#F58FB3), `signature` salmon (~#F2998A), `travel` sky blue (~#4DB5F0). Always lowercase, no border, no icon.
- Density: inbox rows approx 64px tall at 2x mockup scale, i.e. ~32px real rows (est.); generous, one-line rows; sender column ~20% width, then subject, then grey preview inline on the same line.
- Radii: cards/panels ~14-16px, buttons 12px, chips ~3px, input ~4px.
- Depth: no drop shadows in the mockups; separation is by tone and 1px borders. Light card sits on gradient with no visible shadow.
- Iconography: thin 1.5-2px line icons (hamburger, close X, compose/pencil-in-square, chat bubbles, sidebar-toggle panel icon, mail envelope, calendar "31"). Illustration: photography and pastel gradients, no spot illustrations.

## 4. Components

- List rows (inbox): single line = [unread dot] + sender (semi-bold) + [label chip] + subject + preview (grey, truncated with ellipsis or hard clip). Selected row = tinted bg + left accent bar. No visible checkboxes, column headers, pagination or bulk-action bar in the mockups; selection is keyboard-driven. A small outlined speech-bubble icon before a subject (e.g. "Final contract signature needed") marks a thread/reply state.
- Tabs (Splits): text-only tabs, no underline or pill; active = darker colour; counts as muted superscript-sized numerals. Spaced ~40px apart (est.).
- Chips/badges: see section 3; coloured by label category.
- Chat/AI panel: header "Ask AI" with gradient wordmark + close X (light) or action icons (new chat pencil, history bubbles, collapse panel) (dark); user message in a grey-bordered/filled bubble right-aligned; AI answer in a card with a gradient (cyan to violet) 1px outline; input "Ask a question" with a blue-violet left caret/bar and a circular stop/send button at right (round purple icon with white square).
- Inline suggestion card (Auto Draft): translucent indigo card overlapping the bottom of the list card, title "Auto Draft to Maria" with "Auto Draft" in green; body is the proposed message in 3 short lines. Above it, a system row in the list: "Auto reminder returned".
- Buttons: primary = solid purple #714CB6, 12px radius, 16px/600; hero = dark pill with gradient icon chip; secondary = outlined 1px white (on dark) / purple text (on light), 12px radius.
- Modals, toasts, tables, forms, charts, kanban, empty states: not observed.

## 5. Key screens

**Split inbox (light, apps-mail-3.png / respond-faster.png).** One white card ~66% of the mockup width, tab row at top (~70px tall), then 6 rows. First row selected (lavender + left bar). Columns: sender at x~0-20%, label+subject from ~30%, preview trailing. Ask AI floating panel (~340px wide est.) overlaps bottom-left of the card, containing a user prompt ("find time with James after I land and before the tetron meeting") and an AI reply ("I found a slot ... I'll schedule a meeting then."). Primary action: act on the highlighted row from the keyboard; secondary: ask AI. Hierarchy: tabs > sender names (bold) > subjects > previews.

**Reminders split (dark, reminders-split-img.png).** Tabs `Important 4 | Reminders 5 | Other 23`, active = Reminders. Five rows each with a pink unread dot, bold sender, subject. Purpose: separates "needs follow-up" from new mail. Direct analogue for a follow-up/needs-reply bucket in rightnow-ai.

**Auto reminder + Auto Draft (follow-up.png).** A thread mini-list ("Maria: Thanks for sending that over...", "Me: Hi Maria, did you get a chance to review...", then a system line "Auto reminder returned") and an AI-written follow-up draft card below. Message: if nobody replied, the thread resurfaces and a draft is prepared for one-click send. Direct analogue of a sequence follow-up step.

**Ask AI draft (ask-ai.png).** Left-docked panel: prompt "draft recruiting email based on candidate's LinkedIn + Head of Design job description"; result shown as an email card (To: Alex, bold subject "Join us in designing the future of work!", body "Hi Alex, ..."), fading out at the bottom (gradient mask) to imply more.

**Marketing home / mail page.** Mail page: white header 100px tall with logo, then warm off-white `#F2F0EB` hero, two-column 50/50: left eyebrow "Mail", 45px H1 "The most productive email app ever made", 18px lead, purple CTA; right the mockup in a rounded gradient frame. Sections below: three feature blocks (Respond faster to what matters / Follow up on time, every time / AI that sounds like you), FAQ accordion (5 items), closing CTA "Reclaim your inbox today".

## 6. Interaction patterns

- Keyboard-first (known product trait; no shortcut overlay was visible in the sources, so specific keys are not documented here).
- Progressive AI: a draft appears as a suggestion card the user accepts, rather than sending automatically; "Auto reminder returned" is shown as a system event in the thread.
- Triage by buckets (splits) with counts instead of filters and checkboxes.
- Real-time feedback: unread dots, counts on tabs, reminders surface as a new tab count.
- Onboarding/setup checklists, inline editing, hover states: not observed.

## 7. Responsive / mobile behavior

- Marketing site at 390px: banner shrinks to a single line with outlined "Learn more ->"; nav collapses to a hamburger; centred hero stays; CTA keeps the dark pill with gradient arrow chip (about 320px wide); hero photo goes below the text. This is the website only. The iOS app screens were not shown on any viewed page. In-app mobile behaviour: not observed.

## 8. Ideas worth borrowing for rightnow-ai

- Split the unified inbox into auto-buckets with counts as text tabs: `Replies | Interested | Out of office | Bounces | Needs follow-up | Other`. Count muted next to each label, active tab full contrast, no underline.
- A dedicated "Needs follow-up / Reminders" split that resurfaces threads with no reply, with an "Auto reminder returned" system row in the thread and an AI-drafted follow-up card ("Auto Draft to X") offering one-click send. Maps to sequence follow-ups.
- Single-line dense inbox row: unread dot, bold sender, coloured lowercase label chip (campaign name / lead status), subject, grey preview. Selected row = faint tint + 3px left accent bar in the brand colour.
- Lowercase flat chips with category colours (pink/salmon/sky) for campaign, status or label; no borders or icons, ~3px radius.
- Warm near-black text (#292827) and warm off-white sections (#F2F0EB) instead of pure black/white and cold greys; one saturated accent (#714CB6 purple) for primary actions.
- A right-side or left-docked assistant panel with a gradient-outlined answer card to draft replies or sequence copy; dark variant: indigo panel on near-black.
- Keep chrome minimal: hamburger-only menu, no persistent sidebar, in the inbox; for rightnow-ai keep a slim sidebar for the many sections but let the inbox view be this clean.
- Use tonal separation and 1px borders instead of shadows; 12px button radius, ~14px card radius.

## 9. Why it works

Superhuman's UI works because it removes everything that is not the next decision: one column, one-line rows, a handful of tabs with counts, a single accent colour, and warm neutral text that is easy on the eyes. Hierarchy is created almost entirely with contrast and weight (active tab vs muted, sender bold vs preview grey) rather than with boxes, shadows or icons, so the eye lands on names and subjects first. Small coloured chips add scannable categories without clutter, and the left accent bar makes the current row unmistakable for keyboard use. The purpose is obvious at a glance, because the mockups and copy always show the same story: sort the inbox, answer fast, never miss a follow-up, and let AI draft it, with the follow-up reminders and AI drafts presented as natural rows and cards inside the inbox rather than separate tools. The consistent type (one custom variable family at 460 weight), generous spacing and few colours make it feel calm and premium while staying dense enough for power users. Caveat: this judgement rests on marketing mockups, not the live authenticated app.
