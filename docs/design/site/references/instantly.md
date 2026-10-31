# Instantly.ai (instantly.ai) - landing page reference

Captured 2026-10-30, headless Chromium 1440x900 and 390x844. Screens `specA/instantly-d00..d10.jpg` (11 screens cover 8,063 px; viewed d00, d03, d06, d08), `instantly-m0..m3.jpg` (not viewed; DOM metrics: scrollWidth 390, height 6,038 px). Cookie modal ("This site uses cookies") appears at the bottom of the first screen and was not dismissed. Extra `/blog` was not fetched. Important: the 2026 homepage no longer leads with cold email; it leads with "AI agents / Find Clients". The product being replaced is therefore best studied via the nav and sub-pages (/email-warmup, /outreach, /crm, /email-accounts, /inbox-placement; not captured), but the structure and proof layout below are observed.

## 1. Snapshot
- URL https://instantly.ai. Category: cold-email / sales-engagement SaaS.
- H1 (verbatim): "Find Clients [bolt logo] Instantly" (white, centered, 40px in the DOM, ~48px rendered with the logo mark between words).
- Subhead (bold, white 16px): "Get more clients by chatting to AI"
- Hero control: a white chat composer, placeholder typing "Ask Co-pilot to Create End-to-E...", with an up-arrow send button; suggestion pills "Create Sales Agent", "Create Reply Agent", "Find Leads".
- CTAs (black pills): "Get Started" (header, primary), "Get A Demo" (header, outlined), "Start For Free" (repeated in sections). Link "Login".
- Blue announcement bar: "The search is over. Discover 555M+ B2B contacts, local businesses, and creators with Lead Finder. -> Try Lead Finder Now" (dismissible x).

