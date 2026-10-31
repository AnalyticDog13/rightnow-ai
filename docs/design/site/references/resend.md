# Resend (resend.com) - landing-page reference

Captured 2026-10-30, headless Chromium (Playwright), desktop 1440x900 + mobile 390x844. Page height 12,319 px desktop / 14,088 px mobile. Screenshots: `scratchpad/specC/resend-d00..d15.jpg`, `resend-m00..02`, `resend-mmenu`, `resend-extra`. No bot wall.

## 1. Snapshot
- URL https://resend.com; category: email API for developers (sales-email SaaS / dev tool).
- Positioning: developer-grade email sending, deliverability-first.
- H1 (verbatim): "Email for developers". Subhead: "The best way to reach humans instead of spam folders. Deliver transactional and marketing emails at scale."
- Primary CTA "Get started" (also nav). Secondary "Documentation" (text link, no fill). Above H1 an announcement pill "What you missed at Resend Forward >" with a gradient border.

## 2. Page anatomy (top to bottom)
1. Sticky nav (~58 px): logo left, centered dropdowns Features / Company / Enterprise / Help / Docs / AI, plain Pricing, right "Log in" + "Get started" pill button.
2. Hero (900 px): left-aligned 96 px serif H1, subhead, two CTAs; right a rendered 3D black matte cube (hi-res render, slow drift). Soft diagonal light streak across the bottom. Mobile: cube moves above the text and everything centers.
3. "Integrate tonight" (centered H2, ~1,300 px): 3D app-icon tile (envelope) above H2; row of 13 language icon buttons (Node.js, Serverless, Ruby, Python, PHP, CLI, Go, Rust, Java, Elixir, .NET, REST, SMTP); beneath it a code window with a second tab row of frameworks (Node.js, Next.js, Remix, Nuxt, Express, Hono, Redwood, Bun, Astro), line numbers, copy button, footer links "View on GitHub" and "Download ZIP". Code shown: `import { Resend } from 'resend'; const resend = new Resend('re_xxxxxxxxx'); ... resend.emails.send({ from: 'onboarding@resend.dev', to: 'delivered@resend.dev', subject: 'Hello World', html: '<strong>it works!</strong>' })`.
4. "First-class developer experience" (left H2 + two-line blurb "We are a team of engineers who love building tools for other engineers. Our goal is to create the email platform we've always wished we had - one that just works."): bento grid of rounded cards, two columns, with "Test mode" and "Modular webhooks" visual cards plus a quote strip (e.g. "CEO at Vercel").
5. "Write using a delightful editor" (centered): large framed mock of the broadcast editor (toolbar Styles / Test / Send, From/To/Subject rows, image, "Press '/' for commands"). Under it "Go beyond editing" with "Contact management" and "Broadcast analytics" sub-cards.
6. "Develop emails using React" / "Welcome to ACME, user!": split code (React Email JSX with Tailwind classes) next to the rendered email.
7. "Reach humans, not spam folders" (left H2, inside a large rounded container with faint corner glow): 3x3 grid of icon + H3 + 2-line text: Proactive blocklist tracking, Faster time to inbox, Build confidence with BIMI, Managed dedicated IPs, Dynamic suppression list, IP and domain monitoring, Verify DNS records, Battle-tested infrastructure, Prevent spoofing with DMARC.
8. "Everything in your control": 3D globe tile + three tab-cards (Intuitive analytics, Full visibility, Domain authentication; the active one has a green top edge) driving a large real dashboard screenshot below (sidebar "Resend Pro").
9. "Beyond expectations": testimonials.
10. Closing CTA "Email reimagined. Available today." (serif, ~80 px) + "Get started >" button, then a giant ghost wordmark "Resend" cropped by the footer rule.
11. Footer: address, social icons (X, GitHub, LinkedIn, YouTube), "All systems operational" status pill with green dot; 5 columns Features / Resources / Company / Help / Community.

