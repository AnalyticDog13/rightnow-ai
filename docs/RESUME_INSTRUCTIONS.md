# Resume instructions

> You are resuming the autonomous development of an open-source Instantly.ai alternative. Read the project
> specification, approved Superpowers plan, progress files, handoff notes, task records, and Git history.
> Resume the first unfinished task. Continue implementing, testing, independently reviewing, and committing
> work without requesting routine user approval. Use cost-appropriate Claude models. Do not restart
> completed work. Continue until the project requirements and acceptance criteria are satisfied or an
> unavoidable external blocker occurs.

## Steps

1. Read `CLAUDE.md`, `docs/HANDOFF.md`, `docs/TASKS.json`, `docs/PROGRESS.md`.
2. `git fetch && git status && git log --oneline -15`. If local is behind `origin/main`, pull.
3. A task marked `in_progress` was interrupted: diff its files against its acceptance criteria, keep
   usable work, finish it, re-run its tests.
4. Continue with the first `todo` task whose dependencies are all `done`.
5. After each task: review → commit → push → update the state files.

## Session resumption options

- Same machine, same conversation: `claude --continue` (most recent) or `claude --resume` (pick a session).
- Fresh session anywhere: clone the repo, open Claude Code in it, say "keep going". The repository files
  are sufficient; no prior conversation is needed.
- Plugins: Superpowers and Ponytail are user-scope plugins. On a new machine install them with
  `/plugin install superpowers@claude-plugins-official`, `/plugin marketplace add DietrichGebert/ponytail`,
  `/plugin install ponytail@ponytail` (each as its own message).
