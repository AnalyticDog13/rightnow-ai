# Superhuman (superhuman.com) - landing page reference

Captured 2026-10-30, headless Chromium 1440x900 and 390x844. Screens `specA/superhuman-d00..d08.jpg` (9 screens cover all 6,411 px; I viewed d00, d03, d06), `superhuman-m0..m3.jpg` (not viewed; mobile facts come from DOM metrics: scrollWidth 390, height 8,488 px). Extra `/blog` was not fetched (marked unchecked in the shortlist). Note: this homepage is no longer an email-client page; it is the "Superhuman suite" (Mail, Grammarly, Docs, Go) after the Grammarly rebrand. There is a banner pointing email-seekers to Mail: "Looking for Superhuman Mail? Learn more". The email-specific page is /mail (not captured).

## 1. Snapshot
- URL https://superhuman.com. Category: AI productivity suite (email client + docs + writing assistant).
- H1 (verbatim): "Superpowers, everywhere you work"
- Subhead: "Mail, Docs, and AI that works in every app and tab"
- CTA: "Get Superhuman ->" (dark pill-ish button with a purple gradient arrow chip). Header: "Contact sales", "Sign in v".
- Top banner (full-width rounded bar, maroon #421d24 on the hero photo): mail icon + "Looking for Superhuman Mail?" + "Learn more ->" outlined button.

## 2. Page anatomy (6,411 px desktop, 8,488 px mobile)
1. Banner, 72 px, translucent plum rounded bar inset 32px, inside the hero.
2. Header, ~66 px, transparent on hero then white sticky: logo "SUPERHUMAN" (small caps wordmark with an icon), nav Products v, Solutions v, AI v, Resources v, Pricing v, Love; right: Contact sales, Sign in v (outlined).
3. Hero (931 px): full-bleed photographic/painted sky gradient (blue to lilac, see d00) with a looping video of a woman in profile looking up at tall grass. H1 64px white, centered, 2 lines. Floating glass UI cards (frosted, blurred, ~12px radius) overlay the video: left, an AI chat card ("Looks like you're chatting with Antonio and Laura in the #launch-project-chat and need to book a meeting. Would you like me to find a good time?" with a "yes!" bubble, time chips "Monday at 3:00 PM" / "Tuesday at 1:00 PM", input "book it for monday"); center, a vertical dock of 5 app icons (Go, Grammarly, ... calendar); right, a Docs card "Team workspace / Streamlining Team Documentation" with a formatting toolbar, plus a pill "Tailor this language for executives"; bottom-left, an inbox list with tabs "Important 12 / Calendar 13 / Docs 8 / Other 19" and rows (Sarah Kim "Design Review moved to Thursday", James Patel, Laura Chen).
4. "Your Superhuman suite" (3,452 px, bg warm #f2f0eb, framed by diagonal-hatch borders on left and right edges): H2 ~48px "Your Superhuman suite" left, outlined button "Get the suite" right (purple text #714cb6, 1px purple border, radius 12px). A 4-tab bar: Mail | Grammarly | Docs | Go (icons per product; the active tab is darker). Then four stacked product panels, each a 2-column split (text left ~50%, media right): label with icon ("Mail", "Grammarly", "Docs", "Go"), H2 headline, short paragraph, "Learn more about X ->" purple link, a check-list of 4 benefit rows with circle bullets (Grammarly: "Works everywhere you write", "Find the right words instantly", "Write with AI that adapts to your tone and voice", "Let your brilliance shine"), and a looping video/animation on the right with a pause button bottom-left (d03).
   - Mail: "The most productive email app ever made"
   - Grammarly: "Everyone's favorite AI writing partner"
   - Docs: "The best place for teams and AI to work together"
   - Go: "AI that actually works in every app you use"
   Panels are separated by hatched divider bands (diagonal lines) and dashed hairlines.
5. Another "Your Superhuman suite"-style block / spacing (298 px).
6. "Becoming Superhuman." (556 px, deep teal #0c4243): editorial announcement, photo of a woman on the left, text and outlined button "Read our announcement" (d06).
7. "AI that works everywhere you work" (480 px): big 56px dark-ink H2 left over a blurred pink/blue cloud image with faint monospace text overlay; white "Get Superhuman" button right (d06). This is the closing CTA.
8. Footer (852 px, maroon #421d24): logo, tagline "Builders of Superhuman Platform apps", columns Products, Company, Legal, Connect (LinkedIn etc.).

## 3. Visual system
- Colors: text #292827 (warm black), bg #ffffff; warm paper #f2f0eb for the suite section; hero sky gradient lilac/blue; deep teal #0c4243 and maroon #421d24 as editorial block colors; brand violet #714cb6 for links/outline buttons; hero primary button near-black #1a1530 with purple-blue gradient arrow chip; white buttons on photo.
- Type: custom "Super Sans VF" (variable). H1 64px / 61.44px line-height / weight 540 (tight, ~0.96). H2 sections ~26px/33.8px/weight 460 for small labels, larger display H2 at 48-56px for section heads (weights 400-460, light and airy). H3 28px/540. Body 16px. Buttons 14-16px/600. Nav 15px/460.
- Radii: banner 16px, buttons 8-12px, cards 12-16px, input pills full.
- Spacing: container 1376 px; hero 931 px; section heads 100px above; panels ~750 px each.
- Backgrounds: photographic sky video hero; frosted glass cards (backdrop blur + white/10% fill); hatched diagonal-line borders as a printed-paper motif; solid editorial color blocks; blurred cloud image for the end CTA.
- Iconography: product-color app icons (Mail purple envelope, Grammarly green G, Docs plum, Go dark A).
- Illustration: none flat; real photography with composited UI.

## 4. Product imagery
- UI shown as composited, simplified, high-contrast cards over video (hero) and as looping screen recordings in the tab panels. Crops are tight to a single interaction (typing into an input; a doc being edited). Glass cards with blur keep text readable on a busy photo. Readability depends on large type inside cards (14-15px at 1440).
- Real product data is staged ("Sarah Kim", "Design Review moved to Thursday"). Mail section uses an inbox with split tabs; the key email metaphors (Important / Calendar / Docs / Other tabs) read instantly.

## 5. Motion and interaction
- Hero background video loops; glass cards animate in with a typed chat ("book it for monday" typed) and AI suggestion highlights (underlined "new-hires", "repetative").
- Suite tab bar (Mail / Grammarly / Docs / Go) scrolls to or switches the corresponding panel; the sticky tab bar stays under the header while panels pass (d03 shows it pinned with hatched side borders).
- Each panel has a pause button (accessible; d03 bottom-left of media) for the loop. Looping product videos are blurred/lazy until in view (d03 media is blurred mid-load).
- Hero banner dismiss not seen. Reduced-motion not tested; pause control suggests WCAG 2.2.2 awareness.

## 6. How to use / get started
- No steps on the page. The only "get started" is "Get Superhuman" (account/download). rightnow cannot reuse this; but the suite's per-product "check list of 4 benefits + Learn more" is a compact pattern for describing a flow without a how-to section.

## 7. Trust and proof
- A "Love" nav item links to /products/testimonials; the homepage itself carries no logos, stats or quotes in the viewed range (partly weaker than Attio/Instantly). "Becoming Superhuman." is brand-story proof (merger announcement). Honest takeaway: proof can be moved off the homepage into a dedicated page, as here.

## 8. Navigation, footer, CTA cadence
- Header transparent over hero then white and sticky; mega menus: Products (Go, Agents, Mail, Calendar, Docs, Databases, Store), Solutions (Enterprises, Education, team types, use cases), AI (agents: Grammarly, Email Assistant, Agent Store, Connectors, Mail MCP, Docs MCP), Resources (What's new), Pricing, Love.
- CTA cadence: hero "Get Superhuman", "Get the suite" (right of suite head), per-product "Learn more", "Read our announcement", closing "Get Superhuman". 3 primary CTAs total. Footer 4 columns on maroon.

## 9. Copywriting
- Voice: aspirational, short. Formulas: "Superpowers, everywhere you work"; "The most productive email app ever made" (superlative claim); "AI that actually works in every app you use"; "Becoming Superhuman." Parallel product headlines (The X for Y). Bullets in the Grammarly list are lines of slogan ("Let your brilliance shine"), vague. Speed-obsession from the old Superhuman brand is largely gone from this page; no "keyboard shortcuts / 100 hours" copy was seen.

## 10. SEO
- Title "Superhuman: Docs, Mail, and AI That Work Everywhere" (note: it has changed from the old email-client positioning). Meta description "Superhuman is the AI productivity suite that gives you superpowers everywhere you work. So you can be more creative, strategic, and impactful." Canonical https://superhuman.com/. OG title/description same; og:image is an animated GIF (HP-Meta-Image-8-12-2026), og:type website, twitter summary_large_image. JSON-LD: none found. Headings: one H1, 15 H2s repeating product names twice (tab bar + panel). 78 internal links; per-team and per-use-case URLs (/teams/sales, /docs/use-cases/...). Keyword terms in homepage: "email app" appears in the Mail H2 only.

## 11. Mobile (390 px, DOM metrics only)
- No horizontal overflow (scrollWidth 390). Page grows to 8,488 px since the 2-column panels stack and floating hero cards stack under the H1. Specific layout not viewed. The 4-tab suite bar is likely scrollable or compressed; unverified.

## 12. Verdict
Executed well (ranked):
1. Tabbed product suite: one sticky tab bar, one panel per product, each panel = label + H2 + short paragraph + 4 check-lines + "Learn more" + looping demo with a pause button. Adapt: tabs "Mailboxes | Warm-up | Campaigns | Inbox | CRM | Analytics" with real screen recordings (webm, muted, autoplay on view, pause button, `prefers-reduced-motion` shows the still poster).
2. Frosted-glass floating cards over a hero, built from real UI fragments (chat, inbox with tab chips, editor toolbar). Adapt: the rightnow hero could float three coded fragments (a warm-up health card, an inbox thread, a campaign step) over a calm gradient (no stock photo needed).
3. Calm, light type (weights 400-540, tight line-heights) with generous space; looks expensive.
4. Editorial color blocks (teal, maroon) to break rhythm; adapt as one dark "Self-host it" band.
5. Pause button on loops; honest accessibility pattern.
Avoid / weak:
- Banner redirect "Looking for Superhuman Mail?" shows the page no longer explains email; keep rightnow's page single-purpose.
- Vague slogans ("Let your brilliance shine"), no numbers or steps, no proof on the page, no keyword-rich headings; poor for "instantly alternative" style search.
- Photo-based hero requires licensed media; rightnow should use generated gradient + real UI.
- Blur-loading placeholders on demos look broken when the video lags (d03): ship a poster image.
