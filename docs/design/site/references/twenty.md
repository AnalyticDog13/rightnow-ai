# Twenty (twenty.com) - landing page reference

Captured 2026-10-30, headless Chromium 1440x900 and 390x844. Screens `specA/twenty-d00..d13.jpg` (14 shots; I viewed d00, d03, d06, d11 and m0; the rest came from DOM text), `twenty-m0..m3.jpg` (m0 viewed). Extra URL https://docs.twenty.com/developers/self-host/capabilities/docker-compose fetched as text. The page contains a lot of lazy-rendered animated imagery; some blocks were still blank (grey/black placeholders) when screenshotted (d03 bottom, large dark rectangle), so those show as empty here.

## 1. Snapshot
- URL https://twenty.com. Category: open-source CRM (self-host or cloud).
- Positioning: build a custom enterprise CRM on an open platform, "at AI speed". Title tag claims "#1 Open Source CRM".
- H1 (verbatim): "Build your Enterprise CRM at AI Speed"
- Subhead: "Twenty gives technical teams the building blocks for a custom CRM that meets complex business needs and quickly adapts as the business evolves."
- CTAs: "GET STARTED" (black, uppercase mono, notched corner) + "TALK TO US" (outline, notched). Header: "LOG IN", "GET STARTED", GitHub star badge "60.2K", Discord badge "7.4K".

