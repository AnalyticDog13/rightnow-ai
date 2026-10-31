# Supabase (supabase.com) - landing-page reference

Captured 2026-10-30, headless Chromium, desktop 1440x900 + mobile 390x844. Height 7,691 px desktop / 9,876 px mobile. Screenshots: `scratchpad/specC/supabase-d00..d09.jpg` (viewed d00, d02, d07, d08), `supabase-m00..02` (viewed m01), `supabase-extra`. Light theme served to headless; the site also supports dark (not captured). Hero is much shorter than other references: sections after the product grid are partly lazy/animated so some details come from the heading outline.

## 1. Snapshot
- URL https://supabase.com; category: open-source Postgres backend platform (self-hostable).
- H1 verbatim: "Build in a weekend / Scale to millions" (second line in green). Right-hand subhead (not centered): "Start your project with a Postgres database. Add Authentication, Data APIs, Edge Functions, Realtime Data, Storage, and Vector embeddings."
- CTAs: "Start your project" (green filled) and "Request a demo" (white outlined). Nav: GitHub star count pill "114.3K", Sign in, Start your project. Closing section repeats headline "Build in a weekend, scale to millions" (first half grey) with same two buttons.

## 2. Page anatomy
1. Nav (64 px, sticky, white, 1 px bottom border): logo, Product, Developers, Solutions (dropdowns), Pricing, Docs, Blog; right: GitHub icon + "114.3K", Sign in (outlined small), Start your project (green small).
2. Hero (~450 px): 2-column; H1 left (46/46 px, weight 500, Manrope, no tracking), subhead right; buttons beneath H1. Plenty of whitespace (about 130 px above).
3. Product bento (~900 px): grid with big card "Postgres Database" (elephant outline icon, checklist "100% portable / Built-in Auth with RLS / Easy to extend"), "Authentication" (scrolling email-chips visual), "Edge Functions" (CLI chip `$ supabase functions deploy` over a wireframe globe), then second row of 4 small cards: Storage, Realtime, Vector, Data APIs. Each card: 16 px/600 title, description with the key phrase in black and rest grey ("Store, organize, and serve **large files**, from videos to images."). Closing line "Use one or all. Best of breed products. Integrated as a platform."
4. "Trusted by fast-growing companies worldwide": logo strip (Lovable, mozilla, PwC...).
5. Dashboard section H3 "Stay productive and manage your app without leaving the dashboard" with pill tabs (Table Editor / SQL Editor / RLS Policies) switching a browser-framed UI mock (traffic-light dots), which loads blurred then sharpens.
6. "Use Supabase with React" framework picker; "Kickstart your next project with production ready templates"; "How industry leaders are building with Supabase" (case-study cards).
7. "Join the community": masonry of real social posts (X posts from @SteinlageScott, @BowTiedQilin etc.), faded at top and bottom.
8. "Open source from day one": left copy "Supabase is built in the open because we believe great developer tools should be transparent, inspectable, and owned by the community. Read, contribute, self-host. You're never locked in, and always in control." + "View on GitHub" (outlined button with GitHub icon); right a faint pixel/dotted illustration.
9. Closing CTA ("Build in a weekend, scale to millions").
10. Compliance row: "We protect your data. More on Security" + check marks "SOC2 Type 2 Certified", "HIPAA Compliant", "ISO 27001 Certified".
11. Footer: logo + 6 social icons + "Get product updates and news from Supabase." email field + Subscribe; 6 columns Product, Solutions (~25 links), Resources, Developers, Community, Company; includes Humans.txt / Lawyers.txt / Security.txt.

