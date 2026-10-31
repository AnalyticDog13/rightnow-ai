# Plausible Analytics landing page reference

Captured 2026-10-30, headless Chromium, 1440x900 and 390x844. Homepage height 6425px. Screenshots in specB: `plausible-d0..d8.jpg`, `plausible-m0..m2.jpg`, `plausible-extra.jpg`.

## 1. Snapshot
- URL: https://plausible.io. Category: open-source (AGPL) web analytics, cloud-first with a Community Edition.
- Positioning: "Plausible is powerful, lightweight analytics. No cookies, just insights. Made and hosted in the EU, powered by European-owned infrastructure."
- H1 verbatim: "Easy to use and privacy-friendly Google Analytics alternative" ("Google Analytics alternative" is set in the accent colour on line 2).
- CTAs: primary "Start free trial", secondary "View live demo" (white button, accent text). Nav: "Login", "Start free trial".
- The H1 is the exact search phrase being targeted ("Google Analytics alternative"). Same pattern rightnow-ai wants for "Instantly alternative".

## 2. Page anatomy
1. Nav (transparent on `#F9FAFB`, ~100px): logo, "Why Plausible" (mega dropdown), "Resources" (dropdown), "Pricing", then "Login" and "Start free trial".
2. Hero (centered, ~266px of text): H1, 2-line sub, two buttons (58px tall, 16px/40px padding).
3. Dashboard "screenshot" in a browser frame, 1088px wide, ~850px tall, overlapping the hero background into the white section below (see d0, d1). Real product UI: KPI strip (Unique visitors 952k, Total visits 1.6M, Total pageviews 6M, Views per visit 3.78, Bounce rate 42%, Visit duration 7m 28s), a 91-day area chart, then two tabbed tables (Channels / Sources / Campaigns and Top pages / Entry pages / Exit pages) with horizontal bar fills and real source icons (Google, ChatGPT, GitHub, DuckDuckGo).
4. "Why use Plausible Analytics?" H2 (30px) + sub, then a 4-column x 2-row feature list with green check icons, bold title and 3-5 line description: Automatic scroll depth tracking, Monitor traffic from AI tools, Analyze SEO performance, Measure paid ads and campaigns, Real-time dashboard, Codeless goals and revenue tracking, Funnels and user journeys, Built-in bot filtering. ~628px.
5. "People (heart) Plausible" H2 + sentence "From small sites to hundreds of millions of monthly visitors, Plausible is trusted by thousands of organizations, including Stripe, Mozilla, MongoDB, Harvard University and Sentry." Then 3 stats in indigo (22k Paying subscribers, 332B Events stored, 99.99% Uptime (Last 90 days)) divided by hairlines, then a 3-column masonry of 6 tweet-like testimonial cards (Clem Delangue, DHH, John O'Nolan, Cyrus Shepard, Rob Hope, Laura Roeder) with avatar, name, role. ~806px.
6. "It's time to ditch Google Analytics" long-form prose section (680px reading column, 18px/32px) with H3s: "Simple analytics at a glance", "Lightweight script that keeps your site speed fast", "No need for cookie banners or GDPR consent". Inline links go to keyword landing pages (Google Analytics alternative, simple web analytics, lightweight web analytics). ~1372px. This is SEO copy presented as editorial.
7. Pricing: "Traffic based plans that match your growth", Monthly/Yearly toggle ("2 months free"), 4 plan cards (Starter, Growth, Business, Enterprise) with pageview slider. ~760px.
8. Closing band: "Ready to ditch Google Analytics? Start your free trial today" (second line in accent), two buttons right-aligned. 208px.
9. Footer (dark navy, 4 link columns).

## 3. Visual system
- Palette: page bg `#F9FAFB` (body `rgb(249,250,251)`); text `#252F3F` (body), headings `#161E2E`; accent indigo `#5850EC` (`rgb(88,80,236)`) for buttons, highlighted H1 words, stat numbers; success green for check icons and trend arrows; footer bg ~`#252F3F` navy with muted `#9FA6B2` links; chart line indigo with a light indigo gradient fill; bar fills in the tables use light blue and light amber.
- Typography: system UI stack (`system-ui, -apple-system, ... Segoe UI, Roboto`), no web font in the page body. H1 48px / 48px line height, weight 800, letter-spacing -1.2px. H2 30px / 36px, weight 800. H3 ~24px, weight 600-700. Body 16px/24px; sub copy 18-20px. Buttons 16-18px, weight 500.
- Spacing: max widths 1280px (hero, feature grid) and 1120px (proof, prose), side padding 16-32px; sections separated by ~64-96px; prose column ~680px.
- Radii: buttons 6px, dashboard frame ~12px, cards 8px.
- Shadows: soft large shadow under the dashboard frame (`0 25px 50px` style), subtle small shadow on the white "View live demo" button.
- Backgrounds: flat. The hero tint drops to white midway down the dashboard image, so the image appears to straddle two sections.
- Iconography: green checkmarks only; no decorative icons. Logo is a gradient-indigo "P".
- No gradients on text, no grids, no noise.

## 4. Product imagery
- A single real screenshot (not a mockup) of the actual dashboard, framed with macOS-style traffic-light dots (red/yellow/green) and cropped at the bottom through the tables (the last row is cut mid-line) so it implies more below. The self-host page uses the same image with a "Community Edition" wordmark and a dark title bar.
- Readable because: the data is plausible and named (real sources, real paths), type is 11-13px but high contrast, KPI strip leads the eye, bar fills create rhythm.
- A "live demo" button points to the real dashboard on plausible.io's own data. This is the proof the product exists.

## 5. Motion & interaction
- Almost none on the marketing page: no scroll reveals seen in 700ms steps, no carousel, no marquee. The only controls are the dropdown mega-menus, the pricing Monthly/Yearly toggle and the pageview slider.
- The dashboard screenshot is static. The live demo supplies the interactivity off-page.
- Fastest-loading of the five (system fonts, one image, no JS animation), which is itself part of the pitch ("Lightweight script").

## 6. "How to use" and "self-host" presentation
- No "how it works" steps on the homepage. Self-hosting is not in the top nav; it lives at https://plausible.io/self-hosted-web-analytics (landing page) and the docs (`/docs/self-hosting`). The captured redirect lands on the marketing page.
- The self-host page (`plausible-extra.jpg`): H1 "Plausible: Self-Hosted Google Analytics alternative"; intro "Plausible is an open source web analytics tool. No cookies, no personal data collected, no consent banners required..."; second paragraph "The same code runs in two ways. Plausible Community Edition (CE) is the free, self-hosted, AGPL-licensed release: you run it on your own server and manage everything yourself. Our managed cloud service handles all of that for you, and revenue from subscriptions funds the ongoing development of Plausible." Buttons "Start free trial" / "View live demo", then "Prefer managed hosting? Try Plausible Cloud free for 30 days. No credit card required."
- FAQ-style anchored sections (TOC at top): "What's the difference between Plausible Analytics Cloud and Plausible CE?" (a two-column comparison table: Infrastructure management, Release schedule, Premium features, Bot filtering...), "Self-hosting is a real commitment", "How can you be sustainable if you're giving your software for free?", "Transparency as a key value of privacy focused software", "What license is Plausible Community Edition released under?", "How do I self-host Plausible CE?".
- Notable honesty: the page states CE is "a long term release published twice per year" and that "Marketing funnels, user journeys, ecommerce revenue goals, SSO and sites API are not available". Admitting limits builds trust.

## 7. Trust & proof
- Customer names in a sentence (Stripe, Mozilla, MongoDB, Harvard, Sentry), 3 hard numbers (22k, 332B, 99.99%), 6 named testimonials from known founders, footer line "Funded entirely by our subscribers", "Made and hosted in the EU", a "Open source" nav entry ("The code is public and auditable. Verify exactly what we collect, and run it yourself if you want to.").
- rightnow-ai can honestly use: "code is public and auditable", AGPL/MIT licence statement, what is and is not in the free edition, an honest "self-hosting is a real commitment" section, real repo stats (stars, commits, last release) pulled live, a live demo link if a public demo instance is run with seeded data. Cannot use: customer counts, 22k-style numbers, testimonials.

## 8. Navigation, footer, CTA cadence
- Nav: Why Plausible (mega-menu: Simple analytics dashboard, Lightweight script, Privacy-friendly analytics, Open source, EU-hosted; Ecommerce, SaaS, Agencies, Creators & publishers, Public sector, White-label, Enterprise; vs Google Analytics, Migrate from GA4, vs Matomo, vs Cloudflare Analytics), Resources (Documentation, Blog, Tools, Status, Product updates, social links), Pricing; right: Login, Start free trial. About 110 links on the page.
- CTA cadence: nav (1), hero (2), pricing cards, closing band (2): 5-6 total, all the same two labels.
- Footer (dark navy): logo + "Made and hosted in the EU. Funded entirely by our subscribers." Columns: WHY PLAUSIBLE? (Simple metrics, Lightweight script, Privacy focused, Open source, No cookie banner, Features, Ecommerce, SaaS, Publishers, Agencies, Public sector, White label, Enterprise), EXPLORE (vs Google Analytics, Migrate from GA4, vs Matomo, vs Cloudflare, GA4 accuracy, Paid vs free, Right for you?, How to choose, WordPress plugin, Google Tag Manager, Search Console, Data Studio, NPM package), RESOURCES (Documentation, Blog, Tools, What's new, Status, GitHub, X, Bluesky, Mastodon, LinkedIn), COMPANY (About, Pricing, Contact, Privacy policy, Data policy, Terms, DPA, Security, Compliance, Procurement, Imprint).

## 9. Copywriting
- Voice: calm, factual, slightly opinionated ("Google Analytics is overkill for most site owners"). Headlines state the category and the competitor. Benefit sentences are 8-14 words. Feature titles are noun phrases ("Funnels and user journeys", "Built-in bot filtering"). Concrete numbers appear as proof ("54 times smaller", "135KB less JavaScript", "4 kg of CO2 per year"). Jargon is explained inline in one clause.
- Competitor name appears 20+ times on the page; "alternative" is the keyword spine.

## 10. SEO
- Title: "Plausible Analytics | Simple, privacy-friendly Google Analytics alternative" (74 chars).
- Meta description: "Plausible is a lightweight and open-source Google Analytics alternative. Your website data is 100% yours and the privacy of your visitors is respected."
- Canonical https://plausible.io/. OG: title "Plausible Analytics", locale, description, url, site_name, image (plausible_promo.jpg), type; Twitter: card summary_large_image, site @PlausibleHQ.
- JSON-LD: WebSite and Organization.
- Headings: single H1 containing the head keyword; H2 per section; H3 per feature.
- Internal-link architecture: the mega-menu is a crawlable site map: one landing page per feature (/simple-web-analytics, /lightweight-web-analytics, /privacy-focused-web-analytics, /open-source-website-analytics, /eu-hosted-web-analytics), per audience (/for-ecommerce, /for-saas, /for-freelancers-agencies, /for-bloggers-creators, /for-public-sector), and per competitor (/vs-google-analytics, /vs-matomo, /vs-cloudflare-web-analytics, /migrate-from-google-analytics). The prose section links to them with exact-match anchors. This is the template to mirror for "instantly alternative", "open source cold email", "self-hosted CRM".

## 11. Mobile (390x844)
- Nav collapses to logo + hamburger (no CTA in the bar). H1 wraps to four lines (~36px); CTAs stack full width (~100px tall each); dashboard frame shrinks to the viewport width (text becomes ~6px, illegible but the shape reads). Layout is single column, the 4-column feature grid becomes one column. No horizontal overflow seen.

## 12. Verdict
Done well, ranked:
1. Keyword-exact H1 plus a dedicated URL per feature, audience and competitor, all in one mega-menu. Adapt: /instantly-alternative, /open-source-cold-email, /self-hosted-crm, /cold-email-warmup pages, each linked from nav and footer.
2. One real, honestly framed dashboard screenshot cropped mid-table, with a live demo link. Adapt: a real rightnow-ai screenshot (inbox or analytics) from seeded demo data and a "View demo" that opens a read-only seeded instance or a recorded walkthrough.
3. Self-host page that states limits ("Self-hosting is a real commitment", feature gaps, release cadence). Adapt: "What you run, what you maintain, what it costs on a VPS" section with a Cloud-vs-self-host table replaced by "Laptop vs VPS".
4. Long-form SEO prose styled as an essay with exact-match internal links. Adapt: "Why self-host your cold email" section.
5. Numeric proof tied to the product's own claim (script 54x smaller). Adapt: measurable facts only, such as test count, supported providers, image size, cold-start time.

Weak or avoid: pricing, trial and Login funnel; customer stats and founder testimonials; the plain system-font visual identity is forgettable; mobile screenshot is illegible; no how-it-works steps on the homepage.
