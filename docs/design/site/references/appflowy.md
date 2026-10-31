# AppFlowy — landing page reference (primary inspiration)

## 1. Snapshot
- URL: https://appflowy.com/ · captured 2026-10-30 (Chrome, 1920-wide desktop and 390x844 mobile)
- Category: open-source, self-hostable workspace (Notion alternative)
- Positioning: "Self-hosted AI Workspace for Enterprise Teams"
- Hero: H1 "Self-hosted AI Workspace for Enterprise Teams", with "Self-hosted" underlined by a hand-drawn
  purple→orange brush stroke. Subhead: "Bring projects, wikis, and teams together with AI".
- CTAs: primary "Self-host AppFlowy" (near-black filled), secondary "Get started free" (white, hairline border).
  Under them a row of three purple text links split by thin dividers: "What's new in 0.14.11 | Get templates | More platforms".
- Announcement bar (lavender `#EBDDFB`-ish, full width): "What's New: AppFlowy launches v0.14.11  Learn more".

## 2. Page anatomy (top to bottom, ~10,000px tall at desktop)
1. Announcement bar (54px), version-release news.
2. Sticky white nav: logo left; Product, Download ▾, Resources ▾, Pricing, Self-host; right "Contact sales" (outline) + "Start for free" (filled).
3. Hero: centred H1 (2 lines), subhead, two CTAs, link row. Very generous top spacing (~150px).
4. Hero product mockup: a wide app window (macOS traffic-light dots) showing a real-looking Kanban "Project Tracker"
   with sidebar. Animated named cursors ("Mathieu", "Olivia") drift across it, implying live collaboration.
5. Logo marquee: "Trusted by teams and individuals from" + auto-scrolling logos (Amazon, Atlassian, ByteDance, Cisco, Columbia, Cornell…).
6. Feature tabs: five big pill tabs ("AI Search", "Knowledge Base", "Projects", "AI Meeting Notes", "Docs"); the active one
   is near-black and the others pale gray `#F3F3F5`. Each tab swaps an H2 ("Get answers in seconds, grounded in your sources.")
   and a large rounded panel with a soft pastel gradient background (peach→pink) holding a UI mockup surrounded by
   floating integration tiles (Google Drive, YouTube, Calendar) that hover slightly off the window edge.
7. **Dark self-host section** (bg `#0D091C`, thin 1px vertical/horizontal guide lines with small square corner markers like a
   blueprint): H2 "Built for teams who own their stack", sub "Your infrastructure. Your data. Your rules."
   Left: vertical list of selectable cards in a monospace font ("Deploy anywhere →", "On-prem and local AI",
   "Complete data sovereignty", "Integrations & architecture", "Centralised admin panel"); the active one has a white border
   and a white icon tile. Right: a terminal window (purple/pink/yellow dots) on a dotted-grid panel showing
   `# Deploy AppFlowy to Kubernetes` and real `helm` commands in yellow monospace, then an H2 ("On-prem, cloud, air-gapped")
   + muted paragraph that changes with the selected card. Scrollytelling: scrolling advances the active card.
8. Horizontal card carousel on lavender-white (`#F5F6FD`): "Work anywhere, on any device", "Open core, built together",
   "Migration without compromise", with round arrow buttons.
9. "More productivity, fewer tools": the heading fills from gray to ink as you scroll (scroll-linked text reveal), followed by a
   **savings calculator**: dark card, "Team size" stepper (− 100 +) and slider (1 / 500 / 1000 users) driving two huge numbers
   "$25k Monthly savings" / "$302k Annual savings".
10. "Works with tools you already use": integration logo tiles.
11. Stats band in a white card: "8M+ Downloads · 1M+ Docker Pulls · 75K+ Github Stars · 20K+ Community Members" (huge 80px numerals).
12. Testimonials ("Trusted by a growing community", "Chosen for the way work gets done").
13. "Enterprise-grade security and control": three checklists with purple checkmarks (Data control & governance, Flexible
    administration, Scalable infrastructure) beside 2x2 compliance badge cards (SOC 2, GDPR, HIPAA, ISO 27001) on a glassy gradient.
14. Final CTA "Get started for free".
15. Black footer card with 36px radius inset from the page edges: logo + Discord/YouTube/X/GitHub icons; columns
    Company, Download, Resources, **Compare (vs Notion, vs Confluence)**, Support.