## 2. Page anatomy (8,063 px desktop, 6,038 px mobile)
1. Announcement bar 48 px, bright blue #0b6bff-ish, white text, underlined link, x.
2. Header ~72 px white: logo (blue circle with white bolt + "Instantly"), nav AI Agents v, Products v, Use Cases v, Resources v, Pricing; right "Login", "Get A Demo" (outlined, radius 100px), "Get Started" (black pill).
3. Hero (797 px): rounded 28px panel inset 16px from viewport edges, full-width deep-blue to bright-blue mesh gradient (dark navy bottom-left, light periwinkle top-right, d00). Centered H1, subhead, chat composer (560 px wide, white, radius 16px), 3 pills, then "Used by the world's leading companies" and a monochrome white logo row: HP, Sony, X, Stripe, ahrefs, flexport, ramp, Revolut, Linear (d00).
4. "Reach Clients On Autopilot" (4,249 px, the main body, white-ish #f7f8fb bg): a series of wide rounded cards (1,040 px, centered, radius ~28px), each a gradient color field (teal, blue-grey, sunset) with a white UI card floating in it. Sub-sections inside: "Automate Your Outreach" (flow nodes "Choose Leads", "Create Slack User"), "AI Workflows" (H2 40px, subhead "Workflows that just work. When a lead visits your site, replies, or books a meeting, Instantly automatically routes them, tags them, and triggers next-step campaigns--no manual setup needed." + black "Start For Free" pill, then a card "Add A Trigger / Select a trigger that will activate an action" with search and lists "APPS: Calendly, Hubspot, Pipedrive; BUILT IN TOOLS: Instantly, Schedule, Webhook" (d06 and d08)), "Connect Your Tools" (integration logos), "Optimized For Revenue" (stat/feature cards).
5. "Connect Instantly To ChatGPT" (682 px): another blue gradient card, H2 center; "Handle everyday outbound work through a conversation. Find leads, create campaigns, organize and move leads, reply to prospects, or create agents that run your outbound autonomously."; segmented toggle "ChatGPT | Claude (Coming soon)"; floating stat chips "Email Sent 10065", "Replies Sent 9652" and avatar bubbles with green check badges around an orbit ring (d06).
6. "Customer Testimonials / Real Results. Real Customers." (741 px): carousel of quote cards with prev/next circular buttons (grey left, blue right, d08). Quotes (verbatim) e.g. "The AI Reply Bot has been the best feature by far. It doesn't just save time - it's the reason clients stick with Instantly long term. Nobody wants to chase leads manually." - Jackson Kingsley, Founder, Video Business Mastery; "We manage hundreds of mailboxes across dozens of concurrent campaigns, and deliverability is everything to us..." - Josh Michaels, Founder, Three Red Boxes; "In cold email, deliverability is the number one thing.. if you don't have that, you have nothing." Real names with company titles, no photos observed in text.
7. Closing CTA (592 px): blue gradient panel again: "Unlock The Power Of AI With [bolt] Instantly" / "Get started now to access exclusive templates and elevate your projects to the next level." / black "Get Started" pill; a small floating AI-chat pill at the bottom "How can Instantly improve deliv..." (typed loop, d08).
8. Footer (803 px): not viewed; links in the DOM are heavy (186 internal links on the page).

## 3. Visual system
- Colors: bg #f7f8fb (cool off-white), text #0a0a0a / black, white cards, brand blue gradient (navy #0a1a4a corner to #1a73ff to #a7c0f5), black pills #000, links underlined, blue chevrons #3b6ef0, chips with white fill + subtle shadow.
- Type: "Avertastd" (Averta Std, humanist geometric sans), headings 40px/44px/weight 600/letter-spacing -1.5px to -2px (very tight); body ("Geliat" declared on body, Averta in components) 16px; buttons 14px/600; hero subhead 16px/600. Small card labels 11-12px.
- Buttons: pill, radius 100px, padding 10px 20px, bg #000, white text 14px/600, no shadow; secondary outlined with 1px black.
- Radii: giant 28px panels, 16px composer, 12px list rows, 999px pills.
- Spacing: viewport-wide panels inset 16px (hero) and centered 1,040 px cards; ~120px vertical gap between sections; centered text everywhere.
- Backgrounds: mesh gradients (blue field with large soft blobs), photographic overlays (sunset/teal) inside cards, glassmorphism (white 20% blur) for floating UI.
- Iconography: round app logos (Calendly, HubSpot, Pipedrive) in white rows; bolt mark.
- Illustration: glass-card UI over gradient; faint orbit rings with nodes.

## 4. Product imagery
- Floating glass UI fragments (trigger picker, flow nodes, stat chips "Email Sent 10065 / Replies Sent 9652") over gradient fields, mostly stylized, not full app screenshots. Cropped with the card edge (nodes cut off), glass blur keeps text legible. Little of the old Instantly UI (campaign table, unified inbox "Unibox", warm-up chart) is on the homepage now: this is a weakness for rightnow to avoid.

## 5. Motion and interaction
- Hero composer types prompts in a loop ("Ask Co-pilot to Create End-to-E..."); suggestion pills; sticky floating AI chat pill that persists and types questions ("Which Instantly plan is right for me?", "How can Instantly improve deliv...") at the bottom of the viewport on every screen (d06, d08).
- Testimonial carousel with prev/next buttons; logos static. Floating stat chips and avatar bubbles drift along an orbit; flow nodes animate in. Announcement bar dismissible.
- Reduced-motion and easing not measured.

## 6. How to use / get started
- Homepage has no steps; the funnel is "Get Started" (signup) / "Get A Demo". The older pattern (not on this page) is /email-warmup etc. Honest takeaway: the 3-step story is told in section titles (Find -> Reach -> Optimize), not as numbered steps; rightnow should add numbered steps itself (Connect, Warm up, Send).

## 7. Trust and proof
- Logo row under the hero ("Used by the world's leading companies": HP, Sony, X, Stripe, ahrefs, flexport, ramp, Revolut, Linear), testimonial carousel with named founders/titles, "555M+ B2B contacts" stat in the banner, live-like stats chips. rightnow cannot use logos/counts; it can use real GitHub activity, license, tested-provider list (Gmail, Microsoft 365, IMAP/SMTP), and the architecture facts (Postgres queue, freshness gate).

## 8. Navigation, footer, CTA cadence
- Header (sticky, white): AI Agents mega menu (Sales Agent, Reply Agent, Lead Finder Agent, Deliverability Agent, Partnership/Investment/Recruiting/User Research agents, Instantly AI, AI SDR, AI BDR), Products (AI Client Finder, Lead Database, Verification, Website Visitors, Outreach, CRM, Automations, AirMail, Email Accounts, Deliverability/Warm-up at /email-warmup, Inbox Placement, Managed Services), Use Cases (Sales, Sales Development, Marketing, Developers), Resources, Pricing.
- CTA cadence: banner, header x2, hero composer, "Start For Free" after each major section (about 5), final "Get Started". Pill CTAs in black are very consistent (a clear single-color rule).

## 9. Copywriting
- Voice: promise-driven, imperative, mixed case title-cased headings ("Reach Clients On Autopilot", "Unlock The Power Of AI With Instantly"). Brand name used as an adverb pun ("Find Clients Instantly"). Short fragments, buzzwords (AI, autopilot). Features are named by product (Lead Finder, Unibox, AirMail). Sentences medium length; benefit-then-mechanism ("When a lead visits your site, replies, or books a meeting, Instantly automatically routes them, tags them...").

## 10. SEO
- Title "Sales Engagement and Lead Intelligence | Instantly"; meta description "Turn leads into clients with automated outreach, a B2B lead database, email deliverability tools, and an AI-powered CRM. Start free today." Canonical https://instantly.ai/. OG title/description same; og:image Webflow CDN banner (.webp); og:type website; twitter summary_large_image. JSON-LD: Organization, WebPage, WebSite (no SoftwareApplication, no FAQ). Headings: H1 "Find Clients" (the H1 text is just "Find Clients", the word Instantly is an image) and 10 H2/H3 in title case; sparse keywords. 186 internal links; large URL tree per product (/email-warmup, /email-accounts, /outreach, /crm, /inbox-placement, /b2b-lead-finder, /email-verification, /website-visitors, /ai-agents/*, /vip, /developers) plus use-case pages and a blog (blog not captured, the main SEO engine: "cold email", "alternative" pages exist off-page). Webflow-built (cdn.prod.website-files.com).

## 11. Mobile (390 px)
- Page is shorter on mobile (6,038 px) than on desktop (8,063 px): panels shrink and a few side-by-side cards stack/hide. scrollWidth 390, no overflow. Mobile screenshots (m0-m3) captured but not viewed; so hamburger and composer behavior are unverified.

## 12. Verdict
Executed well (ranked):
1. Consistent black pill CTA repeated after every section with one-sentence intros; plain and conversion-focused. Adapt: black pill "Star on GitHub" and "Deploy it yourself" only.
2. Glass UI fragments over a brand-blue mesh gradient, with a clear flow-builder card ("Add A Trigger"); adapt for rightnow's automations/webhooks and sequence-step builder using real in-app components.
3. Floating stat chips ("Email Sent / Replies Sent") as a visual shorthand for outcomes; adapt to real counters from a demo seed ("12 mailboxes warm", "sent today 184/200") clearly labelled as sample data.
4. Segmented toggle "ChatGPT | Claude" integration panel; adapt as "Gmail | Microsoft 365 | IMAP/SMTP" provider toggle (honest: all three are supported).
5. Testimonial quotes that name specific benefits (deliverability, mailbox scale) - structure only; rightnow must not fabricate; use GitHub issue quotes only if real.
6. Product-per-URL architecture (/email-warmup, /crm...): rightnow can mirror as anchored sections or /features/* pages for "instantly alternative" SEO.
Avoid / weak:
- Hero no longer states what the product does; H1 is "Find Clients" and the old strengths (warm-up, mailboxes, unified inbox) are buried in nav; rightnow should name them in the hero.
- Unreadable logos wall as proof, "555M+ contacts", demo/pricing funnel, Co-pilot chat gimmick, unsolicited sticky chat pill that overlaps content (d06 covers a card).
- Generic AI language, light SEO on the homepage itself (sparse H2 keywords, no FAQ schema).
- Title Case H2s are harder to scan than sentence case.
