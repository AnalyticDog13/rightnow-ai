# Firecrawl (firecrawl.dev) - landing page reference

Captured 2026-10-30, headless Chromium 1440x900 and 390x844. Screens `specA/firecrawl-d00..d13.jpg` (first 11,200 px of 18,228 px; I viewed d00, d02, d07, d10, m0 and read the rest from DOM text), `firecrawl-m0..m3.jpg`. Extra URL https://docs.firecrawl.dev/contributing/self-host fetched as text (DOM text, screenshot `fc-doc.jpg` saved, not viewed).

## 1. Snapshot
- URL https://www.firecrawl.dev. Category: developer tool, open source (AGPL repo, 197.1K GitHub stars shown in the header), also a paid cloud.
- Positioning: web data API for AI agents (search, scrape, interact, crawl).
- H1 (verbatim, 2 lines, second line orange): "Give your AI agents / web data and beyond"
- Subhead: "The web data API to search and scrape with access to more sources through Alexandria. It's also open source." ("It's also open source." sits in a grey chip, a link to the repo.)
- CTAs: primary "Start for free" (orange filled), secondary control "Connect Firecrawl v" (dropdown with ChatGPT/Claude/other agent logos). Header: GitHub star count link "197.1K" + "Sign up".
- Top banner (orange pill, rounded 12px): "Introducing Alexandria and our $75M Series B. Read the announcement ->". Hero pill: "2 Months Free - Annually >".

