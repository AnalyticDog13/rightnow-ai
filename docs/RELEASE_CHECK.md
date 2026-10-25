# Release legal check (P8-T04)

Date: 2026-10-24. Engineering audit by the agent, not legal advice. Counts only; no secret values are recorded here.

## 1. Dependency licenses

See [LICENSES.md](LICENSES.md) and [../NOTICE](../NOTICE). 406 production packages: no GPL/AGPL, no
UNKNOWN/UNLICENSED. Non-permissive items (LGPL libvips via optional `sharp`, MPL-2.0 `lightningcss`, EPL-2.0
`elkjs`, CC-BY-4.0 `caniuse-lite`, dual `MIT OR EUPL` `@zone-eu/mailsplit`) are listed there with dispositions.
Nothing was swapped or removed.

## 2. Full-history secret scan

Scope: `git log --all -p` over all 349 commits on all branches (about 9.5 MB of diff), grepped with the plan's
patterns. Hits are lines; each was classified by hand.

| Pattern | Hits | Classification |
|---|---|---|
| `-----BEGIN .*PRIVATE KEY-----` | 1 | Documentation: the scan-pattern list quoted in `docs/plans/phase-8.md` |
| `AKIA[0-9A-Z]{16}` | 0 | |
| `ghp_[A-Za-z0-9]{36}` | 0 | |
| `xox[baprs]-` | 0 | |
| `sk-[A-Za-z0-9]{20,}` | 0 | |
| `GOCSPX-` | 1 | Documentation: same plan line as above |
| `client_secret` | 3 | 2 code (OAuth token-request parameter name filled from config, no value), 1 plan text |
| `password=` | 2 | 1 test fixture (a dummy string checking that error messages are redacted), 1 plan text |
| `SETUP_TOKEN=` | 14 | 3 diff hunk headers and 2 empty lines (`.env.example`), 1 `<16+ random characters>` placeholder, 1 Dockerfile build-time placeholder, 1 plan text, 6 CI workflow lines (see below) |
| base64 32-byte `ENCRYPTION_KEY=` | 0 | CI generates keys with `openssl rand` at run time |

CI workflow `SETUP_TOKEN` (6 of the 14, the same single line across 6 diffs): a fixed, human-readable
word-word-word-digits string written into the throwaway `.env` of the `compose-smoke` job on an ephemeral runner.
Classified as a CI-only test fixture, not a real secret. It is only a concern if you ever used that same string for
a real deployment; if so, change your `SETUP_TOKEN`. (This is a judgment from its shape and use, which cannot be
proven from the repo alone.)

`git ls-files` check: tracked `.env`: none; `*.pem`, `*.key`, `backups/`: none; only `.env.example` is tracked.
`.gitignore` covers `.env`, `.env.*` (except the example) and `backups/`. No `.env`, key or backup file was ever
added in history (checked with `git log --all --diff-filter=A`).

**Result: no real secret found. No history purge is proposed.**

## 3. Branding and trademark

- "Instantly" appears in README (2 mentions, both factual comparison), docs, the master prompt and the spec. No hit in
  `apps/`, `packages/` or any `package.json` (no UI strings or package metadata use it). No logos, screenshots or
  copied marketing copy found.
- Added to README: a "not affiliated with or endorsed by Instantly.ai" statement.
- Flag, not rewritten: `docs/PRODUCT_SPEC.md` (105 mentions) is built from Instantly's public help and developer
  docs. It states nothing is copied beyond short phrases. About 8 places quote Instantly feature or UI labels in
  double quotes (for example "Enable slow ramp", "Test account vitals", "Accounts to use", "Mark an account as fixed")
  and some numbers (such as ramp-up defaults) are taken from its docs. These are short names and facts; no long verbatim
  passages were found. Worth a read-through by you before publishing; summarise or cite where unsure.
- **Not done:** a search for conflicts with the name, domain or trademark "RightNow.ai". That is for you (the name may collide with existing marks).

## 4. Lawful-use wording and contributions

README now has a "Responsible use" section linking [COMPLIANCE.md](COMPLIANCE.md) and
[PROVIDER_COMPLIANCE.md](PROVIDER_COMPLIANCE.md) (both exist). [../CONTRIBUTING.md](../CONTRIBUTING.md) adds the
DCO 1.1 sign-off rule (not enforced by CI) and a security-reporting line.

## Summary for the user

Clean:
- No GPL/AGPL or unlicensed production dependency; no real secret in 349 commits; no `.env`, key or backup ever tracked.
- No Instantly logos, screenshots or marketing copy; no Instantly mention in app code or package metadata.

Findings:
- LGPL-3.0 prebuilt libvips binaries arrive through `next` -> optional `sharp`. Unmodified and dynamically loaded;
  noted in NOTICE. Decide whether that is acceptable or whether to disable/avoid `sharp`.
- MPL-2.0 (`lightningcss`) and EPL-2.0 (`elkjs`) dependencies, unmodified; CC-BY-4.0 `caniuse-lite` needs attribution
  (in NOTICE).
- `docs/PRODUCT_SPEC.md` contains short quoted Instantly UI labels and facts; review before publishing.
- The Docker image runs `npm ci` with dev dependencies included, so it carries dev tooling and their licenses.
- One CI-only `SETUP_TOKEN` string is in history (classified as a throwaway fixture); change your real token if it
  matches.

Decisions needed from you:
1. Lawyer review of the project license position, the README "Responsible use" wording and the Instantly
   comparison language (this audit is not legal advice).
2. Name/domain/trademark search for "RightNow.ai" (not done).
3. Whether the LGPL `sharp`/libvips path is acceptable.
4. History purge: not needed; none proposed.
