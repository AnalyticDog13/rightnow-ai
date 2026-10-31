# Dub landing page reference

Captured 2026-10-30, headless Chromium, 1440x900 and 390x844. Homepage height 12,205px. Screenshots in specB: `dub-d0..d11.jpg`, `dub-m0..m2.jpg`, `dub-extra.jpg`.

## 1. Snapshot
- URL: https://dub.co. Category: open-source (AGPL) link management and attribution, hosted-first, self-hostable.
- Positioning: "Dub is the modern link attribution platform for short links, conversion tracking, and affiliate programs."
- H1 verbatim: "Turn clicks into revenue" (48px, centred, one line).
- CTAs: primary "Start for free" (black), secondary "Get a demo" (white, border). Nav: "Log in" (white), "Sign up" (black). Announcement pill above H1: "Introducing our Startup Program | Learn more" (split pill).
- Open source is NOT mentioned on the homepage above the footer: the footer has a GitHub icon link, and the docs have an OPEN SOURCE group with "Local development" and "Self-hosting Dub".

## 2. Page anatomy
1. Nav (white, 56px, hairline bottom border, 1080px content): "dub" wordmark, Product (dropdown), Solutions (dropdown), Resources (dropdown), Customers, Pricing; right "Log in", "Sign up".
2. Hero (~460px): announcement pill, H1, 2-line sub, 2 buttons, on a faint 60px square grid background with vertical page rules at x=180 and x=1260.
3. Product switcher + screenshot (~600px): a tab strip with a scooped top edge (inverted-curve cut-out) containing three coloured pill-tabs: "Affiliate Programs" (purple icon), "Conversion Analytics" (green icon), "Short Links" (orange icon); below, a framed dashboard (~900px, 8px double-border bezel) with a cursor animation moving across it (d0 shows a pointer arrow). The background gradient shifts per tab (pinkish for affiliate, greenish for analytics).
4. Product manifesto block: a three-sentence centred statement in 28-30px type with a marker word per product: "programs [purple dice icon] - all in one place. It's fast. It's reliable. It's beautiful. And it scales with you. Because you deserve more than vanity metrics. You deserve clarity." Surrounded by tilted floating profile cards (e.g. "Derek Forbes Revenue $1.5K Payouts $450", "Lucia Gonzalez $24K / $7.2K") on a dotted backdrop.
5. "Dub Links" section: small coloured icon + label, H2 "It starts with a link" (48px), sub "Create branded short links with superpowers: built-in QR codes, device/geo-targeting, A/B testing, deep links, and more.", button "Explore Links"; below it a feature visual (QR Code Design H3, link cards).
6. Testimonial: large quote line, avatar and name (e.g. "Ian Mackey, Vice President at Scicomm Media") on a dotted tile.
7. "Dub Analytics" section: H2 "Measure what matters", sub "From first click to conversion, understand exactly how your marketing drives revenue with Dub's powerful attribution engine.", "Explore Analytics", and a "Play demo" button over an animated scene (product card with Checkout button, an analytics card Clicks 7.2K / Leads 165 / Sales $506, then a funnel 100% > 36% > 1.3% drawn in blue/purple/teal). Under it three tabs "Conversion tracking" / "Real-time analytics" / "Customer insights", each with 1-line and "Learn more >", the active one with a green left rule and green link.
8. Perplexity quote (Johnny Ho, Co-founder at Perplexity).
9. "Connect with your favorite tools" H2: logo grid (Shopify, Slack, WordPress, Stripe...) on a 60px grid with some tiles lit.
10. "Grow with partnerships" H2 (affiliate programs).
11. "Dub API": label, H2 "Enterprise-grade link infrastructure", sub "Programmatically generate millions of short links, with deferred deep linking and real-time webhooks built in.", "Explore API", and an animated diagram: dub logo > "Link clicked" > "New Event" > customer logos (Superhuman, Buffer, Polymarket) and integration chips.
12. "Built to scale" (d8): left copy "Our powerful, battle-tested infrastructure handles hundreds of millions of links & events monthly and can scale infinitely with your business needs." and three live counters in orange mono: LINKS CREATED 15,329,400; EVENTS TRACKED 258,450,450; REVENUE TRACKED $161,259,306.00. Right: a dotted globe with "New sale $360.00 / $300.00 / $48.00" toasts stacking.
13. "Enterprise-grade link infrastructure"/security section (H2 list shows "Enterprise-grade link infrastructure").
14. "Trusted by startups and enterprises" (d11): a bento grid of logo tiles and quote tiles: Twilio, Buffer, Framer (quote "Dub is simply put the best way to track links and measure attribution. It's easy, clean, and just works - while all the alternatives look bloated, complicated, and dated."), Vercel ("Stripe for payments, Vercel for deployments, Dub for links."), Polymarket, tonies. Button "View all customers".
15. "We ship fast" (changelog cards), "Supercharge your marketing efforts" closing CTA, footer.