## 2. Page anatomy (18.2k px desktop, 22.1k px mobile)
1. Orange announcement pill, ~40 px tall, inset 12px from edges, inside the grid frame.
2. Header (~72 px, white, 1px bottom rule): logo flame + "Firecrawl", nav Products v, Resources v, Pricing, Docs, Blog, Playground; right: GitHub icon + "197.1K", "Sign up" (grey chip, radius 8px). Sticky (visible in all screens).
3. Hero (~1,133 px incl. grid): pale grid-paper background with plus marks at intersections, faint corner labels in mono "[ 200 OK ]", "[ SCRAPE ]", "[ .JSON ]", "[ .MD ]" and two orange 4-point sparkles in circles (d00). H1 60px. Below the buttons: an interactive input box: globe icon, placeholder text that types itself ("L...", "Lat..."), mode tabs "Search | Scrape | Map | Crawl" and an orange arrow button. Under it, ASCII-art halftone clouds (characters like `X+=:-`) as decoration, then the top of a large browser-window outline (wireframe) leading into the next section.
4. "Start searching today" (~2,187 px): eyebrow chip "Developer First"; H2 52px with word "searching" orange; subhead "The infrastructure layer that helps AI find, read, and act on the live web." Three cards in a row: Search ("Search the web and get full content from results."), Scrape ("Get llm-ready data from websites. Markdown, JSON, screenshot, etc."), Interact with an orange "NEW" tag ("Scrape a page, then interact with it using AI prompts or code."), each with a "Learn more >" orange link and a dotted-matrix icon. Under them: a code panel with language tabs Python | Node.js | cURL | CLI and a "Copy code" button (d02), with a response pane labelled "[ .JSON ]" to the right showing output.
5. "Easily connect with your AI agents": integration section (logo tiles for ChatGPT, Claude, Cursor etc., based on the nav's "Connect Firecrawl" menu).
6. "Fast, reliable, token-efficient. And it's open source" (~1,865 px): 2-column feature cells separated by hairlines. Example (d07): "Token-efficient: Only the content that matters. No navs, footers, or ads. Just clean markdown, with 93% fewer input tokens for your model." link "Calculate your savings >"; "Open Source: Code you can trust. Developed transparently and collaboratively. Join our community of contributors." link "Check out our repo >".
7. Section counter strip: "[ 03 / 07 ] . FEATURES" in mono with an orange cursor bar (d07). A section index (01-07) is a repeated motif.
8. "We handle the hard stuff" (~2,748 px): chip "Zero configuration" (with toggle icon); H2 with "hard stuff" in orange; subhead "JavaScript rendering, smart wait, media parsing, search, actions, and more." Contains an action grid (Navigate, Click, Type, Wait, Scroll, Press, Screenshot, Scrape, d10) beside an orbiting-icons diagram, and "Fair access to web content, licensed through Firecrawl Alexandria." with a skeleton browser mock showing URL en.wikipedia.org/wiki/NASA and a "Requesting page ..." monospaced pill, link "Explore Firecrawl Alexandria >".
9. "Transform web data into AI-powered solutions" (~1,256 px): use-case cards (Deep research, Smarter AI chats, AI agent tools, Onboarding, Lead enrichment...).
10. Orange block (full-bleed, bg #fa5d19, 560 px): "The knowledge library for superintelligence." (Alexandria teaser).
11. "People love building with Firecrawl" (~887 px): two-line H2, "Discover why developers choose Firecrawl every day." Infinite marquee of quote cards (X posts) with name and @handle: e.g. Peter Steinberger @steipete: "I already have firecrawl which does that really well, no need to waste time trying similar things".
12. Logo/ally strip (160 px) and a tall wrapper (416 px, likely CTA).
13. "Frequently asked questions" (~2,929 px incl. accordions).
14. Footer (~1,897 px): "The easiest way to get data from the web", "Backed by Y Combinator", SOC II Type 2 (AICPA) badge, social links, columns Products / Use Cases / Resources / Company.

## 3. Visual system
- Colors: page bg #f9f9f9 (display-p3 0.976); text #262626; muted text ~#6b6b6b; hairline/grid ~#ededed (display-p3 0.929); accent orange #fa5d19 (p3 0.9816 0.3634 0.0984) for CTA fill, headline keywords, links, sparkles, banner, full-bleed block; chip bg rgba(0,0,0,0.04); white cards for inputs with soft shadow.
- Type: "Suisse" (Suisse Int'l, grotesk) throughout, fallback system-ui; weights 450/500. H1 60px/64px/500/-0.3px. H2 52px/56px/500/-0.52px. Body 16px, lh 24px. Small UI 14px/20px/450. Mono (probably Geist Mono or similar) for bracket labels "[ 200 OK ]", the section counter, and code. Eyebrow chips 12-13px.
- Buttons: primary orange, 14px/450, radius 10px, padding 8px (hover not measured); secondary grey chip radius 8px; the "It's also open source." chip radius 6px.
- Radii: 8-12px controls; cards 16px+, browser mocks ~24px.
- Layout: 1110 px grid frame (about x 165-1275) with vertical hairlines, plus marks at crossings; maxw measured 1335 px. Rows separated by 1px lines; sections 560-2,900 px; a repeated 245 px spacer row between sections.
- Background treatments: grid paper, ASCII/halftone dithering as the illustration language, dotted-matrix icons (orange/grey 3x3 and 5x5 pixel icons), orange gradient glow behind CTAs.
- Illustration style: ASCII art and pixel matrices + wireframe/skeleton UI.

## 4. Product imagery
- Mostly stylized skeleton mocks (greyed wireframes of browser windows, URL bar with hand-typed URL), not real screenshots. The real UI is the code/response panel and the playground input. Readability comes from dense labeled code, lowest-contrast skeletons giving way to a single orange accent.
- The output tab "[ .JSON ]" next to the request tab is the "product screenshot".

## 5. Motion and interaction
- Hero input: placeholder types out text in a loop (seen "L", "Lat"); mode tabs Search/Scrape/Map/Crawl switch the request type; clicking the arrow sends to the playground. Dropdown "Connect Firecrawl" opens a list of agents.
- Language tabs (Python, Node.js, cURL, CLI) swap code; "Copy code" button.
- Scroll-driven: ASCII halftone figures fade and shift; section counter "[ 03 / 07 ]" updates as you scroll (sticky mono label); "Requesting page ..." skeleton animates loading.
- Quote marquee loops horizontally (duplicated content in DOM). FAQ accordions.
- On mobile the mode tabs collapse into a "Search v" dropdown. Reduced-motion behavior not tested.

## 6. How to use / self-host
- The landing page shows "how to use" as three tabs of code with a Copy button, not as numbered steps. It links to the repo twice (header star count, "Check out our repo >") and to docs.
- Self-host doc https://docs.firecrawl.dev/contributing/self-host (captured as text): a left docs nav, a right "On this page" TOC: Choose self-hosting or Firecrawl Cloud / What self-hosting requires / Self-host Firecrawl with Docker Compose / Start with these defaults / Prerequisites / Clone the verified release / Configure the evaluation deployment / Build and start Firecrawl / Check API reachability / Run a functional smoke test / Self-hosted feature support / Before production / Troubleshooting.
- Honest framing quotes worth borrowing: "Self-host Firecrawl when: You want control over the source or infrastructure." "You are comfortable operating the stack. You will own upgrades, security, storage, monitoring, and recovery." "Our recommendation: self-host when source access or infrastructure control is worth the operational work. If you want the fastest supported path to production, start with Firecrawl Cloud." "Keep the first run boring: get one scrape working, then add what your use case needs."
- Pinned-release steps: prerequisites "Git; Docker Engine or Docker Desktop; Docker Compose v2, invoked as docker compose; curl for the verification requests... Make sure port 3002 is available". Commands: `git clone https://github.com/firecrawl/firecrawl.git`, `cd firecrawl`, `git checkout v2.11.162`. "The commands are pinned to v2.11.162." Defaults list: auth off for local, queue PostgreSQL, queue admin UI off.

## 7. Trust and proof
- GitHub stars (197.1K) in the header, "Backed by Y Combinator", SOC 2 Type II badge, $75M Series B banner, X-post testimonial marquee with real handles, "Alexandria" licensing note ("Fair access to web content, licensed through ..."). rightnow could honestly use: GitHub star count (live, once real), license badge (MIT), "no telemetry"/data-stays-on-your-server statements, security notes (AES-256-GCM at rest). Not usable: funding, SOC 2, testimonials.

## 8. Navigation, footer, CTA cadence
- Header sticky: Products (mega menu: Alexandria, Web Search/Scrape API, Browser Interaction, Web Crawling, Document Parsing, Web Monitoring, indices, use cases), Resources, Pricing, Docs, Blog, Playground; star badge; "Sign up".
- CTAs: banner, hero (2), "Learn more" x3, "Calculate your savings", "Check out our repo", per-section links, final CTA. Footer columns Products / Use Cases / Resources (API Reference, Integrations, Plugins, Examples, SDKs, Playground, Prompts, Templates, Free Tools, Benchmarks, Firecrawl Alternatives, Web Extraction Glossary, Changelog) / Company. "Firecrawl Alternatives" and "Web Extraction Glossary" are SEO link hubs.

## 9. Copywriting
- Developer-first, plain. Two-part headline with orange keyword. Features as "Verb the noun": Search, Scrape, Interact. Short sentences, concrete numbers ("93% fewer input tokens"). Jargon ("LLM-ready", "token-efficient") assumed known. Bracketed mono labels give a terminal flavor.

## 10. SEO
- Title "Firecrawl | Web Data API for AI Agents". Meta description "Supercharge your AI agents with data from the web and beyond. Building the library for superintelligence." Canonical https://www.firecrawl.dev/. OG title/desc, og:image https://www.firecrawl.dev/og.png, og:type website, twitter summary_large_image. JSON-LD: none found on the homepage. One H1, 8 H2s; 85 internal links. Content hubs: /alexandria, /use-cases/*, /blog, "Firecrawl Alternatives", glossary, free tools (programmatic SEO).

## 11. Mobile (390 px)
- Banner wraps to 2 lines; burger menu; H1 wraps to 3 lines at ~39px; hero stacks: chip, H1, subhead, "Start for free" full-width orange, "Connect Firecrawl" full-width grey, input card with a "Search v" mode dropdown and an orange arrow button. Page height 22.1k px, no horizontal overflow (scrollWidth 390). The grid frame keeps 24px gutters. Wireframe browser mock appears under the input, cropped.

## 12. Verdict
Executed well (ranked):
1. Try-it-now input in the hero. For rightnow (no hosted app) adapt as a "copy this command" terminal: one input-styled box with the real install command and a Copy button, tabs Local (Docker Compose) / VPS (Compose + Caddy).
2. Code panel with language tabs + Copy; adapt to tabs "Docker Compose / .env / Verify" or REST API "curl" examples for creating a campaign.
3. Honest self-host guide framing ("self-host when...", "you will own upgrades, security, backups") plus pinned version and smoke test. rightnow's page can make this its signature: "What you own" list.
4. Mono bracket labels and section counter "[ 03 / 07 ] FEATURES" as a cheap technical-brand device.
5. GitHub star count in the header, repo link twice.
6. ASCII/halftone illustrations; cheap and distinctive; could be generated with no assets.
Avoid / weak:
- Banner + "2 Months Free" chip + Series B stack (funding and pricing noise).
- Wireframe skeleton mocks show nothing real; rightnow should show real screens.
- Orange full-bleed block with abstract copy ("knowledge library for superintelligence").
- Tweets/testimonial marquee and SOC 2: no fake proof; use real GitHub issues/discussions only after they exist.
