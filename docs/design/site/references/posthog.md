# PostHog landing page reference

Captured 2026-10-30, headless Chromium. NOTE: the homepage is a fake desktop OS (wallpaper, desktop icons, a scrollable "window"); `document` height is only 900px and the content scrolls inside a div (`.app-scroll-viewport`, scrollHeight 4451px, clientHeight 802px). I scrolled that container in 650px steps. Screenshots in specB: `posthog-s0..s13.jpg`, `posthog-m0..m2.jpg`, `posthog-extra.jpg`. Dark mode not captured.

## 1. Snapshot
- URL: https://posthog.com. Category: open-source (MIT) product analytics / dev platform, hosted-first, with a Docker "hobby" self-host.
- Positioning: "PostHog ingests and stores your analytics, errors, replays, and business data so you and your agents can query and act on it." Then "Join 500,000+ teams already shipping with PostHog."
- H1 verbatim: "Your product's context layer" ("context layer" highlighted in blue on a pale blue chip).
- Card CTAs: "Get started" (orange, primary) and "Install with AI" (white with orange edge). Menu bar CTA "Get started - free". Card above them: "Set up PostHog for free" with checks "97% of users pay us $0", "No credit card required", "Setup wizard installs PostHog for you".
- Title: "PostHog - Your product's context layer".

## 2. Page anatomy (inside the "window")
1. OS menu bar (full width, 48px, translucent sage): logo, Products, Pricing, Docs, Community, Company, More; right: "Get started - free" (orange), search, help, account icons.
2. Desktop icons (left column: Home, Self-driving product, Context warehouse, Pricing, Docs, Demo (a video thumbnail), Talk to a human; right column: About us, Changelog, Company handbook, Store, Careers, Trash) on a photographic grass wallpaper with a low-poly hedgehog on the right.
3. Window frame (~1140px wide, ~800px tall, with maximise and close buttons at the top right) containing the page.
4. Hero: logo, H1, highlighted sub (yellow marker highlights on "analytics, errors, replays," and "business data"; hand-drawn underline on "agents"), social-proof line, and to its right the "Set up PostHog for free" card.
5. Tabbed product demo (3 tabs, purple border): "Ask PostHog anything" | "Give agents product context" | "Ship with PostHog". Left: mock AI chat ("What can I help you with?", input "Why are signups growing,", model chip "Default - Claude Sonnet 5 High", suggestion chips Coding, Product analytics, SQL, Session replay, SDK setup). Right: text + CTA. Pause button top right of the pane (autoplay tabs). Second tab includes "Install the PostHog MCP"; third shows a ticket list ("P2 feat(billing) Make invoices easier to find") and "Self-driving pulls signals from: Error tracking, Session replay, Support, External tools".
6. Product strip: "Built-in tools for your agents:" marquee of Heatmaps, Replay Vision, No-code A/B Testing, Product Analytics, Session Replay, Error tracking...
7. "Social proof" H2: "Yes they actually use us, no it's not just some random engineer who tried us out 2+ years ago." A two-column logo board with headers "Colorful logos" and "'Sleek' logos" (Y Combinator, convex, TRUST, supabase, startengine, MISTRAL AI, Fireworks, Raycast, HeyGen, PostHog / AIRBUS, GOV.UK, National Design Studio, Railway, ResearchGate, LEGORA, ElevenLabs, exa, HASURA, clerk, Resend, greptile, Flow, Paper). A refresh-style toggle sits between them. "Open Customers" button.
8. "All your data, working together" H2 with copy "Whether you're analyzing customer usage or directing AI, you should be operating with the full context." Bulleted list plus a side card "Built-in, the context warehouse ships with: A data warehouse, 120+ sources/destinations, SQL editor + BI + data viz, User activity feed (CDP-lite), API, webhooks" with a hedgehog illustration. Link "Connect your first data source".
9. "Usage-based pricing" H2 with a table (Feature Flags 1 million requests/mo, $0.0001/request; Warehouse 1 million rows/mo, $0.000015/row...) and "Explore pricing".
10. "Why PostHog?": "Transparency. You can read our company handbook, our sales manual, and company strategy." "We ship fast. See our changelog." "Actually-technical support." Hedgehog at a whiteboard.
11. "Bedtime reading": list styled as files (demo.mov, Technical docs...) with a sleeping hedgehog.
12. "Shameless CTA": a parody product page: "PostHog Web, Digital download*", box art "PostHog 3000", starburst "NOT ENDORSED BY KIM K", "3 people (would have) added PostHog to their cart* *if this were a real cart", "Select your cloud: US (Virginia) | EU (Frankfurt)", "Starts at: $0 FREE >1 left at this price!!", big orange "Get started", "Hurry: 2977 companies signed up today.", G2 "Leader Small Business Spring 2023" badge, footnote "*PostHog is a web product and cannot be installed by CD. We did once send some customers a floppy disk but it was a Rickroll."
13. Page footer is the window's end; there is no conventional footer: navigation is the desktop icons and menu bar. A cookie "banner" parody sits bottom right: "Legally-required cookie banner ... PostHog.com doesn't use third-party cookies, only a single in-house cookie. No data is sent to a third party. (Ursula von der Leyen would be so proud.)" with a cut-out photo.

