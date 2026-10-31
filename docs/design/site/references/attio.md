# Attio (attio.com) - landing page reference

Captured 2026-10-30 with headless Chromium (1440x900 desktop, 390x844 mobile). Screens: `specA/attio-d00..d13.jpg` (desktop, first 11,200 px of 17,599 px; the footer was read from DOM text, not viewed), `attio-m0..m3.jpg` (mobile). Only m0 was viewed on mobile. A cookie banner (bottom-left, "Continue / Reject") and a chat bubble (bottom-right) were present in every shot and were not dismissed. Extra URL `/help` was fetched as text plus one screenshot.

## 1. Snapshot
- URL: https://attio.com. Category: CRM SaaS (sales-email adjacent).
- Positioning: "the CRM for agentic revenue" (AI agents that build pipeline around the clock). Heavy AI framing; this is the 2026 pitch, not the original "flexible CRM" pitch.
- Hero H1 (verbatim): "Welcome to agentic revenue."
- Subhead: "Attio is the platform that builds pipeline, advances deals, and grows accounts around the clock."
- Announcement bar (black, dismissible, x): "The new architecture for agentic revenue is here ->". Above H1 a pill: "GTM lessons from Elena Verna and more >" with a thin animated gradient underline.
- CTAs: primary "Start for free" (dark filled), secondary "Talk to sales" (outline). Header: "Sign in" (outline) + "Start for free". On mobile the hero swaps these for an email field + "Send me a demo" + "Talk to sales ->".