## 3. Visual system
- Dark only. Body bg rgb(0,0,0), text rgb(240,240,240). Surfaces are barely lifted: cards use rgba(214,235,253,0.19) fill on pills and 1 px hairline borders (~#ffffff14). Muted text ~60% white.
- Accent: one blue only on the "Get Started" hero-button variant (rgb(0,163,255), 4 px radius, 12x20 padding, 14 px/600 Helvetica) in the docs; on the landing page buttons are near-black pills with a faint inner border. Section accent glows are tinted per feature (purple on "tonight", green on analytics).
- Type: three families. Display H1 "domaine" (high-contrast serif), weight 400, 96/96 px, letter-spacing -0.96 px, with a top-to-bottom white-to-grey gradient fill. Section H2 "aBCFavorit" (geometric grotesque), 56/67 px, weight 400, tracking -2.8 px (tight); second half of H2s dimmed (e.g. "Integrate **tonight**" purple, "Reach humans, **not spam folders**" grey). Body Inter 16/24. Code: Commit Mono.
- Spacing: sections 700-1,400 px tall with ~120 px vertical padding; content max width ~1232 px (nav and cards from x=104 to x=1336); code window 1024 px wide centered.
- Radii: cards 16-32 px, large container ~32 px, pills fully round (3.4e7 px). Shadows: none; depth comes from gradient top-edge highlights (1 px light line on card top).
- Backgrounds: pure black, soft radial glows, a diagonal light streak in the hero, no grid/noise.
- Iconography: thin 1.5 px line icons in rounded-square 40 px tiles; hero art is 3D matte-black renders (cube, envelope tile, globe tile) that share lighting.

## 4. Product imagery
Real UI, large and cropped: the editor and analytics dashboard are full-width framed windows (rounded 24+ px, hairline border, top highlight) that fade to black at the edges. Code is shown as live text rather than images. 3D "app icon" tiles act as section markers. Readable because each frame has one screen of content, high contrast on black, and a one-line H2 above it.

## 5. Motion & interaction
- Language icon row and framework tab row switch the code sample (click; instant swap). Copy button in code header.
- Hero cube rotates/drifts continuously (video or canvas loop, not pausable in view). Cards fade/translate in on scroll (observed: content below fold empty until scrolled to, so I scrolled with 700 ms waits).
- Analytics tab-cards switch the dashboard image. Nav dropdowns open on hover. Footer wordmark is static.
- Reduced motion / mobile: not verified; hero art stays on mobile.

## 6. "How to use" / get started
- Landing page: code sample IS the how-to ("Integrate tonight": pick language, copy snippet). No step list, no install command on the page; "View on GitHub / Download ZIP" under the snippet link to example repos.
- Docs intro (resend.com/docs/introduction, top only): left nav "Get started: Introduction, Create API key, Add domain, Email types, AI onboarding, Sending examples"; opening line "Resend is the email API for developers."; prerequisites list "Your own domain, verified with Resend / A Resend API key"; "Quickstart" is a link list of 14 language quickstarts; "Explore" is 4 cards (Emails, Domains, Webhooks...). Page-level "Was this page helpful? Yes / No", llms.txt and llms-full.txt advertised at the top (AI-readable docs).

## 7. Trust & proof
Customer quotes with logos/titles (e.g. "CEO at Vercel"), SOC 2 and GDPR links in footer, status pill in footer, 4 regions. rightnow could honestly use: a live status-style pill (e.g. CI badge/"version vX.Y"), a GitHub stars count, and docs transparency. Not usable: customer quotes, logos.

## 8. Navigation, footer, CTA cadence
Nav: Features, Company, Enterprise, Help, Docs, AI (dropdowns), Pricing, Log in, Get started. Sticky with blur. 48 internal links on the home page. "Get started" appears: nav, hero, closing CTA (3x), plus in-nav docs. Footer: 5 columns + address + socials + status.

## 9. Copywriting
Terse, confident, benefit-first; H2s are 2-6 words ("Integrate tonight", "Test mode", "Modular webhooks"). Feature names are plain nouns. Jargon (DNSBL, BIMI, VMC, DMARC) is allowed but linked/underlined with a one-line gloss ("the email equivalent of a checkmark on social media"). Voice: "We are a team of engineers who love building tools for other engineers."

## 10. SEO
- Title: "Resend · Email for developers". Description: "The best way to reach humans instead of spam folders. Deliver transactional and marketing emails at scale." Canonical https://resend.com. OG/Twitter: title, description, `og:image` /static/cover.jpg, `twitter:card=summary_large_image`.
- JSON-LD: Organization, WebSite, SoftwareApplication, WebPage, BreadcrumbList.
- Headings: single H1; ~10 H2 for sections; H3 for each deliverability feature (good long-tail coverage). No "alternative to" pages visible on home. Page is 12k px but uses lazy sections.

## 11. Mobile
Hamburger at right; hero stacks centered with the cube above the text, CTAs stack full width (Get started filled-dark, Documentation as text link). Code windows scroll horizontally inside their frame. Nothing broke.

## 12. Verdict
Strong, borrowable:
1. "Integrate tonight" pattern: tabbed code sample is the whole how-to. Adapt: tabs "Docker Compose / Env / First campaign" showing the real `docker compose up -d` and `.env` lines with a copy button.
2. One-line H2s with the second half dimmed: easy typographic emphasis.
3. Deliverability section as a 3x3 icon grid with a one-line gloss for jargon: adapt to warm-up, rotation, unsubscribe, freshness gate, held-not-resent, honest sender identity.
4. Dashboard shown as one large cropped real screenshot driven by 3 tab-cards (Analytics / Inbox / CRM).
5. Footer status pill + llms.txt for docs.
Avoid / weak: pure black with 3D renders is costly and generic for us; almost no SEO "alternative" content; Get started funnel (we have none): replace with "Star on GitHub" and "Read the docs".
