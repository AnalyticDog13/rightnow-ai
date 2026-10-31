# Cal.com landing page reference

Captured 2026-10-30 with headless Chromium (1440x900 desktop, 390x844 mobile). Homepage height 8569px. Screenshots live in the specB scratch folder: `calcom-d0..d10.jpg`, `calcom-m0..m2.jpg`, `calcom-extra.jpg`.

## 1. Snapshot
- URL: https://cal.com (the docs link from the shortlist redirects to https://www.cal.diy/installation, a separate "Cal.diy Docs" site for the self-hosted edition).
- Category: open-source scheduling, hosted-SaaS-first. The self-host path is secondary.
- Positioning: "A fully customizable scheduling software for individuals, businesses taking calls and developers building scheduling platforms where users meet users."
- H1 (verbatim): "The better way to schedule your meetings"
- Primary CTA: "Sign up with Google" (dark, full width of the left column). Secondary: "Sign up with email >". Microcopy under them: "No credit card required".
- Nav CTA: "Get started >" (dark). Pre-headline pill: "Cal.com launches v6.9.5 >" (release announcement).

## 2. Page anatomy (top to bottom, desktop)
1. Floating nav bar (white rounded container, 1px border, fixed on scroll). ~56px tall.
2. Hero card (white, radius ~16px, inset ~12px from the grey page, ~700px tall). Two columns: left copy + CTAs, right a live-looking booking widget (calendar, 15m/30m/45m/1h toggle, "Google Meet", timezone). Under the CTAs, three rating badges: Trustpilot stars, Product Hunt stars, G2 stars.
3. "Trusted by fast-growing companies around the world" logo row (Framer, ramp, PlanetScale, coinbase, storyblok, more), single line clipped at the edges (marquee-like).
4. "How it works" pill + H2 "With us, appointment scheduling is easy" + sub + two buttons ("Get started", "Book a demo") + 3 numbered cards (01 Connect your calendar, 02 Set your availability, 03 Choose how to meet), each with a mini UI illustration (orbit diagram, availability toggles, video-call frame). Cards ~340px wide, ~420px tall.
5. "Benefits" pill + H2 "Your all-purpose scheduling app" + sub "Discover a variety of our advanced features. Unlimited and free for individuals." + CTAs. Then a 2-column bento of cards, each with a UI fragment: "Avoid meeting overload" (notice/buffer form), "Stand out with a custom booking link" (cal.com/rajiv chip over a booking card), "Streamline your bookers' experience", "Reduce no-shows with automated meeting reminders" (stacked notifications: "Meeting starts in 15 mins", "Booking rescheduled", "New booking confirmed").
6. H2 "...and so much more!" Icon grid, 4 columns x 2 rows, 8 tiles (~180x180): Accept payments, Built-in video conferencing, Short booking links, Privacy first, 65+ languages, Easy embeds, All your favorite apps, Simple customization. Icons sit in a small rounded square with four corner dots (screw-plate look).
7. "Testimonials" pill + H2 "Don't just take our word for it" + sub. Horizontal carousel: centre card full opacity, neighbours faded. Quotes in large display type (~28px Cal Sans) with avatar, name, role (e.g. "Aria Minaei, CEO, Theatre.JS"; "Ant Wilson, Co-Founder & CTO, Supabase").
8. "App store" pill + H2 "All your key tools in sync with your meetings" + "Connects to Slack, Salesforce, and 100+ more." + CTAs "Get started" / "Explore apps". Right: 4x2 grid of integration icons (Outlook, Meet, Google Calendar, Teams, Zoom...) separated by hairlines with "+" at intersections.
9. H2 "See why our users love Cal.com": second review wall.
10. H2 "Frequently asked questions": accordion.
11. Final CTA card: H2 "Smarter, simpler scheduling", buttons "Get started" and "Talk to sales", award laurels (Product of the day / week / month "1st") and star badges over a faint tiled backdrop.
12. Footer (section 8).

The page is cut by thin full-width horizontal rules with "+" registration marks at the rule/column-line crossings, and two faint vertical rules at x=120 and x=1320 framing a ~1200px content column.

## 3. Visual system
- Palette: page bg `#F4F4F4` (body `rgb(244,244,244)`); card surface `#FFFFFF`; text `#242424` (h1/h2 `rgb(36,36,36)`); muted text mid grey (~`#808080`); borders very light grey (~`#E5E5E5`). No brand hue: monochrome, colour only from third-party logos and rating stars. Primary button near-black `#242424` with white text, ~8px radius; secondary light grey `#F5F5F5` with dark text and chevron.
- Typography: display "Cal Sans" (weight 600, tight tracking), body a neutral sans. H1 64px / 70.4px line height. H2 48px / 52.8px. Card titles ~20px. Hero sub ~18px, card body ~16px. Pill labels 12px with icon.
- Spacing: section padding ~120px vertical; hero card inner padding ~64px; card gaps ~14px; content column ~1200px.
- Radii: cards ~16px, buttons 8px, pill labels 9999px, nav ~16px.
- Shadows: almost none. Separation is 1px borders and white-on-grey contrast; nav has a faint shadow.
- Backgrounds: flat; the final CTA sits on a tiled grid of ghost squares.
- Iconography: outline icons in rounded "plate" squares with corner dots. Pill labels precede every section heading.
- Illustration: UI fragments of the product itself, no decorative art.

## 4. Product imagery
- Real product UI recreated as HTML/CSS rather than raster screenshots: the hero is the booking page itself (duration toggle, calendar days). Readable because each card isolates one control (a notice-and-buffer form, availability toggles) at ~1:1 scale, white UI on a white card, with a soft fade or crop at the bottom/right edge instead of a device frame.
- A floating chip ("cal.com/rajiv") overlaps the top edge of a card to give depth without shadows.

