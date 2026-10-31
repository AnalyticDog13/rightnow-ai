# rightnow-ai website

The launch page for rightnow-ai: plain HTML, one CSS file and small vanilla JS modules. No build step, no framework,
no third-party scripts. The spec it implements is `docs/design/site/SITE_SPEC.md`.

This folder is only the marketing site. The app itself cannot run on Vercel (it needs PostgreSQL and an always-on
worker); see the root `README.md` to run it.

## Preview locally

```bash
npx serve site
```

Any static server works. All asset paths are relative, so the folder also works copied into a subfolder of another
static site (for example `/sites/rightnow-ai/`). Only `404.html` uses root-absolute paths, because a host serves it at
any URL depth.

## Deploy on Vercel

1. Import the GitHub repository in Vercel.
2. Root Directory: `site`. Framework preset: "Other". No build command. Output directory: `.` (default).
3. Deploy. `vercel.json` adds clean URLs, the security headers and a Content-Security-Policy that allows only this
   origin plus `https://api.github.com` (the live star count). `.vercelignore` keeps this README out of the deploy.

## Change the origin (canonical, Open Graph, sitemap)

The site origin is the constant `https://rightnow-ai.vercel.app` (no trailing slash). It appears only in the three
pages' `<head>` (canonical, `og:url`, `og:image`, `twitter:image`, JSON-LD), `sitemap.xml` and `robots.txt`.
Replace it everywhere with:

```bash
grep -rl "https://rightnow-ai.vercel.app" site | xargs sed -i "s#https://rightnow-ai.vercel.app#https://YOUR-ORIGIN#g"
```

PowerShell:

```powershell
Get-ChildItem site -Recurse -File | Where-Object { (Get-Content $_.FullName -Raw) -match 'https://rightnow-ai\.vercel\.app' } | ForEach-Object { (Get-Content $_.FullName -Raw) -replace 'https://rightnow-ai\.vercel\.app', 'https://YOUR-ORIGIN' | Set-Content $_.FullName -NoNewline -Encoding utf8 }
```

## Files

| Path | What it is |
|---|---|
| `index.html` | The launch page |
| `self-host/`, `instantly-alternative/` | Setup guide and honest comparison page |
| `404.html` | Not-found page (`noindex`) |
| `assets/css/site.css` | All styles and design tokens (light and dark) |
| `assets/js/theme-init.js` | Sync head script: theme before paint |
| `assets/js/site.js` | Nav, theme, star count, tabs, copy buttons, reveals, lazy module loader |
| `assets/js/simulator.js`, `inbox-demo.js`, `planner.js`, `terminal.js` | The four interactive pieces, loaded when near the viewport |
| `assets/screens/` | Resized app screenshots; mapping and captions in its `README.md` |
| `assets/og.png` | Social card, rendered from `tools/og-template.html` with Playwright |
| `tests/planner.test.html` | Planner and `.env` generator self-check (open it; title shows PASS) |

Regenerate the social card (with any static server on port 4173):
`npx playwright screenshot --viewport-size=1200,630 http://localhost:4173/tools/og-template.html site/assets/og.png`.

## Acceptance checklist (SITE_SPEC B14)

Checked on 2026-10-30 with headless Chromium (Playwright) against a local server that sends the `vercel.json` CSP,
plus Lighthouse (Chrome DevTools, mobile) for accessibility, best practices and SEO.

### Content and honesty

| Item | Result |
|---|---|
| No pricing, plans, trials, sign-up, contact-sales, waitlist or demo wording | PASS. Grep hits only: the FAQ "no paid edition, no plans", the comparison cell "see each vendor's pricing page" (spec copy), "Sign up and connect" (hosted column, spec copy) and the app's own `/sign-up` setup step |
| No logos, testimonials, user counts, ratings or badges; star count live, labelled, hidden on failure | PASS. The pill shows "Star on GitHub" until the API answers; on any failure or timeout (3 s) it never shows a number. The repo currently has 0 stars, so it shows "★ 0" |
| Every number sourced or labelled sample / your input | PASS, with one deliberate change: the proof item "LIVE-VERIFIED SENDING" was replaced by "LIVE CHECK BEFORE SENDING", because `docs/ops/LIVE_VERIFICATION.md` lists no provider as passed (the spec says to write only the providers it lists) |
| Every feature in README / PRODUCT_SPEC; comparison only hedged cells + "as of October 2026" | PASS |
| Responsible use with lawful basis, unsubscribe, providers' terms, not legal advice, non-affiliation; also on `/instantly-alternative/` | PASS |
| Brand only `rightnow` / `rightnow-ai` | PASS (zero "RightNow", zero "rightnow.ai"). Uppercase appears only where CSS sets mono labels in capitals and in the spec's postmark ring text |
| Vercel note says the app cannot run on Vercel and why | PASS |
| Copy matches B6 verbatim | PASS (H1, hero lead, six step statements, FAQ spot-checked; FAQ JSON-LD equals visible text, checked by script) |