## 3. Visual system
- Palette: page bg `#FAFAFA` (`rgb(250,250,250)`), white cards, text `#171717` (`rgb(23,23,23)`; body `#0A0A0A`), muted `#737373`-ish, borders `#E5E5E5` / `#D4D4D4` (the announcement pill), primary buttons pure black `#000` with white text, 8px radius, 36px high; secondary white with 1px `#E5E5E5`. Product colours are used only as small chips/icons: purple (affiliate), green (analytics), orange (links), blue (API); numbers in `#EA580C`-ish orange.
- Typography: headings in "Satoshi" (geometric grotesque), weight 500, H1 and H2 both 48px (line heights 55.2px and 48px), no tracking; body Inter 16/24; buttons 14px weight 400-500; labels 12px weight 500; counters in a mono font.
- Spacing: the whole page lives in a ~1080px column framed by vertical hairlines (x=180, x=1260); sections have top/bottom hairlines; section padding ~64-96px; inner left padding 40px (text aligns at x=220).
- Radii: buttons 8px; cards 12px; pills 9999px; bezel around the dashboard ~16px.
- Shadows: very light, mostly 1px borders.
- Backgrounds: faint square grid in hero and the integrations section, dotted fields behind quotes, soft pastel radial gradients that change per product tab, a dotted-globe render in "Built to scale".
- Iconography: small rounded-square product icons in purple/green/orange; thin line icons.
- Illustration: UI itself; floating profile cards at slight rotation.

## 4. Product imagery
- Layered, animated UI recreations rather than flat screenshots: the hero dashboard has a moving cursor; the analytics block draws the funnel in a scene (a product card with "Checkout" above a metrics card above a funnel) to show cause and effect; the API block is a node diagram. Each is presented inside a lightly bevelled frame or none at all. Readable because numbers are large (Clicks 7.2K, Leads 165, Sales $506), colours are distinct per stage (blue, purple, teal) and the scene has one story per frame.
- Customer faces and logos recur as proof but the imagery is mostly the product.

## 5. Motion & interaction
Caveat: captures are static JPEGs. Only the cursor in the hero (d0), the dimmed inactive tabs (d5) and the stacked "New sale" toasts (d8) were directly visible; the remaining behaviours below (auto-advance, ticking counters, pulses, reveals) are inferred from structure and common patterns, not observed.
- Product switcher tabs change the screenshot and background tint.
- Cursor animation over the hero dashboard.
- "Play demo" button starts the analytics scene; the funnel is drawn in sequence.
- Tabs ("Conversion tracking / Real-time analytics / Customer insights") auto-advance with the left green rule indicating the active one (see d5).
- Counters in "Built to scale" tick up; globe toasts ("New sale") stack and fade.
- API diagram has pulses along connector lines.
- Logo/integration grid tiles light up in turn.
- Scroll reveals fade and slide content; hero profile cards float. Reduced-motion not tested.

