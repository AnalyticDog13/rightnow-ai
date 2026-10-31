# lemlist (www.lemlist.com) - landing-page reference

Captured 2026-10-30, headless Chromium, desktop 1440x900 + mobile 390x844. Height 11,506 px desktop / 14,831 px mobile. Screenshots: `scratchpad/specC/lemlist-d00..d14.jpg` (viewed d00, d01, d02, d05), `lemlist-m00..02`. No "extra" URL was set (blog unchecked). A cookie banner (Axeptio, bottom-left, "No / Customize my choices / OK") was NOT dismissed by my script, so it covers part of each screenshot; layout was still readable. The page also includes hidden variant H2s ("Welcome, Secret users", "Welcome Better Growth visitors", "Roxane t'a donne 1 mois gratuit...") = referrer/UTM personalization banners, not seen visually.

## 1. Snapshot
- URL https://www.lemlist.com; category: sales-email SaaS (cold-email and multichannel outbound), a direct competitor of Instantly.
- H1 verbatim: "The only platform you need to make Outbound work." Subhead: "Know who to target and why now, find verified contacts, and engage across every channel from lemlist, your CRM, or your AI assistant." + second line "Powered by all your context and millions of real sales interactions."
- CTAs: "Start free trial" (white pill on orange hero; dark in nav) and "Get a demo" (translucent). Nav: Log in, Get a demo, Start free trial (dark #2a2a2a-ish), language switcher EN.

## 2. Page anatomy
1. Floating white nav pill (68 px tall, inset 100 px from edges, rounded 16 px, soft shadow): logo, Product / Use cases / Resources (mega-menus, see below), Pricing; right: language, Log in, Get a demo, Start free trial. Mega menu Product lists: 650M+ Lead Database, Email Finder & Verifier, Phone Number Finder, Multichannel Sequences, LinkedIn Prospecting, LinkedIn Voice Messages, In-app Calling, SMS Campaigns, WhatsApp Prospecting, Unified Inbox, Email Infrastructure, Inbox Delivery, Monitoring & Alerts, lemAgent; plus "Intent Signal Agents", "lemlist MCP", "lemlist CLI".
2. Hero (~740 px): full-bleed AI-generated image of a LEGO-style Mars colony (orange desert, rocket, modules linked by blue tubes) - brand "outbound launchpad" metaphor; H1 left (56/64 px white on orange, weight 600, tracking -2.24 px), subhead + buttons right (asymmetric 2-col).
3. Product demo window (starts overlapping hero bottom, ~700 px): macOS-style window with 4 tabs (Let AI handle it / Find & enrich leads / Spot buying intent / Engage on multi-channels / Avoid spam). Default tab shows "lemAgent - New conversation": "Hi Owen, what do you want to achieve? Ask a question or click on a suggestion below" with chips "Find enriched leads", "Create a campaign", "Improve my campaigns", "Other (enter)" and a prompt textarea "Describe what you want to do...".
4. Logo wall (3x4 grid cells with hairlines, cells show logos grey: Scale, Blackbird.ai, PostHog (tag "CASE STUDY"), airOps, attio, Crusoe, Spendesk...), caption "& 20,000+ other sales teams run their entire outbound in lemlist".
5. Hatched divider band (diagonal stripes) as a section separator, framed by dashed lines and corner cross marks.
6. Features: pill label "FEATURES", H2 "From full TAM coverage to your top accounts, run outreach that still feels 1:1" (40/44 px, 700). Then **5 sticky stacking cards** (numbered badges 01-05): 01 "Find leads that match your ICP and their verified contacts" ("Upload leads from your CRM or CSV and enrich them with verified emails and phone numbers..." + lead database table UI), 02 "Know when leads are ready to talk and act immediately", 03 "Score, segment, and personalize with leads' unique context" ("Data enrichment agents pull structured insights..."), 04 "Run outbound across multiple channels, from the same campaign" ("Launch automated campaigns across email, LinkedIn, calls, WhatsApp, and SMS from one workflow. Manage every conversation in a unified inbox, no matter the sender or channel." + flowchart UI with If/Wait for 1 day/Visit LinkedIn profile/Email opened), 05 "Protect deliverability across your entire outbound operation". Cards alternate image side (left/right), have a purple/green/pink nebula image backdrop behind a white UI crop.
7. "Built to back outbound pros like you" (role selector: For Sales Reps / Sales Leaders / Founders / RevOps, grey pill buttons).
8. "Recognized by G2. Trusted by thousands." (badges) and "Here's what they say about us" (testimonial carousel).
9. "Fits your workflow, Not the other way around." (integrations).
10. "Steal the outbound playbooks behind today's top sales teams": 3 case-study cards ("Achieve 145% Quota by Tom Greenwood, BDR Team Lead at Paddle", "Book 120 Quality Calls a week...", "Get 35% Outbound Pipeline by ... ElevenLabs").
11. FAQ (6 questions with FAQPage schema): What is lemlist? / Who is lemlist for? / How does lemlist help with email deliverability? / Does lemlist comply with SOC 2 security standards? / Can I integrate lemlist with my current sales stack? / How can I get started with lemlist and see how it works?
12. Closing "Your next deal is no longer light-years away." + CTAs (space tie-in). 
13. Footer: ~100 links - product, solutions by role, customers (ElevenLabs, Pennylane, Spendesk...), resources, "All free tools" (Email finder, Email checker, Email permutator, Cold email generator, Buyer persona generator, Spam words checker, Deliverability setup checker, Email signature generator), "Structured data for LLMs", Sitemap.

## 3. Visual system
- Light base: white #ffffff + near-white #fafafa surfaces; text rgb(24,24,26) (#18181a); hero orange gradient (~#d96a2b to #c85a1f) with warm sunset photo; accent blue #2f66f5-ish on logo, buttons in cookie banner; grey pill buttons #eee (rgb 238) with 10 px radius. Section color comes from AI nebula images (purple, green, pink) behind white UI crops.
- Type: Manrope display (H1 56/64 600, tracking -2.24 px; H2 40/44 700 normal tracking), Inter body 16/24, JetBrains Mono for small labels (FEATURES, CASE STUDY). Buttons 14-16 px/500.
- Layout: 1,280 px framed column with continuous 1 px vertical rails (x=80 and x=1360), dashed horizontal lines, small "+" cross marks at intersections (blueprint look). Cards 16-24 px radii; nav pill 16 px; chips 10 px (case-study tag 0/10/10 corners = ticket shape).
- Shadows soft and large on white UI crops; sticky cards get stacked shadow edges.
- Imagery: LEGO-style AI-rendered scenes (Mars colony, space theme), nebula backgrounds, 3D badges.

## 4. Product imagery
Real UI in white crops with realistic data (Lead database "15,276 leads found", names, FIND EMAIL/FIND PHONE chips, green verified ticks), cropped by the card edge so the UI bleeds off to the right; each is placed on a vivid color nebula to pop. The hero demo window is an interactive-looking agent chat. Readability comes from: one UI idea per card, colorful backdrop, large H3 above, and a one-sentence caption.

## 5. Motion & interaction
- Feature cards: sticky scrollytelling stack (each card sticks at ~80 px under the nav and the next slides over it, previous card scales/peeks above showing curved top edge, visible at d05). Numbered badge in each.
- Hero demo window: tab pills (5) swap the content; suggestion chips; typed prompt animation likely (not verified).
- Role selector buttons (For Sales Reps / ...) swap testimonials/content. Logo wall: static grey, color on hover (not verified). Language switcher; mega-menu hover.
- Cookie banner bottom-left (Axeptio) with "No / Customize my choices / OK" appears on first load and persists until clicked.
- Reduced-motion: not verified.

## 6. "How to use" / multi-step explanation
No numbered how-to, no install; "how it works" is the 5 stacked feature cards in funnel order: find -> time -> personalize -> run multichannel -> protect deliverability. Multi-step campaigns are shown as a real sequence-builder screenshot (conditional branch "If Has score >= 80", "Wait for 1 day", "Visit LinkedIn profile", "Email opened" with channel icons) cropped inside card 04. FAQ ends with "How can I get started with lemlist and see how it works?" (answer pushes the trial). No GitHub/self-host.

## 7. Trust & proof
Logo wall + "20,000+ sales teams", G2 badges, 3 case-study cards with quantified outcomes, testimonial carousel, SOC 2 FAQ answer, integration logos. rightnow cannot honestly use any of that today. Usable analogues: "Used by 1 maintainer" is not proof; instead show open code, MIT license, test counts, CI status, a documented security model, public roadmap; later real user stories.

## 8. Navigation, footer, CTA cadence
Floating pill nav with 3 mega-menus + Pricing, 120 internal links. CTA "Start free trial" and "Get a demo" in nav, hero, after feature stack, after FAQ, and in closing section (5-6 times). Footer is a content hub (free tools, case studies, playbooks, API refs).

## 9. Copywriting
Assertive, outcome-numbers, second person: "The only platform you need to make Outbound work", "run outreach that still feels 1:1", "Steal the outbound playbooks". H3s are full sentences starting with a verb (Find / Know / Score / Run / Protect). Heavy sales jargon (ICP, TAM, intent signals) used freely; claims are superlatives ("the only platform"), which rightnow should avoid. Space/launch metaphor reused in the closing line.

## 10. SEO
- Title "The only platform you need for outbound | lemlist"; description "Know who to target and why now, find verified contacts, and engage across every channel from lemlist, your CRM, or your AI assistant." Canonical https://www.lemlist.com/. OG complete incl. locale alternates fr_FR/de_DE/es_ES (hreflang-style localization); twitter:card summary_large_image.
- JSON-LD: Organization, WebSite, WebPage, **FAQPage** (6 Qs). H1 once; H2 per section; H3 per feature (keyword-rich, e.g. "multiple channels", "deliverability"). Strong internal linking to free tools (email finder/checker/spam words checker) - link-bait for "cold email" searches; "Structured data for LLMs" link and sitemap in footer.

## 11. Mobile
Hero photo stays, H1 centered in 3-4 lines; floating nav pill collapses into logo + hamburger + a CTA; mega-menus become accordion; feature cards unstick and stack vertically (14.8k px page); UI crops stay full width, tabs in demo window become horizontally scrollable pills. Cookie banner covers the bottom third on first view.

## 12. Verdict
Strong, borrowable:
1. Funnel-ordered numbered feature stack (find -> engage -> protect) with sticky stacking cards: adapt to rightnow's 5 steps: connect mailboxes -> warm up -> build sequence -> send within limits -> inbox/CRM.
2. Showing a multi-step campaign as a real flowchart crop (If/Wait/Channel) in one card; for rightnow show email step 1 -> wait 2 days -> follow-up with A/B variants and "reply stops sequence".
3. Free-tools hub in the footer (spam-words checker, deliverability setup checker, email permutator) as SEO magnets: rightnow could ship a static "SPF/DKIM/DMARC checker" or "warm-up planner calculator" without any server.
4. FAQPage JSON-LD with 6 honest questions (What is rightnow? Is it free? Does it send mail for me? How does warm-up work? Where is data stored? How do I deploy?).
5. Blueprint frame (rails + dashed lines + cross marks + hatched divider): distinctive "engineering paper" structure that costs only CSS.
6. Hero demo window with 4-5 tabs; and "For Sales Reps / Sales Leaders / Founders" role chips (adapt to "Laptop / VPS / Developer").
Avoid: "the only platform" superlatives, 650M-lead-database style claims, logo wall/G2/case-study numbers, trial CTAs, AI-generated LEGO imagery (off-brand), un-dismissed cookie banner, personalized "Welcome X visitors" variants.
