# n8n landing page reference

Captured 2026-10-30, headless Chromium, 1440x900 and 390x844. Homepage height 12,904px. A cookie dialog (left, 300px wide) covers part of the left edge in every desktop shot, so some left-aligned text is hidden; I did not dismiss it. Screenshots in specB: `n8n-d0..d11.jpg`, `n8n-m0..m2.jpg`, `n8n-mmenu.jpg`, `n8n-extra.jpg`. Dark mode: the page is light with dark inset panels.

## 1. Snapshot
- URL: https://n8n.io. Category: open-source (fair-code, "Community edition") workflow automation, hosted cloud plus self-host.
- Positioning: "n8n is the platform for agents and workflows you can follow. Open any step, see what it does, and explain to anyone who runs it."
- H1 verbatim: "Build the agent. Understand its workflow." (two lines, 64px, centred).
- CTAs: "GET STARTED" (pink pill) and "TALK TO SALES" (grey pill). Nav: "SIGN IN", "GET STARTED". All CTA labels are uppercase mono.
- The shortlist said "self-host-in-Docker is stated up front". In this capture it is not in the hero: "Self-host your AI stack" is an H3 in the third section, and the hosting docs carry the `curl | sh` one-liner.

## 2. Page anatomy
1. Floating pill nav (grey `#F1F1F1`, radius 24px, ~52px tall, inset 48px from edges): logo "+++ n8n", PRODUCT, USE CASES, DOCS, COMMUNITY (each with chevron), ENTERPRISE, PRICING, SIGN IN, GET STARTED (pink).
2. Hero (~810px): dotted-grid background (small dots on 34px pitch), H1, sub (two lines), two pills, then a prompt box (grey card ~590px wide): a text area with typewriter "When a refund request comes in, look up the order. Then ask me in Slack whether to refund it or open a t", attach, mic and send icons (pink send button), plus three example chips in mono caps: PROCESS INVOICE, KNOWLEDGE ASSISTANT, DAILY NEWS DIGEST. Below, a workflow canvas is revealed (dark panel) once a prompt is "run" (d1).
3. "Trusted by Fortune 500 companies to build smarter workflows." logo row (Meta, Zendesk, Mistral-like, Vodafone, Microsoft-like, T-Mobile, Mercedes), mono-black single-colour logos, ~178px.
4. Tabbed use-case panel (dark rounded container ~1190px wide, ~730px tall): tabs "MARK, IT", "DEBORAH, SECURITY", "OLU, DEVOPS", "ALIX, SALES" each with an H3 "How Mark automated new user onboarding" etc., a 2-line story, and on the right a real workflow canvas (nodes: New Hire in BambooHR > Create Okta Account > Create Google Account > Create Jira Account > Add to Team Channels (Slack) > Create Onboarding Checklist (Notion) > Wait for all accounts).
5. Proof strip: three pills, each ~390x74px: GitHub icon "Top 50 Github project with 209.1k stars", G2 "Rated 4.7/5 from real users on G2", community photo "Join 250k+ developers in our community". Rule lines with "+" at the corners.
6. "The USB-C for your AI stack" (centred H2 48px): "Connect n8n to just about any tool you can think of. 500+ native integrations. Any API via HTTP. Any agent or coding assistant via MCP." Floating app icons (Redis, Slack, etc.) drift in around the heading (900px tall).
7. "See + understand + trust your agents" (H2) with an accordion list on the left (Full visibility across agents / Put rules around AI actions / Self-host your AI stack) and, on the right, a dark panel (~875x490) showing a workflow canvas with an AI Agent node, chat model, memory, tools; each accordion item swaps the canvas. Section is sticky/scrollytelling: height 2682px, the left list and right panel stay pinned while items advance (d4-d6).
8. "Built by you + readable by anyone" (H2) same pattern: items "Documentation, built in" / "Recover in one step" / "Every change, tracked", the right dark panel showing a Versions list (e.g. "OpenRouter Version 581e89b3 (Published)", "Anthropic Version 4875d2cd", Actions menu, Publish Timeline tab).
9. "Move fast + break nothing" (H2): a photo of two people at a laptop (rounded 24px) on the left, a grey rounded text card on the right: "Shipped months ago. Still in control. Feels good, doesn't it? * Move fast. Replay a past run or mock the data. Skip waiting on external systems. * Break nothing. See exactly what happened in the logs. No digging required. Now imagine that across your whole company."
10. "Enterprise-ready for teams of any size" (H2): "Scale AI without losing control. Security, governance, and handoff built in." Buttons "EXPLORE ENTERPRISE" (pink) and "TALK TO SALES" (grey). Four dark cards (~285x390) each with a pixel-dot icon (white square pixels on a dotted field) and a title + 1-line description: Security + control (SAML, secret stores, permissions), Observability + transparency, Developer experience ("Git-based control, isolated environments, multi-user workflows, workflow diffs."), AI governance ("Human-in-the-loop, guardrails, evaluations.").
11. Case-study blocks ("Huel saved 1,000 hours with an AI-first culture", "Vodafone delivers GBP 2.2M security operations win") with "Read Case Study" links; two quote bars on grey `#F0F0F0` (~180px).
12. Closing H2 "Build workflows the way you actually think" + "Start building" CTAs (~650px), then footer.