## 3. Visual system
- Palette: wallpaper green; menu bar and window bg sage `#EEEFE9` (body `rgb(238,239,233)`) fading to `#CFDACA`-like tint in the window; headings `#111827`; body `#4B4B4B`-ish; accent orange `#CD8407` border `#B17816`, fill `#EB9D2A` (buttons have a 1px darker border plus a 4px bottom "3D" lip); highlight yellow marker `#F7D99A`; blue `#2F80FA` for emphasised words; purple `#B62AD9` for the active tab; white cards `#FDFDF8`.
- Typography: custom "RoundHog" (rounded humanist) everywhere, including body. H1 36px / 40px, weight 800, tracking -0.9px; H2 24px / 32px, weight 700, tracking -0.6px; body 16px/24px; hero sub ~18px; buttons 16-18px, weight 400-500. The window is small so type is smaller than typical landing pages.
- Spacing: window padding ~80px sides inside a 1140px frame; section gaps ~64px; card padding 16-20px.
- Radii: buttons 6-8px; cards ~8px; window ~12px.
- Shadows: soft drop shadow on cards and the window; buttons use a hard bottom lip rather than blur.
- Backgrounds: photographic wallpaper (grass, low-poly hedgehog) behind everything; marker-highlight and hand-drawn-underline treatments on text.
- Iconography: custom filled icons for desktop items; line icons inside the app UI.
- Illustration: a hedgehog mascot in many costumes (whiteboard, desk, pyjamas, suit). The brand is the illustration.

## 4. Product imagery
- UI shown as a live HTML mockup of the AI chat, not photos: input with typewriter text, chips, and model selector. Ticket list for "Self-driving" is another mockup. Edges are cropped by the pane. Because each tab swaps the whole left mockup and the right copy, the product story is told in three beats instead of a long feature list.
- Real-company logos double as imagery (the logo board is large and playful).

## 5. Motion & interaction
- Tabs auto-advance (pause button visible top right of the pane); typewriter in the chat input ("Why are signups growing,|").
- "Built-in tools for your agents" row scrolls horizontally (clipped on both ends).
- Logo board has a refresh toggle between "Colorful logos" and "'Sleek' logos".
- Window controls (maximise, close) and desktop icons are present; I did not click them, so what they open is unverified (the OS metaphor implies other pages open as windows).
- Pricing section shows a table of per-unit prices (seen at s4); whether it is an interactive calculator was not tested.
- Cookie banner is animated (cut-out photo overlapping the card).
- Mobile degrades to a plain scroll page: no wallpaper (m0).

