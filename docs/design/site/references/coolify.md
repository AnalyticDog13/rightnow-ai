# Coolify (coolify.io) - landing-page reference

Captured 2026-10-30, headless Chromium, desktop 1440x900 + mobile 390x844. Height 6,120 px desktop / 11,851 px mobile. Screenshots: `scratchpad/specC/coolify-d00..d07.jpg`, `coolify-m*`, `coolify-mmenu`, `coolify-extra`. No bot wall.

## 1. Snapshot
- URL https://coolify.io; category: open-source self-hosted PaaS (the product is self-hosting).
- Positioning: open-source alternative to Vercel, Heroku, Netlify and Railway.
- H1 verbatim: "Self-hosting with superpowers." (period rendered in yellow #facc15-ish). Subhead: "An open-source and self-hostable alternative to Vercel, Heroku, Netlify and Railway. Deploy websites, databases, web applications and 360+ one-click services to your own server."
- Pill above H1: "Open source and free forever. Read our philosophy ->".
- CTAs: "Start with Cloud" (filled purple) and "Self-host for free" (ghost, server icon). Nav CTA "To Cloud". Under CTAs counters: "3,953+ customers on Cloud", "525,532+ self-hosted instances", then text tabs "Screenshots / Videos / Building in live streams / Features".

## 2. Page anatomy
1. Nav (56 px, sticky, blurred): logo + wordmark, links Philosophy, Pricing, Services, Docs, Changelog, Contributors, Sponsor us, Merch; right "Community 21k+" (Discord) and purple "To Cloud".
2. Hero (~600 px): centered, 60/60 px H1 weight 600, tracking -1.5 px; soft purple radial glow behind.
3. Product screenshot (~900 px): framed dark dashboard window ("production" project resource list with statuses Running/Exited/Restarting, sidebar), button "View all 6 screenshots" opens a lightbox; caption "Projects and environments. Every application, database and service of an environment in one list, with status, domain and server."
4. "HOW IT WORKS" eyebrow + H2 "Push your code. Coolify does the rest." sub "Coolify builds every commit and ships it to any server you connect over SSH." Diagram: `git push` node -> Coolify node ("build . deploy . proxy", purple outline glow) -> dashed lines to three server cards (hetzner-vps, raspberry-pi, aws-ec2) with animated yellow dots traveling the lines and tiny bar sparklines.
5. Sponsors (~1,900 px, the longest block): "Coolify is free because of our sponsors" + "No paywalled features and no investors. These companies keep the project independent and open source. Please check them out." "Become a sponsor" button. Tiers: HUGE SPONSORS 8 (large 3-col cards with logo, name, one-liner, arrow), BIG SPONSORS 34 (logo wall 5 across), SMALL SPONSORS 44 (inline avatar+name chips wrapping), "...and many more on GitHub Sponsors."
6. "FEATURES" eyebrow + "Everything you need to ship": 4-col card grid of ~28 features (MCP server for AI agents, Any language, Any server, Any use case, Any service, Flexible builds, One-click databases, Free SSL certificates, Webhooks, Push to deploy, Powerful API, Real-time terminal, Collaborative, Pull request deployments, Scheduled tasks, Environments & shared variables, Server automations, Cloudflare Tunnels, Automatic database backups, Monitoring, Log drains, Notifications, 2FA & single sign-on, No vendor lock-in, Instant rollbacks); a few cards span 2 columns (backups full width; lock-in and rollbacks half width). Each: 36 px purple-tinted icon tile, 14 px/600 title, 4-line grey text.
7. Footer (~700 px): columns PRODUCT, GUIDES, COMMUNITY, COMPANY. Guides include "Deploy on your own VPS", "Self-host Postgres with backups", "Coolify vs alternatives", "Coolify vs Dokploy", "Vercel alternative", "Heroku alternative", "Netlify alternative" (programmatic SEO pages in the footer).

## 3. Visual system
- Dark. bg oklch(0.1448 0 0) (~#0a0a0a), text oklch(0.96 0 0) (~#f4f4f4), muted ~oklch(0.77 0 0). Cards ~white 4-6% fill with 1 px ~white 8% border. Purple accent oklch(0.4965 0.2709 289) (~#6d17f0) for primary buttons; yellow dot as period/pulse accent; green/red/amber status dots in screenshot.
- Type: Geist Sans (everything), Geist Mono (counters, code, diagram labels). H1 60/60, 600, -1.5 px. H2 30/36, 600, -0.75 px. Body 16/26. Eyebrows 12 px uppercase tracked grey. Buttons 14/20, 500.
- Spacing: section padding ~100-120 px; content width ~1120 px (x=160..1280); 16 px gaps in grids.
- Radii: buttons 6 px (mobile nav button 8), cards 8-12, hero window 12, pills full.
- No shadows; purple glow behind the Coolify node and hero. No grid/noise.

## 4. Product imagery
Real, unedited dashboard screenshot, big, with fake-free realistic example data; lightbox with 6 screenshots plus separate "Videos" tab. Readable because the window is full content width, dark-on-dark with hairline frame, and a one-sentence caption explains what the screen is.

## 5. Motion & interaction
- Deploy diagram: traveling yellow dots along dashed connectors, bar sparklines pulse (continuous CSS/SVG loop).
- Hero text-tabs (Screenshots/Videos/Live streams/Features) scroll to or switch content; lightbox on screenshot.
- Cards: hover lifts border. Mobile menu: full-width slide-down list with all links stacked and the purple "To Cloud" button at the end (coolify-mmenu.jpg).
- Reduced-motion behaviour not verified.

## 6. Self-host / get started
- Hero button "Self-host for free" is a primary path; counters ("525,532+ self-hosted instances") reinforce it.
- Docs page https://coolify.io/docs/get-started/installation ("Start with Self-hosted"): collapsible "The short version": "Coolify needs 2 CPU cores, 2 GB RAM, and 10 GB disk space to run. If your server meets this specification, you can install Coolify by using this install script:" then code `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash` (copy button) and "Once the installation completes, it will print the next steps in your terminal, so follow them."
- "Before you begin" is a two-column table (Section | Check): "1. Server requirements - Confirm you have a server or device with SSH access." "2. Supported operating systems", "3. Minimum hardware requirements", "4. Server resources for your projects", "5. Configure SSH access and firewall". Then "Choose installation method" (automated vs manual). Right-rail "On this page", GitHub star badge (65.3K) and Discord badge in header, "Copy Markdown / Open" buttons, dark-mode toggle, onboarding tooltip "Explore other parts of the docs", Carbon ad card.

## 7. Trust & proof
Self-hosted instance count, Discord count (21k+), GitHub stars (65.3K in docs header), sponsor wall (86 sponsors), contributors page, public changelog, "building in live streams". rightnow honest equivalents: GitHub stars, contributors, changelog, CI status, "no paywalled features, no investors" (true for us), sponsor/credits only if real. Avoid made-up instance counts.

## 8. Navigation, footer, CTA cadence
Nav 8 text links + Community + To Cloud (no dropdowns). 112 internal links. CTA cadence: nav button, hero pair, mention of "Start with Cloud" in mobile; no mid-page CTAs except "Become a sponsor". Footer: 4 columns incl. "Coolify vs ..." and "X alternative" links, legal links.

## 9. Copywriting
Plain, slightly jokey ("(oh nooo)" in the lock-in card), short factual feature blurbs, "Any language / Any server / Any use case / Any service" parallel sets. Values stated bluntly: "No paywalled features and no investors." Jargon explained in-line in docs.

## 10. SEO
- Title "Coolify - Self-hosting with superpowers"; **no meta description tag** (only og:description: "Self-hosting platform with superpowers. Deploy apps, databases & 360+ services to your ser..."); canonical https://coolify.io; OG image 2400x1260 with alt "Coolify: self-hosting with superpowers. Open-source alternative to Vercel, Heroku and Netl..."; twitter:card summary_large_image, twitter:site @coolifyio. **No JSON-LD.**
- Single H1; H2s only 3; ~28 H3s for features (keyword-rich: "Free SSL certificates", "Pull request deployments").
- Footer links to dedicated "Vercel alternative", "Heroku alternative", "Netlify alternative", "Coolify vs Dokploy" pages: the pattern rightnow needs for "instantly alternative".

## 11. Mobile
Hamburger; menu drops full-width list. Hero text centered, buttons stack. Page grows to 11.8k px because 4-col grids become single column and sponsor wall wraps. Tap targets large (44+ px). Dashboard screenshot shrinks (text unreadable) rather than being cropped.

## 12. Verdict
Strong, borrowable:
1. "Self-host for free" as a first-class hero CTA plus short-version install in docs: adapt to hero buttons "Run it yourself" (to the install section) and "View on GitHub".
2. Requirements table ("Section | Check") and "The short version" collapsible: adapt to Node/Docker, RAM, ports, mailbox prerequisites for rightnow.
3. Git push -> engine -> servers diagram with moving dots: adapt to "CSV -> planner -> your mailboxes" showing the quota/freshness gate and no-burst sending.
4. Footer "X alternative" / "X vs Y" link block for SEO ("Instantly alternative", "Smartlead vs rightnow") - only with honest, factual comparisons.
5. Feature grid with 25+ concise cards and bento-spanning exceptions.
Avoid: 1,900 px sponsor wall (no sponsors), "Cloud" CTA and pricing (none), counters we can't back, missing meta description and JSON-LD.
