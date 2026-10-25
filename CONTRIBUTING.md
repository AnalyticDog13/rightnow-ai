# Contributing

Thanks for helping. Commands (setup, `npm run dev`, tests, e2e, database) are in [CLAUDE.md](CLAUDE.md) under
"Commands"; the architecture rules are in the same file and in [docs/DECISIONS.md](docs/DECISIONS.md).

## Before you open a pull request

- `npm test`, `npm run lint` and `npm run typecheck` must pass.
- Write the test first for behavior changes; keep changes small and focused.
- Use conventional commits: `feat(scope): ...`, `fix(scope): ...`, `docs: ...`, `test: ...`, `chore: ...`.
- Never commit secrets, `.env` files or OAuth credentials.

## Sign your commits (DCO)

Every commit needs a `Signed-off-by` line, added with `git commit -s`:

```
Signed-off-by: Your Name <you@example.com>
```

By signing off you certify the Developer Certificate of Origin, Version 1.1:

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same license (unless I am permitted to submit
    under a different license), as indicated in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

The sign-off is a project rule; it is not enforced by CI.

## Reporting a security issue

Do not open a public issue. Report it privately to the repository owner: use GitHub's "Report a vulnerability"
(Security tab) on https://github.com/AnalyticDog13/rightnow-ai if enabled, otherwise the email on their GitHub
profile.