## 5. Motion & interaction
- Hero widget appears interactive (durations, dates); not clicked in capture.
- Logo row clipped at both ends, consistent with an auto-scrolling marquee (not confirmed).
- Testimonial carousel: centre card full opacity, neighbours dimmed (d4, d5).
- Nav bar floats and stays fixed on scroll (visible in every desktop shot).
- Scroll reveals were not distinguishable at 700ms per step. Reduced-motion behaviour not tested. The og:image is on framerusercontent.com, so the site is built with Framer.

## 6. "How to use" and "self-host" presentation
- The homepage has NO self-host section. Only entries: footer link "Self-hosted" (column Solutions) and "Open Startup" (column Company). The top nav (Solutions, Enterprise, Cal.ai, Developer, Resources, Pricing) has no self-host item. No GitHub star count in the captured viewport.
- How-to is a 3-step numbered card row about using the product, not installing it. Exact copy: "Connect your calendar: We'll handle all the cross-referencing, so you don't have to worry about double bookings." / "Set your availability: Want to block off weekends? Set up any buffers? We make that easy." / "Choose how to meet: It could be a video chat, phone call, or a walk in the park!"
- Docs (cal.diy/installation, `calcom-extra.jpg`): 3-pane layout (left tree, centred article ~830px, right "On This Page"). Sections: Requirements, Production Build, Cron Jobs, App store seeder, API, One Click Deployments (Azure, GCP, Railway, Render, Vercel, Elestio), Other environments. Requirements copy: "To run Cal.diy, you need to install a few things. Node.js, yarn, Git and PostgreSQL." Sidebar has per-provider deploy guides (AWS, Azure, Elestio, GCP, Northflank, Railway, Render, Vercel). "Copy page" button top right, Ctrl+K search, System/light/dark toggle bottom left.

## 7. Trust & proof
- Logo row, three rating badges (hero and again in final CTA), Product Hunt laurels, named testimonials with title and company, footer compliance badges (ISO 27001, SOC 2, CCPA, GDPR, HIPAA), live "All Systems Operational" chip, mission line "Our mission is to connect a billion people by 2031 through calendar scheduling."
- rightnow-ai can honestly use: the mission/principles line, GitHub repo link and licence badge, a CI status badge, "your data stays on your server". Cannot use: logos, ratings, laurels, testimonials, compliance badges.

## 8. Navigation, footer, CTA cadence
- Nav: logo, Solutions (dropdown), Enterprise, Cal.ai, Developer (dropdown), Resources (dropdown), Pricing; right: "Sign in", "Get started >". Floating and fixed.
- CTAs: hero (2), after How it works (2), after Benefits (2), after App store (2), final card (2), plus the persistent nav CTA, about 11 in total: a sales funnel.
- Footer: logo, trademark line, five compliance badges, mission line, language select, status chip; columns Solutions (iOS/Android App, Self-hosted, Pricing, Docs, Cal.ai - AI Phone Agent, Enterprise), Use Cases (Sales, Marketing, Talent Acquisition, Customer Support, Higher Education, Telehealth), Resources (Affiliate Program, Help Docs, Blog, Cal Fonts, Teams, Embed), Company (Jobs, About, Open Startup, Support, Privacy, Terms).

## 9. Copywriting
- Plain, friendly, lightly humorous ("or a walk in the park!"). Headlines are 4-7 words and benefit-first. Section H2s are short claims. Card titles are verb phrases. Sub copy is 1-2 sentences. Vocabulary: "booking link", "bookers", "buffers". Almost no jargon.

## 10. SEO
- Title: "Cal.com | Scheduling Software for Online Bookings" (49 chars).
- Meta description: "A fully customizable scheduling software for individuals, businesses taking calls and developers building scheduling platforms where users meet users."
- Canonical https://cal.com/. OG: url, type website, title, description, image; Twitter: summary_large_image with title, description, image.
- JSON-LD: none found. One H1, an H2 per section, an H3 per card; ~45 internal links. Footer use-case pages (Sales, Marketing, Telehealth...) act as keyword landing pages; "Self-hosted" is a footer link. No "vs Calendly" link on the page. Page speed not measured (Framer hosting, many images).

## 11. Mobile (390x844)
- Nav collapses to logo + "Sign in" + "Get started >" + hamburger (`calcom-m0.jpg`). Hero card keeps its rounded frame with ~16px gutter. H1 wraps to three lines at ~44px; CTAs stack full width; the booking widget drops below the CTAs and its calendar is clipped at the right edge (overflow flaw). Tap targets ~48px.

## 12. Verdict
Done well, ranked:
1. Product-as-illustration: each feature card shows one real control at readable scale. Adapt: build rightnow-ai cards from real components (warm-up ramp, sequence step editor, inbox row) as HTML, cropped with a bottom fade.
2. Pill label above every H2 (icon + word) as wayfinding. Adapt: "Warm-up", "Campaigns", "Inbox", "Self-host".
3. Numbered three-step "how it works" cards with mini UI. Adapt: 01 run `docker compose up`, 02 connect a mailbox, 03 launch a campaign.
4. Monochrome, borders-not-shadows system with guide rules and "+" marks: cheap, crisp, needs only one accent.
5. Large display-type quote cards: only usable later with real GitHub quotes.

Weak or avoid: self-host is buried in the footer (rightnow-ai must lead with it); ~11 sign-up CTAs and "Sign up with Google" have no analogue; rating, award and compliance badges would be fabricated for a new project; the calendar widget overflows on mobile; no JSON-LD.