## 3. Visual system
- Text ink `#140F28` (rgb 20,15,40: a violet-tinted near-black, used for H1/H2 and primary buttons). Body muted `#5A5A5A`.
- Backgrounds: white, and a very pale lavender wash `#F5F6FD` with faint radial gradient blobs; dark sections `#0D091C`.
- Accent: purple `#8B5CF6`-family for links, check icons and the slider; the brand mark is a 4-petal multicolour logo (purple, cyan, pink, yellow) that recurs as a tiny colourful accent while the UI around it stays neutral.
- Type: Inter everywhere (next/font). H1 56px/68px, 700. H2 40px/48px, 600. Body 16px/24px. Buttons 16px (hero) / 14px (nav).
  Monospace (ui-monospace stack) used deliberately for the self-host section labels and terminal: it signals "engineering".
- Radii: buttons 8px; large panels ~24-32px; footer 36px. Cards have hairline borders `#E6E6E6` and very soft shadows.
- Width: content max 1280px (some sections 1440px), 984px text column in places.
- Decoration: hand-drawn underline on the key word, blueprint guide lines in dark sections, dotted grids behind terminals, pastel gradient panels behind screenshots.

## 4. Product imagery
- Mockups are high-fidelity recreations of the real app inside a light window frame, not raw screenshots: crisp at any width,
  allows animated cursors and hover states. Floating integration tiles break the window edge for depth.
- Each feature tab pairs one UI mockup with one pastel gradient, so the page feels colourful while the UI stays neutral.

## 5. Motion & interaction
- Named multiplayer cursors gliding over the hero mockup (loop).
- Logo marquee (continuous, linear).
- Tabs that swap headline + panel (crossfade).
- Scrollytelling list in the self-host section; terminal content changes per item.
- Scroll-linked heading colour fill (gray → ink) on big statements.
- Carousel with arrow buttons.
- Calculator: stepper + range slider recompute big numbers live (the most "fun" element: the reader plays with it).
- Stats likely count up on enter.

## 6. How-to-use / self-host presentation
- Self-hosting is the *first* CTA, not buried. The dark "own your stack" section shows real deploy commands (helm) in a terminal
  frame, so an engineer can judge effort at a glance. Labels in monospace. Each deploy option ("Deploy anywhere", "On-prem and
  local AI") is a selectable card with an arrow.

## 7. Trust & proof
- Logo marquee, big community stats (downloads, Docker pulls, GitHub stars), testimonials, compliance badges.
- rightnow-ai can honestly use: MIT license, the public repo, test count / CI status from the README ("about 1,290 automated
  tests"), "your data never leaves your database", tech stack logos (Postgres, Docker, Next.js). It must NOT use customer
  logos, download counts or compliance certificates it doesn't have.

## 8. Navigation, footer, CTA cadence
- Sticky nav with two CTAs always visible. Self-host CTA appears in hero, in the self-host section and the footer area.
- Footer "Compare" column with "vs Notion", "vs Confluence" pages is an SEO play for "alternative" searches.

## 9. Copywriting
- Short possessive triplets: "Your infrastructure. Your data. Your rules." Headlines in sentence case with a deliberate line
  break before the payoff ("Get answers in seconds,\ngrounded in your sources."). Benefits first, tech second.

## 10. SEO
- Title "Self-Hosted AI Workspace for Enterprise Teams | AppFlowy" (keyword first, brand last).
- Meta description 1 sentence with the category + key nouns. OG + Twitter large image 1200x630 with alt.
- JSON-LD `@graph` with Organization (with `alternateName`s) and more. `robots=index, follow`.
- One H1; H2 per section; comparison pages linked from the footer.
- Weakness: several H2s are duplicated in the DOM (animated split text), which dilutes the outline.

## 11. Mobile
- Nav collapses to a hamburger; the announcement bar shortens ("What's New: v0.14.11").
- Hero CTAs become full-width stacked buttons (~48px tall); the link row stacks vertically.
- Hero mockup scales down as a whole (text becomes tiny but it reads as "a real app"). No horizontal overflow (scrollWidth 390).
- Compliance cards go 2x2, checklists stay single column.

## 12. Verdict
Best, borrowable:
1. Self-host as the primary CTA, with a near-black button and a calm white secondary.
2. Dark "own your stack" section: selectable monospace cards + terminal with real commands. Ideal for rightnow-ai's
   `git clone` / `.env` / `scripts/start.sh` / VPS flow.
3. Neutral UI mockups set on soft pastel gradient panels, plus floating tiles that break the frame.
4. Hand-drawn underline on the one key word of the H1.
5. Play-with-it calculator. For rightnow-ai it could be a "send capacity planner" (mailboxes × daily limit × warm-up ramp),
   which is honest because the numbers come from the user's own inputs, not invented savings.
6. Footer "Compare" column for SEO.
Avoid: pricing/contact-sales/start-for-free CTAs (rightnow-ai has no hosted plan), customer logos and inflated stats,
duplicated heading DOM, compliance badges.
