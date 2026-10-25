# Dependency licenses

Not legal advice. Date: 2026-10-24. Project license: MIT ([LICENSE](../LICENSE)). Attribution list: [NOTICE](../NOTICE).

## How this was produced

```bash
npx --yes license-checker-rseidelsohn@5.0.1 --production --summary   # one-off, not added to package.json
npx --yes license-checker-rseidelsohn@5.0.1 --production --json
```

Run from the repo root, the tool saw only the root package (all dependencies live in the workspaces and are
hoisted), and per-workspace runs missed hoisted packages. The table below therefore comes from the same data
source, `package-lock.json`: every non-dev entry (406 packages, workspace packages excluded), with the license
read from the lockfile and, where absent, from the installed `package.json`. Platform-specific optional binaries
(sharp, lightningcss) are all counted although only the matching one installs on a given machine. "Non-dev"
means entries without `"dev": true`, so `devOptional` entries (Playwright, TypeScript, some lightningcss
copies) are included: a deliberate over-count. The extraction was an ad-hoc script over the lockfile, not
committed; raw JSON is kept outside the repo.

## Summary (production closure, 406 packages)

| License | Packages |
|---|---|
| MIT | 284 |
| Apache-2.0 | 44 |
| ISC | 27 |
| MPL-2.0 | 12 |
| BSD-2-Clause | 11 |
| LGPL-3.0-or-later | 10 |
| BSD-3-Clause | 4 |
| Apache-2.0 AND LGPL-3.0-or-later | 3 |
| Unlicense | 2 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |
| MIT and ISC | 1 |
| (MIT OR EUPL-1.1+) | 1 |
| CC-BY-4.0 | 1 |
| EPL-2.0 | 1 |
| MIT-0 | 1 |
| 0BSD | 1 |
| (MIT OR CC0-1.0) | 1 |
| MIT AND ISC | 1 |

Permissive (MIT, ISC, BSD-2/3, Apache-2.0, 0BSD, MIT-0, Unlicense, CC0, and the MIT/ISC combinations) covers 377 of
406; the other 29 are in the table below. No GPL or AGPL package and no `UNKNOWN`/`UNLICENSED` production dependency was found.

## Packages outside the permissive list

| Package(s) | License | Pulled in by | Disposition |
|---|---|---|---|
| `@img/sharp-libvips-*` (10), plus `@img/sharp-win32-*` and `@img/sharp-wasm32` (4) | LGPL-3.0-or-later (some `Apache-2.0 AND LGPL-3.0-or-later`) | `sharp`, an optional dependency of `next` | **Finding for the user.** Weak copyleft; prebuilt libvips binaries, unmodified, loaded dynamically by sharp. Not swapped or removed. LGPL is commonly understood to permit dynamic use of unmodified libraries; confirm with counsel. |
| `lightningcss` and 11 platform builds | MPL-2.0 | `@tailwindcss/node`, `vite` | File-level copyleft; unmodified use. Source is available from the project. No action proposed. |
| `elkjs` | EPL-2.0 | `@prisma/studio-core` (Prisma CLI) | Weak copyleft, unmodified use. Listed in NOTICE. |
| `@zone-eu/mailsplit` | `MIT OR EUPL-1.1+` | `imapflow`, `mailparser` | Dual license; MIT is the one relied on. |
| `caniuse-lite` | CC-BY-4.0 | `next` | Data, attribution required; listed in NOTICE. |

Workspace packages (`@rightnow/*`) are private and reported as `UNLICENSED` by the tool; they are this project
(MIT per the root LICENSE). Lockfile entries for dev-only tooling (test, lint, build) are excluded from the table.

## Docker base images

The `docker/Dockerfile` image runs `npm ci` (dev dependencies included) before building, so the image contains the
dev tooling as well.

| Image | Used in | License of the image's software |
|---|---|---|
| `node:24-bookworm-slim` | `docker/Dockerfile` | Node.js: MIT; Debian packages carry their own licenses (including GPL) |
| `postgres:18-alpine` | `docker-compose.yml` | PostgreSQL License; Alpine packages carry their own licenses |
| `caddy:2-alpine` | `docker-compose.yml` | Apache-2.0; Alpine packages carry their own licenses |

These images are pulled by users at run time and are not redistributed by this repository.