## 3. Visual system
- Palette: page bg `#FAFAFA` (body `rgb(250,250,250)`), text `#161616` (`rgb(22,22,22)`), surfaces light grey `#F1F1F1`/`#F0F0F0`/`#D9D9D9`, dark panels `#212121`, accent pink `#FFBCCA` (`rgb(255,188,202)`) for primary pills and the doc site's brand pink (`#E5127D`-ish) for links; dots/borders `#D9D9D9`.
- Typography: custom "n8n Baumer Uniwidth" (a clean grotesque) for headings and body, plus a mono face for nav and buttons (uppercase, letter-spaced). H1 64px / 54.4px line height (0.85, extremely tight), weight 500, tracking -0.64px. H2 48px / 48px, weight 500, tracking -0.48px. Body 16/24. Buttons and nav 14px, uppercase, mono, weight 400.
- Spacing: sections padded 96px vertical, 24px sides; heroes are ~800px; content max ~1190px.
- Radii: pills 9999px; dark panels 24px; cards 24px; photos 24px.
- Shadows: tiny blur under pills; otherwise flat.
- Backgrounds: dotted grids (light-on-light in hero, dark dots in the dark panels), "+" markers at card corners, no gradients.
- Iconography: pixel-dot icons (white squares on a dot grid) for enterprise cards; brand logos in flat colour inside canvas nodes; the logo is "+++".
- Illustration: only product canvas screenshots and photos.

## 4. Product imagery
- The product's own canvas is the illustration. Nodes are real-looking (webhook, Okta, Jira, Slack, Notion), laid out as a left-to-right graph with curved connectors, labelled below each node in 8-9px text, on a dark `#212121` panel with a dot grid. The dark panel against the light page makes the node icons pop. Graphs are cropped at the panel edge to imply bigger flows.
- A "prompt box" hero that runs the product: you see an input, then a generated workflow.
- Photographs (people at laptops) are used once for the "break nothing" section.

## 5. Motion & interaction
Caveat: captures are static JPEGs. Directly visible: partial typewriter text in the hero prompt, faded floating icons (d2), pinned left list with a changing right panel across d4-d9. Hover states, tab clicks and the mobile behaviour are inferred, not tested.
- Typewriter text in the hero prompt; example chips probably fill the box (not clicked).
- Sticky scrollytelling for "See + understand + trust" and "Built by you": left accordion advances while the right dark panel stays pinned (screens d4-d9; section height 2682px each).
- Tabs for the four use-case personas (click to swap story + canvas).
- Floating integration icons drift around "The USB-C for your AI stack" (d2: icons at varying opacity).
- Logos appear to be static; hover states on pills darken slightly (not measured).
- Mobile: scrollytelling collapses to stacked blocks (not captured beyond m0); `prefers-reduced-motion` not tested.