### Interactive pieces

| Item | Result |
|---|---|
| Simulator: six scenarios play to the end; Pause/Step/Reset; ledger `aria-live`; reduced motion final state | PASS |
| Inbox demo: arrivals stop after 4; relabel moves/removes cards; keyboard drag (Space, arrows, Space, Esc); Pause and hover/focus pause | PASS (pointer drag uses native drag and drop, so touch drag depends on the browser; keyboard and relabel always work) |
| Planner: self-test passes; clamp notes per tier; invalid hours error; "right now" matches device clock; no network | PASS (clamps can only trigger for Outlook.com 125 and SMTP 50, since the slider stops at 200) |
| Terminal: both tabs, every step copyable, no prompts/comments in copies, generator self-checks, nothing stored | PASS. Storage after use: `localStorage` = `rn-theme` only; `sessionStorage` = `rn-stars` (the 1-hour star cache from B7.4) |

### Responsive

| Item | Result |
|---|---|
| `scrollWidth === innerWidth` at 390, 768, 1024, 1440, 1920 (menu open, tables, code, CRM strip, planner) | PASS (also 320) |
| 390: H1 36px in 3 lines, CTAs full width 48px, mobile hero shot, rail hidden, targets >= 44px | PASS (H1 computes to 36.1px from the spec's clamp) |
| 320 reflow | PASS |

### Accessibility

| Item | Result |
|---|---|
| Lighthouse Accessibility 100 on all three pages; axe 0 violations | PASS (Lighthouse 100 x3, its axe-based audits included). Standalone axe DevTools not run |
| Full keyboard pass | PASS for scripted checks (tabs arrows/Home/End, label menu arrows/Enter/Esc, Kanban keys, menu Esc returns focus, skip link first); not a manual screen-reader session |
| Contrast spot-checks both themes | PASS by token values from the spec (all text pairs >= 4.5:1); Lighthouse contrast audit passes in light |
| Reduced motion: no movement, no pipeline dot | PASS |
| Works without JavaScript | PASS (text, simulator ledger, inbox list, planner result + constants table, setup code blocks) |

### SEO

| Item | Result |
|---|---|
| Titles, descriptions, canonicals, OG/Twitter exactly as B10.2; `og.png` 1200x630 <= 150KB | PASS (og.png 29KB). Social-card debugger not run (needs a public URL) |
| JSON-LD valid; FAQ text equals visible text | PASS by JSON parse and script comparison; validator.schema.org / Rich Results not run (offline) |
| One H1 per page; outline as B10.5; no duplicate heading text | PASS |
| `robots.txt` and `sitemap.xml`; three URLs; tools/tests `noindex` | PASS |
| Origin string only in the files listed in B10.1 and this README | PASS |

### Performance and tech

| Item | Result |
|---|---|
| No build step, framework or library files; only `api.github.com` external | PASS |
| Budgets in B12 | PARTIAL. `index.html` 69KB (budget 90), fonts 104KB (120), hero WebP 57KB (140), mobile hero 36KB (70), initial view 264KB uncompressed (400), Lighthouse Best Practices/SEO 100. Over budget: `site.css` about 50KB (budget 40; 11KB gzipped) and JS about 50KB total (budget 40; 18KB gzipped). Lab LCP on throttled mobile without compression 2.4s (budget 2.0; a gzip-serving host shrinks the HTML from 69KB to 18KB). CLS 0.000. Lighthouse Performance score not measured (the available tool excludes it) |
| Images: width/height, WebP, lazy except hero, no blur | PASS |
| Works from a subfolder | PASS (served at `/sites/rightnow-ai/`, zero failed requests) |
| CSP from `vercel.json` gives no console violations | PASS (local server sends the same header) |
| Light/dark correct; toggle persists; system followed when unset; logo inverted per theme | PASS |
| Every B3 screenshot present and mapped | PASS (`assets/screens/README.md`) |