## 6. "How to use" and "self-host" presentation
- The homepage offers no step list and no self-host section. The product is explained by showing outputs (links, funnel, partners). There is no install command, no code block, no star count.
- Docs (https://dub.co/docs, `dub-extra.jpg`, a Mintlify-style site): sidebar GETTING STARTED (Introduction, How attribution works, Web installation, Server-side tracking (recommended), Client-side tracking, Mobile installation, Third-party integrations: Stripe, Google Tag Manager, Shopify, HubSpot, Segment, Testing your implementation), CONCEPTS (Conversion tracking, Deep links, Links API, Analytics API), INTEGRATIONS, OPEN SOURCE (Local development, Self-hosting Dub). Top bar: Search (Ctrl K), Contact support, Dashboard, then tabs Developer Docs, Help Center, API Reference, Webhooks. Intro page has "Copy page" and an `llms.txt` pointer ("Fetch the complete documentation index at: /llms.txt").
- The page's lesson: open source is surfaced in the docs only, not in marketing.

## 7. Trust & proof
- "Trusted by startups and enterprises" bento of logo tiles + quote tiles (Framer, Vercel, Twilio, Buffer, Polymarket, tonies), standalone quotes with photos (Perplexity, Scicomm Media), "Built to scale" live counters (15.3M links, 258M events, $161M revenue tracked), a status chip "All systems operational" in the footer.
- rightnow-ai can honestly use: live counters from its own data are not possible (no hosted telemetry); instead use repo stats and public facts (number of providers supported, test count, supported migration paths). Counters are only honest if derived from verifiable sources (GitHub API). No customer logos or quotes.

## 8. Navigation, footer, CTA cadence
- Nav: Product, Solutions, Resources (dropdowns), Customers, Pricing; right: Log in, Sign up. Fixed with white bg.
- CTAs: nav (always), hero (2), then each section has one outlined "Explore X" ghost button (Explore Links / Explore Analytics / Explore API / ...), and a closing "Supercharge your marketing efforts" block. Section-level CTAs are links into product pages (SEO), not sign-ups; sign-up appears at top and bottom only. This is the lightest CTA cadence of the five.
- Footer (5 columns): logo + social icons (Twitter, LinkedIn, GitHub, YouTube) + "All systems operational"; Product (Dub Partners, Dub Analytics, Dub Links, Dub API); Solutions (Marketing attribution, Content creators, Affiliate management); Resources (Docs, Help Center, Enterprise, Startups, Integrations, Pricing, Affiliates); Company (About, Blog, Careers, Changelog, Customers, Brand, Contact, Privacy); Compare (Rewardful, PartnerStack, FirstPromoter, Tolt, Bitly, Rebrandly, Short.io, Bl.ink).

## 9. Copywriting
- Voice: crisp, outcome-led, confident. Headlines 3-5 words, verb or claim ("Turn clicks into revenue", "Measure what matters", "It starts with a link", "Grow with partnerships"). Sub copy states what, then lists features after a colon ("built-in QR codes, device/geo-targeting, A/B testing, deep links, and more"). Rhythmic triplets ("It's fast. It's reliable. It's beautiful."). Jargon (attribution, deferred deep linking) is introduced with a plain sentence beside it. Customer quotes are compelling and comparative ("while all the alternatives look bloated, complicated, and dated").

## 10. SEO
- Title: "Dub - The Modern Link Attribution Platform". Meta description: "Dub is the modern link attribution platform for short links, conversion tracking, and affiliate programs."
- Canonical: not found in the page head. OG: title, description, image (assets.dub.co/thumbnail.jpg). Twitter: summary_large_image, creator @dubdotco.
- JSON-LD: Organization and SoftwareApplication.
- Headings: one H1; section H2s; H3 list in footer columns (Product, Solutions, Resources, Company, Compare).
- ~116 internal links. The footer "Compare" column is a deliberate "alternative to" funnel (Rewardful, PartnerStack, FirstPromoter, Tolt, Bitly, Rebrandly, Short.io, Bl.ink): each competitor gets its own page. Also "Solutions" pages by audience. This is the same structure rightnow-ai needs: Compare: Instantly, Smartlead, Lemlist, Mailshake, Woodpecker.

## 11. Mobile (390x844)
- Nav: wordmark, "Log in" and "Sign Up" buttons and a hamburger, all in one bar (`dub-m0.jpg`). Announcement pill and H1 wrap to two lines (~44px); CTAs stay side by side ("Start for free", "Get a demo"); the product tabs stack as chips (one on its own row); the dashboard shrinks to full width with ~6px text but remains recognisable; the dark "Affiliate Programs" label tab overlaps the bottom of the frame. No horizontal scroll observed. Tap targets ~48px.

## 12. Verdict
Done well, ranked:
1. A product switcher above one hero screenshot, with colour-coded chips. Adapt: tabs "Warm-up", "Campaigns", "Inbox", "Analytics" each swapping a real screenshot and tint.
2. Scenes that show cause and effect (card > metrics > funnel) with big, single-story numbers. Adapt: "Send > Open > Reply > Meeting" funnel drawn from a seeded demo campaign, clearly labelled as demo data.
3. A Compare column in the footer (Rewardful, PartnerStack, FirstPromoter, Tolt, Bitly...). Adapt: Compare: Instantly, Smartlead, lemlist, Mailshake, Woodpecker, each a real page with a feature-by-feature honest table.
4. Light CTA cadence with section-level ghost buttons that deepen into product pages instead of repeating sign-up. Adapt: "Explore warm-up", "Explore campaigns" (docs/spec pages) plus one "Self-host in 5 minutes" CTA.
5. Frame with hairline vertical rules, 8px black buttons, Satoshi-like headings: restrained, premium, cheap to implement.
6. Docs with an "OPEN SOURCE" group and `llms.txt`. Adapt: publish `llms.txt` for the repo docs.

Weak or avoid: open source and self-hosting are invisible on the marketing page (the opposite of what rightnow-ai needs); "Built to scale" counters and customer logos cannot be claimed honestly; sign-up/pricing/enterprise paths; no canonical link; Play-demo and animated scenes are heavy; hero screenshot text is illegible on mobile.