## 2. Page anatomy (approx 17k px desktop)
1. Header (~64 px, transparent on #f4f4f4/white): black rounded-square logo "20", nav PRODUCT | RESOURCES v | CUSTOMERS | PRICING (uppercase 12px mono, separated by thin vertical ticks), then github icon "60.2K ↗" and discord icon "7.4K ↗" (indigo arrows), LOG IN (outline), GET STARTED (black).
2. Hero (1,109 px, bg #f4f4f4): H1 60px serif "Aleo" weight 300 (light slab serif, d00), subhead 16-18px grey, two buttons, then a macOS-style window (1,040 px wide, traffic lights) holding the real Twenty app: sidebar (Apple workspace, Home, Favorites "Sales Dashbo...", Workspace: Companies, People, Opportunities, Tasks, Notes, Dashboards, Workflows) and a Companies table with logos (Anthropic, Linkedin, Slack, Notion, Figma, Github, Airbnb, Stripe, Sequoia), URL pills, Created By avatars, Address, Account Owner, ICP True/False. Behind the window, to its left and right, indigo (#4838e0-ish) halftone bar-chart "skyline" art pixelated horizontally (d00). A floating bottom card shows tabs "Editor | AI Chat".
3. Spacer/transition (201 px, white).
4. "A custom CRM gives your org an edge, but building one comes with tradeoffs" (724 px, white): two H3 columns: "The Giant Monolith" and "The In-house Burden" (the problem framing).
5. "Assemble, iterate and adapt a robust CRM, that's quick to flex" (891 px): H3 triplet "Production grade quality", "AI for rapid iterations", "Control without drag".
6. Sticky stepped feature section (2,828 px, bg #f4f4f4): H2 "Begin with production-grade building blocks" then steps "Begin with production-grade building blocks" / "Continue iteration without friction" / "Stay in control with our open-source software" with a vertical progress indicator on the left (dots and an indigo 3 px bar with the step number "03"), large light-serif step heading (48px) and a grey paragraph on the left, and an image stage on the right 660 px wide (halftone background with a white app card, d06). Copy for step 3: "Don't get locked into someone else's ecosystem. Twenty's developer experience looks like normal software, with local setup, real data, live testing, and no proprietary tooling." Other stage content includes a terminal chip "~/code/my-twenty-app" (green on pale green, mono 13px) showing a developer-flow CLI.
7. "Make your GTM team happy with a CRM they'll love" (1,028 px, white): H3 trio "Familiar, modern interface", "Live data and AI built", "Fast path to action".
8. "Dev teams power company-wide change with Twenty" (2,520 px, #f4f4f4): H2 centered at ~56px; H3 trio "Ship a product on Twenty", "Own your CRM end to end", "Grow with a flexible foundation"; three customer-story cards (d03): "W3villa used Twenty as a production-grade framework for the data model, permissions, authentication, and workflow engine they would otherwise have rebuilt themselves." (VP of Engineering, W3villa Technologies); "Alternative Partners used agentic AI to compress what would typically be weeks of Salesforce migration work into something a single person could oversee." (Principal and Founder, Alternative Partners); "AC&T moved to a self-hosted Twenty instance with no vendor risk, no forced migration, and CRM costs reduced by more than 90%." (CRM Engineer, AC&T Education Migration). Each card: halftone figure image top (blue-indigo), dotted rule, quote, role | company, arrow square button. Beneath: a large testimonial slide "They are the real sales" with "The flexibility is really what made the difference. Our needs evolve very fast..." (d11).
9. Spacer (880 px, #f4f4f4).
10. Dark CTA (1,366 px, #1c1c1c): "Stop fighting custom. Start building, with Twenty".
11. FAQ (1,080 px, dark): accordion of 7 questions: "Is Twenty really open-source?", "How long does it take to get started?", "Can I migrate from Salesforce or HubSpot?", "Do I need a developer to customize Twenty?", "Can developers extend Twenty with code?", "Does Twenty work with Claude, ChatGPT, and Cursor?", "What does Twenty cost?" (FAQPage JSON-LD).
12. Footer: Sitemap (Home, Product, Pricing, Customers, Partners, Why Twenty), Help (Developers, User Guide, Release Notes, Halftone generator), Legal (Privacy Policy, Terms and Conditions, Trust Center), Connect (LinkedIn, GitHub, Discord, X), "TALK TO US" and "GET STARTED" buttons, "© 2026 - TWENTY".

## 3. Visual system
- Colors: text #1c1c1c; page bg alternating #ffffff and #f4f4f4; dark section bg #1c1c1c; muted grey ~#6b6b6b; accent indigo/electric blue (halftone art, arrows, progress bar, step number, small bullet) about #4a38f5 (visually estimated; not measured); green only in the terminal chip (#2f7468 on #eef4f1, border #d3dfd9); hairlines ~#e0e0e0.
- Type: three families: "Aleo" light slab serif for H1/H2 (H1 60px/66px/300/-1.2px; H2 48px/56px/300/-0.96px), "Host Grotesk" for body (16px, #1c1c1c) and quotes (~24px), and a mono (uppercase, 12-13px, letter-spaced ~0.08em) for nav and buttons ("GET STARTED"). Mixed light serif plus mono is the brand signature. UI mock uses Inter 13px.
- Buttons: dark #1c1c1c fill with a "notched" bottom-right corner (clipped diagonal), radius ~4px on other corners; outline button same notch; square arrow buttons with the same clip.
- Layout: container ~1,360 px with 40 px gutters; 3-column card grids with 1px borders; hairline vertical dividers and plus-marks in the sticky section.
- Backgrounds: flat tints; halftone dithered figures (horizontal bar "pixel" art in indigo or grey) as the sole decoration; no gradients; section edges have a trapezoid "tab" notch (d11 shows the grey-to-white bottom edge with a trapezoid cut).
- Iconography: simple 1.5px line icons in the mock (building, user, target, check-square, note, dashboard), colored per object.
- Illustration style: halftone raster of people/objects, generated by their own "Halftone generator" tool (linked in footer).

## 4. Product imagery
- Real product UI (not mockups of the concept): the actual Twenty table with live-looking data, framed with traffic lights, 1,040 px wide, partly clipped at the bottom by the next section. Tabs "Editor | AI Chat" hint at the in-product AI. Stage images in the sticky section show simplified app cards (skeleton lines + a few real labels like "SESSION RECORDING", "EVENTS") over halftone textures. Readability: high-contrast white card on grey; real brand logos in rows.

## 5. Motion and interaction
- Halftone art animates (bars grow and shift) on scroll; a stepped progress indicator (dots, indigo bar, step number "03") follows the scroll in the sticky section; right-side stage cross-fades between three images.
- Testimonial slider with arrow buttons. Header badges (GitHub/Discord) with arrows. FAQ accordions. Buttons have the notched shape; hover states not measured.
- Mobile: burger replaces nav; hero window scales down and shows a rail of colored icons (m0).

## 6. How to use / self-host
- The landing page does not show install steps. Its self-host proof is in the story ("AC&T moved to a self-hosted Twenty instance...") and in FAQ answers. The self-host guide (docs): https://docs.twenty.com/developers/self-host/capabilities/docker-compose. TOC: Overview / System Requirements / Option 1: One-line script / Option 2: Manual steps (Step 1: Set Up the Environment File, Step 2: Obtain the Docker Compose File, Step 3: Launch the Application, Step 4: Access the Application) / Configuration / Expose Twenty to External Access (Understanding SERVER_URL, SSL Requirements, Configuring SERVER_URL, Considerations) / Persistence / Backup and Restore (Create a Database Backup, Automate Daily Backups, Restore from Backup, Backup Best Practices) / Troubleshooting / Managed Hosting.
- Copy worth emulating: "Docker containers are for production hosting or self-hosting. For contributing, please check the Local Setup." "Important: Only modify settings explicitly mentioned in this guide." Requirements: "RAM: Ensure your environment has at least 2GB of RAM. Insufficient memory can cause processes to crash." "Docker & Docker Compose: Make sure both are installed and up-to-date."
- One-liner: `bash <(curl -sL https://raw.githubusercontent.com/twentyhq/twenty/main/packages/twenty-docker/scripts/install.sh)`; pinned: `VERSION=v2.38.1 bash <(curl -sL ...)`, "VERSION must be a full release tag published on Docker Hub... Aliases such as v2 or latest are not accepted."
- Manual: `curl -o .env https://raw.githubusercontent.com/twentyhq/twenty/refs/heads/main/packages/twenty-docker/.env.example`, then `openssl rand -base64 32` to generate the key, with the warning "Losing ENCRYPTION_KEY means losing access to every secret stored in the database (OAuth tokens, application variables, TOTP secrets, etc.)". Very close to rightnow's own env and key-rotation story.

## 7. Trust and proof
- GitHub star count 60.2K and Discord members 7.4K in the header (live-looking badges), "#1 Open Source CRM" in the title, three named customer cards with specific outcomes (">90% cost reduction"), Trust Center link, a full-width testimonial. rightnow: use the star/discord (or Discussions) badges once real; use the "Trust Center"-style honest "Security" page (encryption, SSRF guard, no telemetry); do not use customers.

## 8. Navigation, footer, CTA cadence
- Header: PRODUCT, RESOURCES v, CUSTOMERS, PRICING + stars + chat + LOG IN / GET STARTED. Sticky (visible in every shot). Only 29 internal links on the whole page, so it is a lean site.
- CTA cadence: header x2, hero x2, dark closing block, footer x2. Three GitHub/Discord appearances (header, footer).

## 9. Copywriting
- Voice: confident B2B, developer-leaning. Formula: "<Do thing> at AI speed", "Stop fighting custom. Start building, with Twenty". Problem-first framing: "A custom CRM gives your org an edge, but building one comes with tradeoffs" with named pains ("The Giant Monolith", "The In-house Burden"). H3s in threes. FAQ answers the money question openly ("What does Twenty cost?"). Mentions "open-source" in step headings, not only in the nav. Jargon (data model, permissions, workflow engine) used without explanation, aimed at technical teams.

## 10. SEO
- Title "Twenty | #1 Open Source CRM". Meta description "The #1 Open Source CRM for modern teams. Modular, scalable, and built to fit your business." Canonical https://twenty.com/. og:title/description same, og:image /images/og/default.png, og:type website, twitter summary_large_image. JSON-LD: FAQPage only (no SoftwareApplication/Organization found). One H1, 5 H2s, ~20 H3s (mostly benefit sentences). Keywords: "open source CRM", "custom CRM", "Salesforce / HubSpot migration". Dedicated pages: /why-twenty, /customers, /partners, /releases; migration FAQ is the "alternative to" capture. No "X vs Y" pages observed; 29 internal links.

## 11. Mobile (390 px, m0 viewed)
- Header collapses to logo + black "GET STARTED" (notched) + a bordered burger button (44px square). H1 wraps to 3 lines at ~44px, subhead 18px, two stacked-inline buttons, then the app window rendered at full width with horizontally clipped table (sidebar becomes an icon rail with colored icons). Gutters ~20px. Tap targets 48-56px tall. No obvious overflow (nothing measured beyond the viewport).

## 12. Verdict
Executed well (ranked):
1. A real product window in the hero (actual data table with sidebar and brand-logo rows). Adapt: show rightnow's own Companies/Leads/Inbox views (the repo already has the redesigned CRM card UI) in a window frame using seeded sample data labeled "sample data".
2. Honest self-host guide: requirements first (2GB RAM), a one-line install, a manual path, backup/restore, upgrade, troubleshooting, plus an explicit warning about losing ENCRYPTION_KEY. Adapt: rightnow's page needs a "Run it in 3 commands" strip that links to docs/ops/LOCAL.md and VPS.md with a visible `ENCRYPTION_KEY` warning.
3. GitHub-star and Discord badges with arrows inside the header; zero extra sections needed for open-source credibility.
4. Problem-first section with two named pains, then a 3-point answer; adapt as "Instantly bills per seat and holds your leads / rightnow runs on your server".
5. Distinct brand: light serif + mono + notched buttons + halftone art, and a home-made "Halftone generator" to produce assets. Cheap, ownable.
6. FAQ with FAQPage JSON-LD answering "Is it really open source?" and "What does it cost?" directly; adapt (answer: MIT, free, you pay for your own server and mailboxes).
Avoid / weak:
- Cutesy hero claim "Enterprise CRM at AI Speed" is vague; rightnow should state the concrete job (cold-email, warm-up, inbox, CRM).
- Heavy lazy-rendered halftone images left blank grey/dark boxes in screenshots (d03, d11): ensure above-the-fold reserved space and a static fallback (no blank slabs, CLS risk).
- Customer story cards and "#1 open source CRM" claim: not allowed without evidence.
- Thin page for SEO (29 internal links, one JSON-LD type), no comparison pages; rightnow should add "instantly alternative" content and SoftwareApplication schema.
- Sections too long (2,800 px sticky blocks) and the dark 1,366 px CTA is mostly empty.