## 6. "How to use" and "self-host" presentation
- Homepage: no step list. Use is shown by the prompt box and the persona canvases. Self-host appears as the third accordion item "Self-host your AI stack" and in the footer/Docs menu; there is no GitHub CTA button in the hero, only the proof pill "Top 50 Github project with 209.1k stars".
- Hosting docs (https://docs.n8n.io/deploy/host-n8n, `n8n-extra.jpg`): left tree (Use n8n Cloud, Host n8n, Install options, Configure n8n, Keep n8n running, Understand the architecture, Deploy as an OEM integration, Deploy with the AI starter kit, Compare editions). Top tabs: Get started, Deploy, Build, Nodes, Connect, Administer, Contribute. Intro: "You can self-host n8n on your own infrastructure, on-premises, or in a private cloud, using Docker Compose, one-line setup, or other deployment methods."
- Green "tip" callout, exact copy: "Don't want to read the docs? Run this:" then a code block `curl -fsSL https://get.n8n.io | sh` with a copy icon, followed by "Requires Docker on Linux or macOS (or WSL on Windows). Sets up n8n locally in one step. See the one-line setup guide for what it does, or keep reading to compare every installation method."
- Further copy: "All self-hosted installations use the same core product. Without a license key, n8n runs as the free Community edition. Adding a Business or Enterprise license key enables those editions. See Compare editions for the differences between the self-hosted editions."
- Docs UX: "Copy" (page as markdown) button, Ctrl+K search, an "Ask AI" floating button, light/system/dark toggle, "Was this helpful?" faces, `llms.txt` hint.

## 7. Trust & proof
- Fortune 500 logo strip, GitHub star count, G2 rating, community size, two long case studies with hard numbers, two pull quotes, enterprise feature cards (SAML, secret stores, audit logs), uptime not shown.
- rightnow-ai can honestly use: a live GitHub star count and repo pill, "Join the community" (Discussions/issues link) with a real count, the open-source licence line, a "readable by anyone" principle (every send decision is logged; held messages are explained), version history. Cannot use: Fortune 500 logos, G2, case studies.

## 8. Navigation, footer, CTA cadence
- Nav items: PRODUCT, USE CASES, DOCS, COMMUNITY (dropdowns), ENTERPRISE, PRICING; right: SIGN IN, GET STARTED. Floating pill, fixed. ~34 internal links on the page, notably few for a 12,904px page.
- CTAs: nav (always), hero pair, Enterprise pair, closing "Start building": ~5 sets, same two pink/grey pills each time.
- Footer links: n8n.io, Careers, Contact, Press, Brand guidelines, Merch, Legal, Events, In The Loop, Partners, Hire an expert, Affiliate program, Join user tests, Case Studies, AI agent report, n8n alternatives, Education, n8n on SAP, Imprint, Security, Privacy, Report a vulnerability; social: Twitter/X, GitHub, Discord, Linkedin, YouTube. Note the "n8n alternatives" page.

## 9. Copywriting
- Voice: confident, short, parallel structures with a "+" device: "Build the agent. Understand its workflow." / "See + understand + trust your agents" / "Built by you + readable by anyone" / "Move fast + break nothing". Section headings are 3-6 words. Persona stories use first names with job titles ("How Mark automated new user onboarding"). Metaphor for jargon: "The USB-C for your AI stack". Bullets begin with a bold two-word imperative ("Move fast.", "Break nothing."), followed by one short sentence. The "+" replaces "and", giving the brand a recognisable verbal tic (echoed by the "+++" logo).

## 10. SEO
- Title: "AI Workflow Automation Platform - n8n". Meta description: "n8n is a workflow automation platform that uniquely combines AI capabilities with business process automation, giving technical teams the flexibility of code with the speed of no-code."
- Canonical https://n8n.io/. OG: title "n8n.io - AI workflow automation platform", description, url, type, image (Azure blob). Twitter: card is "summary" (not large image), site @n8n_io.
- JSON-LD: Organization only.
- Headings: H1 repeated twice in markup (visual duplication of "Build the agent..." seen in the outline); H3 per persona story; H2 per section with the "+" glyph.
- Strategy relies on the huge template/integration directory and "n8n alternatives" page in the footer rather than the homepage; homepage has few internal links (34).
- Page speed: heavy (large JS canvas panels), not measured.

## 11. Mobile (390x844)
- Nav collapses into a grey pill bar with logo "+++ n8n" and a dotted hamburger glyph. H1 wraps to three lines at ~52px, centred. The cookie dialog is a bottom sheet covering ~60% of the first viewport, hiding the CTAs (`n8n-m0.jpg`, `n8n-mmenu.jpg` shows the same sheet over the page; the menu itself was not seen because the click did not open it). Dotted background persists.

## 12. Verdict
Done well, ranked:
1. A dark workflow canvas inside a light page, cropped at the edges, as the visual signature. Adapt: show a rightnow-ai sequence/automation graph (Trigger "Reply received" > Condition > Action "Stop sequence" / "Webhook") on a dark panel; it makes the automations feature self-explanatory.
2. Sticky scrollytelling with a left accordion and a pinned right panel. Adapt for three or four features (Warm-up, Campaigns, Inbox/CRM, Automations), each swapping the right panel; fall back to stacked sections on mobile and under reduced motion.
3. The "+" headline device and paired-verb headlines ("Move fast + break nothing"). Adapt: "Send + warm up + reply, on your own server".
4. Docs top-of-page callout "Don't want to read the docs? Run this:" with a one-line command and its requirements in one sentence. Adapt as a copyable block on the homepage, since rightnow-ai needs only Docker and a `.env`.
5. Proof pills (GitHub stars / community / rating) in one tidy row. Adapt: GitHub stars (live), licence, last release, CI status; no ratings.
6. Uppercase mono for nav and buttons gives a "tool" feel cheaply.

Weak or avoid: self-host is not in the hero despite the shortlist claim; Get started goes to the cloud; the cookie dialog (marketing cookies) blocks the first screen on mobile; "Fortune 500" and case-study claims; only 34 internal links so little SEO surface; hero H1 duplicated in markup; "AI" framing is irrelevant to rightnow-ai.