## 3. Visual system
- Light: body oklch(0.995 0 0) (#fdfdfd), text oklch(0.1 0 0) (near black), muted grey ~#6b6b6b; borders 1 px ~#e6e6e6. Green accent oklch(0.525 0.12 157.5) (~#17795a-ish forest green) for buttons (8 px radius, 8x16 padding, 14/500) and H1 second line; logo uses brighter green gradient.
- Type: Manrope for display/headings (H1 46/46, weight 500; card titles 16/24 600), Inter body 16/24 weight 450; Source Code Pro in code chips. Heading style is light/medium and relaxed vs. others.
- Layout: content max ~1,088 px (x=176..1264); cards with 1 px border, ~16-24 px radius, no shadow; 16-20 px grid gaps; section dividers are hairlines that run edge to edge with small cross marks at intersections.
- Backgrounds: white; very light grey wireframes/globes; pixel-dither illustrations; blurred-to-sharp image reveal.
- Iconography: thin outline icons 20 px next to card titles; mono feature illustrations in light grey.

## 4. Product imagery
Real Studio UI in a macOS-style window frame with three grey dots, tab-controlled; image is initially blurred and focuses when scrolled into view. Mini-visuals in cards are abstract (email chips, globe, elephant) rather than screenshots, keeping the page light. Readable because each card shows one idea plus a literal artifact (a CLI command, email addresses).

## 5. Motion & interaction
- Pill tabs under the dashboard heading switch UI mock (Table Editor / SQL Editor / RLS Policies); cursor arrow animates inside the mock (visible mid-form in d02).
- Blur-to-sharp reveal as the frame scrolls into view; community posts fade at top/bottom edges; Authentication card scrolls email chips horizontally; globe wireframe in Edge Functions card.
- Nav dropdown menus on hover; sticky nav; "Skip to content" button (accessibility). Reduced-motion behaviour not verified.

## 6. Self-host / get started
- Home page has only the "Open source from day one" block with "View on GitHub"; self-hosting is one word in "Read, contribute, self-host." No install snippet on the landing page.
- https://supabase.com/docs/guides/self-hosting/docker : left sidebar "Self-Hosting: Overview, Deploy with Docker, Accessing Postgres, Configure new API keys, Learn about API Gateway, Add Reverse Proxy with HTTPS, Upgrade to Postgres 17, Remove superuser access, Update your deployment" then how-to guides (Functions, S3 Storage, MCP, OAuth, SAML, Restore from Platform...). Page: "Self-Hosting with Docker - Learn how to configure and deploy Supabase with Docker." / "Docker is the easiest way to get started with self-hosted Supabase. It should take you less than 15 minutes to get up and running." Contents list: Before you begin, System requirements, Installing Supabase (Quick start (Linux), Manual installation), Configuring and securing Supabase, Starting and stopping, Accessing Supabase services, Updating, Uninstalling, Advanced topics. "Before you begin" states assumptions: "Linux server administration basics / Basic git usage / Docker and Docker Compose / Networking fundamentals (ports, DNS, firewalls). If you're new to these topics, consider starting with the managed Supabase platform for free." Requires Git + Docker per OS. Clean order: requirements -> install -> configure & secure -> start/stop -> access -> update -> uninstall.

## 7. Trust & proof
GitHub stars in nav (114.3K), logo strip, case studies, real social posts, SOC2 / HIPAA / ISO 27001 row, Security/Humans/Lawyers.txt. rightnow-usable: GitHub stars (live, once real), real quotes/issues from users only if they exist, security.txt, security model summary (encryption, no limit circumvention). No compliance claims.

## 8. Navigation, footer, CTA cadence
Nav: 3 dropdowns + Pricing/Docs/Blog; GitHub stars in nav is the single best open-source signal. 89 internal links. CTA appears in nav, hero (2), and closing (2); open-source section has its own GitHub button. Footer: 6 columns, email newsletter, audience pages (AI Builders, Vibe Coders, Startups, Agencies...), "Switch from Firebase / Switch from Neon" migration pages.

## 9. Copywriting
Short, parallel, pragmatic: "Build in a weekend / Scale to millions". Feature lines: "Easily write custom code without deploying or scaling servers." Bolds the key phrase inside a grey sentence (reading hierarchy in one line). Jargon (RLS, Postgres, Vector) used without apology because audience is developers; always paired with a plain verb.

## 10. SEO
- Title "Supabase | The Postgres Development Platform"; description "Build production-grade applications with a Postgres database, Authentication, instant APIs, Realtime, Functions, Storage and Vector embeddings. Start for free." Canonical https://supabase.com. Full OG + Twitter (800x600 image with alt text, twitter:site/creator).
- JSON-LD: Organization, WebSite, SoftwareApplication, Service.
- Headings: H1 split across two lines; product names as H2s (Postgres Database, Authentication...); H3 for story sections. Heavy long-tail internal linking from footer: "Switch from Firebase", solution pages by persona, "Hosted Postgres". Good model for "Switch from Instantly" page.

## 11. Mobile
Hamburger; hero stacks; bento cards become a full-width single column with 12 px gaps (m01); tap targets generous; logo strip scales down to 3 across; page is 9.9k px. Left padding ~28 px. Nothing broken, but the dashboard mock shrinks to illegible text.

## 12. Verdict
Strong, borrowable:
1. GitHub star count in the nav (pill with icon): immediate open-source credibility. Adapt directly (fetch live count at build time).
2. Docs structure of the self-host guide: "Before you begin / assumed knowledge" + requirements + quick start + manual + configure/secure + start/stop + update + uninstall; "less than 15 minutes" stated promise (only if we measure it).
3. Sentence style with the key phrase in black and the remainder grey inside each feature card.
4. Pill tabs switching one UI frame (Inbox / Campaigns / CRM).
5. "Open source from day one" block copy: "Read, contribute, self-host. You're never locked in, and always in control."
6. Footer "Switch from X" pages and security.txt/humans.txt links.
Avoid: lots of logo/testimonial/compliance rows, "Start your project" funnel, self-host buried to one word on the landing page (we should do the opposite), blurred-loading frames hurt perceived quality in screenshots/no-JS.