## 6. "How to use" and "self-host" presentation
- Homepage has no step list; the pitch is "Set up PostHog for free" with "Setup wizard installs PostHog for you" and "Install with AI". Self-host is not on the homepage at all.
- Self-host docs (https://posthog.com/docs/self-host, `posthog-extra.jpg` and text): left tree Self-host: Overview, Configure, Troubleshooting and FAQs, Support, Disclaimer, Migrate, Reverse proxy. Opens with a boxed note "A note on security and CVEs: We don't publish CVEs for PostHog... self-hosted deployments are officially unsupported". Then: "PostHog is open-source and freely available for anyone to host themselves. We offer a free Docker Compose deployment under an MIT license." Then "TLDR; There are warnings and useful information below, so we recommend reading the whole document... but there are two commands for interacting with the hobby deploy" with a code block:
  - `curl -OfsSL https://github.com/PostHog/posthog/releases/download/hobby-latest/hobby-installer`
  - `chmod +x hobby-installer`
  - `./hobby-installer`
  - CI mode: `./hobby-installer --ci --domain=posthog.yourdomain.com`
- Candour: "We don't offer any sort of guarantees around it working in certain ways on your infrastructure, and you assume all responsibility and risk".

## 7. Trust & proof
- "500,000+ teams", "97% of users pay us $0", a logo board of ~24 well-known companies, G2 badge, transparency claims (public handbook, public sales manual, changelog), "Actually-technical support" from engineers, usage-based pricing table with real unit prices.
- rightnow-ai can honestly use: transparency (public docs, roadmap, changelog), MIT licence, "no telemetry" statement if true, pricing-free statement as "$0, you pay only your server and mailbox providers", candid disclaimer on support. Cannot use: customer counts, logos, G2.

## 8. Navigation, footer, CTA cadence
- Menu bar: Products, Pricing, Docs, Community, Company, More; right: "Get started - free", search, help, account. Desktop icons duplicate key links (Home, Self-driving product, Context warehouse, Pricing, Docs, Demo, Talk to a human, About us, Changelog, Company handbook, Store, Careers, Trash).
- CTA cadence: menu bar (always), hero card (2), tab pane (1), customer logos ("Open Customers"), context warehouse link, pricing "Explore pricing", final "Get started" (big). 6-7 total, with jokes in the final one.
- Footer: none in the conventional sense; the window ends with the "Shameless CTA" and a counter ("15690631" in a seven-segment font, a visit counter parody).

## 9. Copywriting
- Voice: irreverent, self-aware, British-startup deadpan; jokes inside conversions ("Ursula von der Leyen would be so proud", "Not endorsed by Kim K"). Headlines are short, plain: "Social proof", "Why PostHog?", "Bedtime reading", "Shameless CTA". Honest labelling ("97% of users pay us $0", "self-hosted deployments are officially unsupported"). Jargon is handled with plain verbs ("ingests and stores", "query and act on it"). Sentences average 12-18 words; lots of hyperlinked phrases.

## 10. SEO
- Title: "PostHog - Your product's context layer". Meta description: "PostHog automatically diagnoses problems, fixes bugs, and generates pull requests - all without you having to prompt it." (note: the on-page hero copy and meta description diverge).
- Canonical https://posthog.com/. OG: url, type website, title, description, image (/images/og/default.png). Twitter: summary_large_image, creator and site @PostHog.
- JSON-LD: SoftwareApplication and Organization.
- Heading outline: H1 "Your product's context layer", then H2s are playful ("Social proof", "Shameless CTA"), which hurts keyword value; H3s inside widgets.
- ~135 internal links, mostly from icons and the menu; heavy use of /docs, /pricing and product pages. SEO strength comes from the sprawling product, docs and "vs" pages elsewhere on the site, not from the homepage.
- Page speed: heavy (photo wallpaper, custom fonts, video thumbnail); app-style scroll container means the browser's native scroll, anchors and "find in page" behave differently, a real SEO and accessibility cost.

## 11. Mobile (390x844)
- Collapses to a normal page: top bar with logo + chevron, "Get started - free", search, help and account icons (no desktop icons or wallpaper wash; the window fills the screen with a close "X" in the corner). H1 centred and wraps in two lines at ~36px; sub centred; the "Set up PostHog for free" card is full width; the cookie banner occupies about 40% of the first viewport and covers the primary button (`posthog-m0.jpg`). Tap targets ~44px.

## 12. Verdict
Done well, ranked:
1. A single tabbed product demo (3 tabs, autoplay, pause button) that tells the product in three beats. Adapt: three tabs "Send" / "Warm up" / "Reply" with an HTML mockup for each, a pause control, and no autoplay under `prefers-reduced-motion`.
2. Honest, funny microcopy that carries trust ("97% of users pay us $0", a candid self-host disclaimer). Adapt: "$0. You pay your server and your mailbox providers, nothing else." and "Self-hosted means you are the sysadmin."
3. Hobby-deploy self-host doc: three shell lines and a CI flag. Adapt to the rightnow-ai Compose path: clone, `cp .env.example .env`, `docker compose up -d`.
4. Marker-highlight and hand-drawn underline on key words in the sub copy: a cheap way to make scannable emphasis. Adapt with CSS `background: linear-gradient(...)` and an SVG underline.
5. Mascot as brand. A small recurring character or logo mark would help a new project feel owned; only worth it if drawn consistently.

Weak or avoid: the OS-in-a-window metaphor breaks native scroll, deep links, find-in-page and reading flow, and degrades SEO; the cookie banner jokes obscure content on mobile; section titles like "Social proof" or "Bedtime reading" have no keyword value; there is no real footer; huge logo board and "500,000+ teams" are not claimable; the hero meta description does not match the visible hero.
