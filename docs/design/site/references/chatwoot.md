# Chatwoot (www.chatwoot.com) - landing-page reference

Captured 2026-10-30, headless Chromium, desktop 1440x900 + mobile 390x844. Height 9,402 px desktop / 15,225 px mobile. Screenshots: `scratchpad/specC/chatwoot-d00..d11.jpg` (I viewed d00, d03, d07, d10), `chatwoot-m00`, `chatwoot-extra`. Only partial scroll set viewed; middle sections (Captain, Omnichannel, playbooks, voice, industries) described from heading outline + two screenshots.

## 1. Snapshot
- URL https://www.chatwoot.com; category: open-source customer support / unified inbox (direct analogue to rightnow's inbox).
- H1 verbatim: "The modern customer support tool for your business". Subhead: "Your AI agent, channels and help center, together in one place. Easy to set up, and shaped around how your team works."
- CTAs: "Start your free trial" (blue filled) and "Request a demo" (white outlined). Nav: "Sign up" (blue), "Request a demo", "Sign in". Pill above H1: "Introducing voice calls ->". Floating chat widget "Chat with us" (blue, bottom right) on every screen.

## 2. Page anatomy
1. Nav (60 px) inside a centered 1,200 px frame: logo, Product / Solutions / Resources dropdowns, Pricing, Help center; right Sign in, Request a demo, Sign up.
2. Hero (~900 px incl. product): left-aligned H1, CTAs; background is a pixel-mosaic field (small squares in blue, dense at right edge, fading left). Directly below, a 4-tab product frame (Conversations / Captain / Contacts / Help center) with a real inbox screenshot (folders, conversation list, thread, contact panel); two skewed sticker badges overlap its top right: "GITHUB 38k stars" and "RATED ON G2 4.5+ stars".
3. Captain AI section (purple band): H2 "Captain, the AI agent for customer support"; 3 equal cards (MONITORS, COPILOT, SCENARIOS) each with mini-UI (counters "Feature requests 84", draft reply with "Use this reply" button, numbered scenario steps "@add_note", "@handoff") above bold title + 2-line text: "Know what customers keep asking", "Start every reply with a draft", "Set a process, Captain follows it".
4. "Keep every conversation in one place" (Omnichannel): label-tab with arrow-shaped tag, split columns: numbered accordion list left (01 Every Meta feature, not just messages / 02 Email, threaded like a chat / 03 A chat widget that looks like yours / 04 An open API for everything else), icon-grid visual right (channel icons around a Chatwoot hub: web, email, WhatsApp, Instagram, Facebook, Messenger, Telegram, X, Line, TikTok, phone).
5. Automation: "Run a playbook in one click", "Or let it run on its own", "Every language, one inbox".
6. "The phone for your support desk": Twilio Voice, WhatsApp calling.
7. Help Center band (yellow/amber tint): H2 "The best conversation is the one nobody had to start." with numbered accordion (auto-advancing, progress underline) and a mock help-center in a browser frame with language switcher EN/ES/FR/DE/JA.
8. Industries: "Built for how your industry talks".
9. Testimonials: "What our customers say" (3 cards with avatar, name, role).
10. **Self-host band (bright yellow #fdc844-ish, full-bleed with pixel-edge borders)**: tag "Secure, open source", H2 "Host it yourself and own your data", copy "Read the code, fork it and run it on your own infrastructure, or let us host it for you. Your conversations and customer data stay where you decide." Buttons: "Find us on GitHub" (dark filled, GitHub icon) and "Deployment guide" (cream). Stat strip: "38k STARS ON GITHUB", "400+ CONTRIBUTORS", "SOC 2 TYPE II COMPLIANT". Right: a dark terminal-style README card "CHATWOOT / CHATWOOT - README.MD": "# Chatwoot / Open source customer support platform with a shared inbox, live chat, a help center and an AI agent. / ## Deployment / -> Heroku one-click deploy / -> DigitalOcean 1-Click Kubernetes app / -> Docker, Helm chart on Artifact Hub" with blinking cursor, and chips SECURE DEVELOPMENT / SECURE TESTING / CLOUD SECURITY.
11. Footer: columns PRODUCT, COMPANY, RESOURCES, BACKED BY, PLATFORM PARTNER; socials GitHub, Discord, LinkedIn, YouTube, Facebook, Instagram; links include "Self-Hosted Chatwoot", "Product Documentation", "API Documentation", "Contribution guide", "Handbook", "Chatwoot CLI", "SYSTEM STATUS".

## 3. Visual system
- Light base #ffffff / near-white; text rgb(28,32,36) (#1c2024) for headings, black body. Blue primary rgb(24,117,238) (#1875ee); per-section tint bands: purple (Captain), green (omnichannel), amber (help center), yellow (self-host). Secondary button white with 1 px border and subtle shadow.
- Type: Haskoy (display) for H1/H2, weight 700, H1 64/65 px tracking -2.88 px (very tight), H2 38/41 px tracking -1.33 px; Inter body 16/24; buttons 14-16 px/600. Eyebrows uppercase tracked mono-ish 12 px ("MONITORS").
- Layout: 1,200 px centered column with visible 1 px vertical rails at left/right and horizontal hairlines between sections; bleed bands decorated with pixel-mosaic borders (tiny squares fading out). Sections ~560-900 px.
- Radii: buttons 6-8 px, cards 4-8 px (squarer than most), product frame 8 px. Shadows: hard offset "sticker" shadows on badges and label tags (dark 2-3 px offset border), soft shadow on the central Copilot card.
- Illustration style: pixel/mosaic motif, sticker tags with arrow-shaped label ends, color-tinted mini UIs.

## 4. Product imagery
Real-looking inbox with believable demo data (names, channels, SLA timers "5h 51m", labels) in a tabbed frame; mini UI "cards" for each AI feature are stylized, simplified and deliberately larger than real UI. The four hero tabs make one frame show four products. Readable because each sub-feature gets its own isolated mini-card with a 2-line caption.

## 5. Motion & interaction
- Hero tabs switch the screenshot (click; underline slides in blue). Omnichannel and Help Center numbered accordions auto-advance with a thin progress bar under the active item (visible at "01" in d07) and swap the right visual.
- Terminal card cursor blinks. Chat widget bubble persistent. Dropdown nav on hover. Cookie banner none observed. Reduced-motion behaviour not verified.

## 6. Self-host / get started
- Homepage section above: GitHub button + "Deployment guide" with an embedded README preview listing deploy options.
- https://developers.chatwoot.com/self-hosted/ : "Self-Hosted Installation Guide - Complete guide to install and setup a production-ready Chatwoot instance on your own infrastructure." Then "Why Self-Host Chatwoot?" bullets: "Data Privacy: Keep all customer data on your own servers / Customization / Cost Control: No per-agent pricing - scale as much as you need / Compliance / Integration". "Deployment Options" cards with emoji, each with "Best for / Complexity / Maintenance" lines (Linux VM: "Best for: Traditional server environments; Complexity: Low to Medium; Maintenance: Manual updates required"; Docker; Kubernetes; cloud providers AWS, Azure, DigitalOcean, GCP, Heroku). Sidebar covers Requirements, Architecture, Environment Variables, Monitoring, Storage, Email Channel, Upgrade, Backup, Runbooks. Mintlify-style docs with llms.txt advertised.

## 7. Trust & proof
GitHub stars (38k), contributors (400+), G2 rating (4.5+), SOC 2 Type II badge, customer testimonials with names/roles, "Backed by" investors. rightnow-usable: GitHub stars once real, contributor count, test/CI status, security posture (AES-256-GCM at rest, SSRF guards), license. No testimonials, no G2.

## 8. Navigation, footer, CTA cadence
Nav: Product, Solutions, Resources (dropdowns), Pricing, Help center + Sign in/Request a demo/Sign up. 51 internal links on home. CTAs repeat: nav (2), hero (2), chat widget (always), self-host band (2), and a closing CTA; the self-host section is placed late (section ~10 of 11) which buries the differentiator.

## 9. Copywriting
Benefit-led, mostly sentence fragments: "Fewer tickets, not just faster replies", "Set a process, Captain follows it". Headline formula: "<Verb> <outcome>, <contrast>". Features get names (Captain, Copilot, Monitors, Scenarios). Technical words are kept minimal on the home page, deeper in docs. Honest-sounding closing line: "Read the code, fork it and run it..."

## 10. SEO
- Title "Chatwoot: AI-Powered, Open-Source Customer Support Platform"; description "AI-powered, open-source customer support for live chat, email, WhatsApp, and social. Self-host or use our cloud: an alternative to Intercom and Zendesk." (names competitors in the description). Canonical https://www.chatwoot.com/. OG/Twitter complete (twitter:creator @chatwootapp, default og image). JSON-LD tag present but type could not be read (null).
- Headings: one H1, H2 per pillar, H3 per capability. Footer exposes Use cases/Industries/Solutions pages for long-tail. Page is ~9.4k px with pixel art as CSS/SVG.

## 11. Mobile
Hamburger; H1 wraps to 3 lines; CTAs stack at natural width (not full width); stat stickers sit overlapping the product frame; hero tabs reduce to 4 icons only (no labels); tabbed frame shows a tiny but still legible screenshot; chat widget overlaps content (covers bottom right of the frame at m00).

## 12. Verdict
Strong, borrowable:
1. Yellow full-bleed "Host it yourself and own your data" band with README-style terminal card, GitHub + "Deployment guide" buttons and a 3-stat strip: adapt as rightnow's main self-host band (stars, contributors, tests/CI, license MIT; only real numbers).
2. "Why self-host" bullets and deployment-option cards with Best for / Complexity / Maintenance: adapt for "Laptop (Compose)" vs "VPS (Compose + Caddy)".
3. Tabbed hero frame that cycles four products (Conversations/Captain/Contacts/Help center) -> rightnow tabs "Inbox / Campaigns / CRM / Analytics".
4. Numbered auto-advancing accordion beside a visual (01-04) for walking through a flow like warm-up -> send -> reply -> CRM.
5. Sticker badge pair (GitHub stars + a second fact) overlapping the product frame.
6. Meta description naming competitors ("an alternative to Intercom and Zendesk") -> "an open-source alternative to Instantly".
Avoid: self-host story at the very bottom, chat widget, pricing/trial CTAs, G2/testimonials, pixel-art needing heavy decoration; mobile tabs lose labels.