## 2. Page anatomy (top to bottom, total 17.6k px desktop, 16.2k px mobile)
1. Announcement bar, 48 px, black, centered white 14px text, close button.
2. Header, 68 px, white, 1px bottom border. Logo left, nav (Platform v, Resources v, Developers, Customers, Pricing), right: Sign in + Start for free.
3. Hero (section ~1207 px): pill, H1 64px, subhead, two buttons, then a macOS-style window mock (traffic lights, 1080 px wide, soft pale-blue gradient wash behind). Mock shows "Good morning, Alex" with a chat composer typing "How do I win my deal with|" and chips "Prep for next meeting", "Recap last call" (d00). The composer types text live.
4. Logo strip (~194 px, bg ~#f6f7f9): customer logos (not viewed in detail; section has no heading).
5. Scrollytelling "The intelligent system that never sleeps." (section 6,479 px, the longest). H2 40px: "The intelligent system that never sleeps." in ink, then grey "Picks up leads at 2am. Catches renewals before they slip. Hands you the answer before you ask." Two-tone heading is the signature device. Layout: 1392 px frame with 1px hairlines, left 348 px sticky rail listing five items (Build pipeline, Convert leads, Run sales motions, Forecast revenue, Retain and expand) with the active one in ink and the rest pale grey plus a 2 px blue marker on the left edge; right ~1040 px column swaps panels as you scroll. Each panel = a statement block (24px, bold lead sentence + grey continuation) over a gray (#f1f3f6) stage holding a real-looking UI fragment:
   - Build pipeline: table "Companies to work" with ICP Score pills (98, green), Owner, and a "Research agent" column with generated findings ("Opened 40+ GTM roles", "Hired a new CRO") (d02). Also a node-graph workflow fragment ("Enroll in sequence / SMB sequence").
   - Run sales motions: Kanban (Discovery / Demo / Proposal / Negotiation) with deal cards showing date, USD amount, owner avatar, next step, age "12d" (d05). Cards are cropped at the right edge.
   - Forecast revenue: chat answer "What is the estimate of this week's closed-won deal value" with "2 tools used" and streaming text (d07), plus stacked bar chart Jan-May (red/amber/blue) (d09).
   - Retain and expand: two-column pair "Spot the shift early." (signal cards: Upcoming renewal date, Usage spike +42% seats) and "The move's ready. You make the call." (two drafted "Email suggestion" cards with thumbs up/down and regenerate icons) (d09). Bottom cards fade out via mask.
6. "Live from day one." (1,097 px): "Connect your inbox and calendar. Attio learns your business and builds..." H2 with a record page mock showing an Activity list ("Michael Chang attended an in-person meeting 6 hours ago") (d11).
7. Dark section "Universal Context(TM)" (4,517 px wrapper, inner dark section 2,573 px, bg ~#0c0c0d): eyebrow "The only CRM with" (small grey) over a 72px+ "Universal Context(TM)" in off-white; a thin yellow/orange arc light and vertical hairline streaks as background (d11). Below: a left list "Context / Agents + automations / Ecosystem" where the active item has a progress bar that fills over time (auto-advance), right a line-art wireframe (concentric arcs with a dot moving along lines) (d13). "See more ->" button.
8. "All of the signals, none of the noise. Ready to act on." (dark, two H2 variants in DOM).
9. "Connectivity" pill + "Your whole stack, connected." (668 px, dark): "Claude, Slack, Clay, Linear, Notion, and anything your team and agents run on." An integration logo field.
10. "SDK. API. MCP. Build anything on Attio." (593 px, dark): developer pitch.
11. Light 2,250 px section (security/scale/use cases, partly untitled), then "Run at any scale. Production-grade for your team and agents." (760 px).
12. "Trusted by 30,000+ customers. From first agent to enterprise scale." (937 px): customer stories.
13. "Better as you grow. New features every week to keep pace with you." (930 px): four changelog cards: Activities, Workflows updates, Your new inbox, Redesigned record pages.
14. Final CTA, dark, 417 px: "Agentic revenue runs on Attio."
15. Footer, 685 px, dark.

## 3. Visual system
- Colors (computed lab values converted approximately): ink text #1b1d21; page bg #ffffff; alt section/stage bg #f6f7f9 and #f1f3f6; muted text ~#8b93a1 (the grey half of two-tone headings and the inactive rail items); hairline borders ~#dfe3e8; dark section bg ~#0c0c0d; primary button bg #2f343b-ish near-black (hero "Start for free" computed lab(20.6) with 1px border rgba(80,89,103,.5)); blue accents only inside UI mocks (#2563eb send button, active rail marker). No brand-color splash; the hero is monochrome with a faint blue-lavender gradient under the window mock.
- Type: Inter for UI/body (body 16px, weight 500, line-height 22px, letter-spacing -0.16px) and "interDisplay" (Inter Display optical cut) for headings. H1 64px / 60.8px line-height / weight 600 / -1.28px tracking (tight, -2%). H2 40px / 44px / 500 / -0.4px. H3 24px / 27.6px / 500 / -0.24px. Small UI 12-14px at 500. Buttons 14px/500/-0.07px.
- Buttons: height ~36px, padding 0 12px, radius 10px, 1px border; outline variant white with #d5d9e0 border.
- Radii: 10px buttons, ~12-16px window mock and cards, 999px pills.
- Spacing: content frame max 1392 px with 1px vertical hairlines at the edges (grid-paper feel); big vertical rhythm, sections 600-1200 px; 128 px spacer divs between some sections.
- Backgrounds: flat fills, hairline grids, one soft gradient under the hero mock, and on dark sections a subtle vertical-line texture (d11, d13).
- Iconography: thin 1.5px outline icons in mocks; app logos in integrations.
- Illustration: none decorative; every visual is product UI. The dark section uses abstract line-art wireframes.

## 4. Product imagery
- Real-looking, fully coded HTML/CSS UI (not static PNGs, tables are crisp and text is selectable per the DOM); a macOS window chrome frame only in the hero, afterwards frames are borderless stages (#f1f3f6 panels with hairlines).
- Fake but plausible data (OpenAI, Harvey, Cortexa; named reps; dates "Sep 30, 2026"). Cropping: Kanban and tables bleed off the right edge to imply more content; bottom of cards fade with gradient masks.
- Readability trick: each stage has one statement above it in 24px, so the UI is always captioned by a bold-then-grey sentence.
- Layering: small floating cards (email suggestions, signal cards) stacked with opacity falloff (d09).

## 5. Motion and interaction
- Hero composer types text in a loop with a caret.
- Sticky left rail with scroll-spy: active item turns ink, others fade, blue 2 px marker slides; right panels cross-fade/translate with scroll. The rail pins under the 116 px of announcement + header.
- Streaming text in the chat mock (d07 shows "Let m" mid-stream, so it runs when scrolled into view).
- Dark section tabs (Context / Agents + automations / Ecosystem) auto-advance with a filling progress line (d13).
- Pill under the hero has an animated gradient sweep underline. Announcement bar is dismissible.
- Reduced motion and exact easing not measured. On mobile the scrollytelling collapses (see 11).

## 6. How to use / get started
- No install steps on the page. "Start for free" (signup) and "Talk to sales" repeat. Onboarding lives in `/help`: search box (Cmd-K), "Popular searches: importing, billing, integrations", three tiles Academy / Reference / Developers, and a "Get started with Attio 101" card. Left column: Academy (Introductions, Workflows, Sequences, Reports) and Reference (Attio 101, Attio AI, Managing your data, Email & calendar, Imports & exports...). Footer links "Import from: Salesforce, Hubspot, Pipedrive, Zoho, Excel, CSV" are a useful pattern: one-line migration entries.
- Developer section: "SDK. API. MCP. Build anything on Attio." with docs at docs.attio.com.

## 7. Trust and proof
- "Trusted by 30,000+ customers", logo strip below hero, customer-story cards, Trust Center link in footer, security/scale section "Run at any scale". Fake-safe takeaways for rightnow: a real changelog block and a security section are honest; customer counts and logos are not usable.

## 8. Navigation, footer, CTA cadence
- Header: Platform (mega menu: Universal Context, Data Model, Enrichment, Call Intelligence, Reporting & Forecasts, Ask Attio, Workflows, Custom Agents, Web Agent, Sequences, Apps, MCP, Developer Platform, plus Slack/ChatGPT/Claude), Resources (Attio 101, Startup program, Talk to sales, Help Center, Academy, Developer Docs, Community, partners), Developers, Customers, Pricing. Not sticky-hiding: stays fixed all page (visible in every shot).
- CTA cadence: header (always), hero, mid-page "See more" links, "Better as you grow", final dark block. About 5 repeats of "Start for free".
- Footer (dark, 685 px): Platform, Company (Customers, Announcements, Engineering blog, Careers, Manifesto, Brand, Become a partner), Import from (6 sources), Attio for (Startups, Deal flow), Apps (Gmail, Outlook, Segment, Mailchimp, Slack, Outreach, Mixmax, Typeform, Zapier), Resources (Startup program, Help center, Developers, System status, Hire an expert, Downloads, Trust Center); legal row "Services Agreement, Privacy Policy, LLMs, Your Privacy Choices". An "LLMs" link (llms.txt) is notable.

## 9. Copywriting
- Voice: confident, short, second person ("Hands you the answer before you ask."). Headline formula: bold claim sentence + grey elaboration in the same block ("Your team, amplified. Agents prospect and reach out when buyers are looking..."). Frequently 3-6 word fragments: "Speed to lead, every time." "Keep more. Grow more."
- Features named with plain noun phrases (Data Model, Enrichment, Sequences). Jargon "agentic revenue" is coined and repeated; "Universal Context(TM)" is a trademarked term for the technical USP.

## 10. SEO
- Title: "Attio: The CRM for agentic revenue". Meta description: "The system for revenue teams to build pipeline, accelerate deals, and grow accounts around the clock." (contains a trailing tab character). OG title/description same; OG image 1200x630 on Storyblok; twitter:card summary_large_image. Canonical present in the DOM check but returned undefined (not confirmed).
- JSON-LD: Organization, WebSite, SoftwareApplication.
- Headings: two H1s (an empty one and "Welcome to agentic revenue."), many H2/H3 in sentence form, so the outline is long sentences, not keywords. 104 internal links. Product pages per feature (`/platform/...`), `/customers`, `/pricing`. No "alternative to" content observed on the homepage.

## 11. Mobile (390 px, m0 viewed)
- Announcement bar truncates with ellipsis, burger menu, hero H1 wraps to 2 lines, email capture + "Send me a demo" replaces two buttons (better conversion for thumbs), "Talk to sales ->" link below. Window mock shows below, truncated at the right edge (intentional). Page scroll width 390 (no horizontal overflow). Cookie banner covers about 25% of the screen. Tap targets: buttons ~48px tall. Rail/scrollytelling collapsed form was not viewed.

## 12. Verdict
Executed especially well (ranked):
1. Product UI built in HTML with believable data, captioned by a bold-then-grey sentence. Adapt: build rightnow's inbox, campaign sequence editor and CRM Kanban as coded mocks using the app's own components with sample leads; no photos of people needed.
2. Sticky left rail + scrollytelling with five jobs-to-be-done. Adapt: rail items "Connect mailboxes, Warm up, Run campaigns, Reply from one inbox, Track deals" mapped to real features, each panel a real screenshot.
3. Two-tone headline pattern (ink lead, grey elaboration). Zero cost, very readable.
4. Dark "technical differentiator" band with a hairline-grid texture and auto-advance tabs; adapt for "Your server, your data" (Postgres, no Redis, encrypted tokens).
5. Migration footer column (Import from Salesforce/HubSpot...). Adapt: "Import from Instantly / CSV".
6. Weekly-changelog cards as living proof; adapt to a real "recent commits / releases" strip from GitHub.
Avoid / weak:
- Announcement bar plus cookie banner plus chat bubble stack crowds the first screen. A self-hosted static page needs none (no cookies, no chat).
- "30,000+ customers", logo walls, "Start for free" signup, "Talk to sales", pricing: do not copy; replace with "Star on GitHub" and "Deploy it".
- Long sticky scrollytelling (6.5k px) is heavy; for rightnow keep to about 3,000 px and ensure it degrades to stacked sections.
- Vague coined jargon ("agentic revenue"); rightnow should stay literal ("cold email, warm-up, campaigns, inbox").
