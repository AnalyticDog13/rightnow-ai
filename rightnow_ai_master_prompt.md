# STARTUP AND EXECUTION-ENVIRONMENT REQUIREMENTS

**Project repository:** https://github.com/AnalyticDog13/rightnow-ai

Before running plugin commands, detect whether this is the interactive Claude Code CLI or an Anthropic-hosted Claude Code Cloud session.

- **Interactive Claude Code CLI:** Install and verify Superpowers and Ponytail with their official, currently supported plugin instructions. Use the full plugin workflow where possible. Slash plugin commands may require separate interactive messages; do not treat a literal slash command written inside a prompt as proof that it executed.
- **Claude Code Cloud:** Do not attempt `/plugin` commands, because cloud sessions do not support them. Instead, where compatible, install checked and trusted repository-scoped skills into `.claude/skills/`, and define code review and orchestration subagents in `.claude/agents/`. Explicitly distinguish a skill-only fallback from a working full plugin with lifecycle hooks. If some skill cannot be loaded, follow the equivalent manual review and simplicity procedures and record the limitation.
- **Either environment:** Check available permissions and GitHub push access, make no unsupported claims of installed plugins, and proceed with autonomous work that the environment actually permits. Never put secrets in the repository.

**MANDATORY INITIAL FILE:** Before creating an implementation plan, create and commit a concise root-level `CLAUDE.md`. It must contain project identity, primary architecture principles, Superpowers/Ponytail instructions or supported equivalents, model-use policy, commands to build/test/run, Git conventions, mandatory review requirements, local-versus-VPS requirements, links to authoritative documentation, and the exact "keep going" recovery procedure. Start with confirmed facts only; update it after the architecture is reviewed. Keep detailed plans, task status, and handoffs under `docs/`, not inside an oversized `CLAUDE.md`.

**Initial execution sequence:** verify environment → verify/install permitted tools → create `CLAUDE.md` and persistent documentation scaffold → research lawful public product capabilities → write a complete plan → independent agent review → revise until approved → execute in small verified tasks → independently review, commit, push, and checkpoint after each task.

---

MANDATORY — Install and Use Ponytail Throughout Development

Before researching, planning, or implementing the rightnow-ai project, verify or install Ponytail **when supported by the detected Claude Code environment**. In Cloud sessions, use repository-scoped skills/rules instead of interactive `/plugin` commands. Official source:

https://github.com/DietrichGebert/ponytail

For interactive Claude Code CLI sessions only, use the documented installation procedure:

1. \`/plugin marketplace add DietrichGebert/ponytail\`
2. \`/plugin install ponytail@ponytail\`

Execute these as separate commands if required by Claude Code. Verify installation and activate Ponytail in \`full\` mode.

If the cloud environment cannot execute plugin installation commands autonomously, use the documented official skill/rules fallback where supported, and report the limitation. Do not silently pretend the plugin is active.

Integration with Superpowers

Use both Superpowers and Ponytail throughout the entire development lifecycle.

Superpowers is responsible for:

- Research and planning.
- Independent plan review.
- Task decomposition.
- Multi-agent implementation.
- Testing and verification.
- Code review and integration.
- Git commits and progress tracking.

Ponytail is responsible for:

- Minimizing unnecessary code.
- Reusing existing functionality.
- Preventing duplicate implementations.
- Avoiding unnecessary dependencies.
- Keeping modules focused and maintainable.
- Simplifying unnecessarily complicated solutions.
- Detecting technical debt.
- Keeping the codebase easy for future agents to understand.

Ensure Ponytail's coding principles are applied to implementation and review agents wherever the Claude Code environment supports it.

Mandatory Code Quality Rules

Before implementing any feature, agents must:

1. Inspect the existing codebase for reusable functionality.
2. Prefer simple, established solutions.
3. Avoid recreating standard library functionality.
4. Avoid unnecessary helper functions, wrappers, classes, and abstraction layers.
5. Avoid introducing dependencies without a clear benefit.
6. Keep each module focused on a coherent responsibility.
7. Maintain consistent architecture and naming conventions.
8. Refactor duplicated code when doing so genuinely improves maintainability.
9. Avoid premature optimization and speculative features.
10. Never sacrifice correctness, security, reliability, error handling, or required features merely to reduce lines of code.

The goal is not the smallest possible codebase. The goal is the simplest maintainable architecture that fully supports the Instantly.ai feature requirements.

Continuous Ponytail Reviews

After each significant implementation task:

- Run the equivalent of \`/ponytail-review\` against the changes.
- Have an independent agent evaluate unnecessary complexity.
- Fix meaningful maintainability problems before integrating the work.

After each major development phase:

- Run the equivalent of \`/ponytail-audit\` against the entire repository.
- Identify duplicate systems, unnecessary dependencies, overly complicated modules, unused code, and architectural inconsistencies.
- Review and resolve significant findings.
- Run regression tests after refactoring.
- Commit verified improvements.

Track deliberate shortcuts and periodically use \`/ponytail-debt\` to review unresolved technical debt.

Persistent Enforcement

Document these requirements in \`CLAUDE.md\` so future Claude sessions automatically understand the expected development principles.

When resuming after context exhaustion or credit limits, verify Ponytail remains available and continue following its principles.

Priority

Use Superpowers for structured implementation and autonomous multi-agent orchestration.

Use Ponytail to maintain simplicity, consistency, and code quality.

If Ponytail recommends removing functionality required by the approved product specification, preserve the functionality and seek a simpler correct implementation instead.

The final objective remains a complete, production-capable open-source Instantly.ai alternative—not a reduced-feature application.

Verify that Ponytail and Superpowers, or compatible repository-scoped skills/workflows, are actually available before beginning the autonomous planning, independent review, and execution workflow.

CRITICAL — Credit Exhaustion and Automatic Recovery Protocol

This project is expected to span multiple Claude Code usage windows and potentially multiple sessions.

Never assume sufficient credits remain to finish the entire project.

The development process must be designed so that interruption at almost any point does not require restarting the project or repeating completed work.

Mandatory Checkpointing

1. Break the approved implementation plan into small, independently completable tasks.
2. Commit and push verified work to GitHub after every completed task.
3. Update `docs/PROGRESS.md`, `docs/HANDOFF.md`, and `docs/TASKS.json` frequently.
4. Do not wait until the end of a development phase to save progress.
5. Keep tasks small enough that an interruption results in minimal lost work.
6. Save important architectural decisions immediately.
7. Keep the project runnable at verified milestones.
8. Maintain a record of incomplete changes and outstanding test failures.
9. Treat remote Git history and committed project-state files as the authoritative recovery source.

Credit-Aware Execution

- Prefer Sonnet for most implementation tasks.
- Use Haiku for straightforward, bounded operations.
- Use Opus only when technical difficulty justifies it.
- Avoid unnecessary simultaneous agents that rapidly consume usage.
- Use focused reviews rather than repeatedly auditing unchanged code.
- If usage information is available, monitor remaining capacity.
- When approaching a usage limit, prioritize completing and saving the active task rather than starting another large task.

Do not rely solely on a warning before credits run out. Checkpoint proactively throughout development.

Interrupted Task Recovery

Every task must have a unique ID, documented acceptance criteria, and persistent status.

If execution stops unexpectedly, the next session must:

1. Load `CLAUDE.md` and the project-state files.
2. Inspect Git status, branches, and recent commits.
3. Reconcile documented task completion against actual code.
4. Determine whether the interrupted task was fully or partially implemented.
5. Preserve usable partial work.
6. Re-run any necessary tests.
7. Resume at the earliest unfinished step.
8. Continue the existing approved Superpowers implementation plan.
9. Continue independent review, commits, and GitHub pushes.

Never regenerate the project from scratch merely because the previous Claude session ended.

"Keep Going" Command

When I return after my credits reset and say:

"Keep going."

Immediately recover the existing rightnow-ai project and continue autonomous development from the previous checkpoint.

Do not ask me to explain the project again.

Do not restart completed tasks.

Do not require me to manually summarize previous sessions.

Do not create a new implementation plan unless the existing plan is demonstrably obsolete.

Continue until the full project specification and acceptance criteria are satisfied.

Final Requirement

Design the entire development workflow around the assumption that credits may expire without warning.

No individual Claude conversation or temporary cloud environment should be the sole location of important project state.

The GitHub repository, `CLAUDE.md`, implementation plan, task records, and handoff documentation must provide everything necessary for recovery.

# Build a Complete Open-Source Instantly.ai Alternative called RightNow\.ai

## PRIMARY MISSION

Build a fully functional, production-ready, self-hosted, open-source alternative to Instantly.ai, using Claude Code on a remote cloud development environment.

**The objective is feature parity with Instantly.ai's publicly observable cold-email automation platform, not merely a similar-looking application.**

Replicate the product's major workflows, feature coverage, integrations, user experience, automation logic, settings, and reporting, while using original source code and design.

You must build an actual working application, with production-capable backend infrastructure, persistent data, reliable asynchronous workers, real email provider connections, and comprehensive testing.

The project should be developed as one continuous, autonomous engineering workflow with no routine user intervention.

**Mandatory:** Use the installed Superpowers plugin to plan, independently review, implement, test, review code, and complete the project.

Do not stop after generating a plan. Do not stop after completing an initial scaffold or MVP. Execute the full project specification, phase by phase, until the acceptance criteria are met or an unavoidable external dependency prevents further work.

---

# PART I — PRODUCT REQUIREMENTS

## 1. Technical Architecture

Use the following default technology stack unless a clearly superior, well-supported alternative is justified:

- Next.js, React, TypeScript, Tailwind CSS, shadcn/ui

- Node.js backend

- PostgreSQL with Prisma

- Redis and BullMQ for job processing

- Google OAuth 2.0 and Gmail API

- Microsoft Graph and OAuth

- IMAP/SMTP support for other email providers

- Auth.js or equivalent secure authentication

- Recharts for analytics

- Docker Compose for deployment

- Vitest and Playwright for testing

Build a modular monorepo separating the frontend, backend API, email-provider integrations, campaign scheduler, sending workers, inbox synchronization, analytics, and CRM.

Initially support one business owner with multiple email accounts, while maintaining a multi-tenant architecture that can eventually accommodate multiple workspaces.

Provide an MIT-licensed open-source repository with setup documentation, migrations, Docker configuration, sample environment variables, tests, and deployment instructions.

## 2. Product Interface

Build an original, modern, professional SaaS interface with functionality comparable to Instantly.ai.

Main navigation:

1. Dashboard
2. Email Accounts
3. Warm-Up & Deliverability
4. Campaigns
5. Leads
6. Unified Inbox
7. CRM
8. Analytics
9. Automations
10. Settings

Use responsive layouts, searchable tables, filters, charts, campaign builders, contextual controls, and informative status displays.

Every interface control must connect to real application functionality.

## 3. Connected Email Accounts

Recreate Instantly's account-connection workflow.

### Google integration

Implement:

- Connect with Google.

- Google OAuth 2.0.

- Gmail API sending.

- Authorized mailbox synchronization.

- Refresh-token management.

- Encrypted token storage.

- Account reconnection and revocation.

- Multiple independently connected mailboxes.

- Google Workspace support.

- Provider connection diagnostics.

- Sending activity and remaining limits.

Use official Google APIs and least-privilege permissions.

Include the required Google Cloud Console setup and OAuth verification documentation.

### Additional providers

Support Microsoft 365/Outlook through Microsoft Graph and other authorized providers through IMAP/SMTP.

Include account health information, connection status, provider errors, daily limits, account-specific campaign assignments, and bulk account management.

### Inbox synchronization

Implement real-time or near-real-time synchronization through provider-supported push notifications, history APIs, delta queries, or appropriately scheduled polling.

Import authorized historical conversations, avoid duplicates, and maintain correct email threading.

## 4. Campaign Creation and Automation

Reproduce Instantly's email campaign functionality.

Allow users to:

- Create, duplicate, edit, archive, and delete campaigns.

- Upload leads and assign contact lists.

- Assign multiple sending accounts.

- Schedule campaigns by date, time, and timezone.

- Configure daily sending limits.

- Set weekday-only and custom sending windows.

- Create unlimited configurable sequence steps.

- Define delays between follow-ups.

- Pause and resume campaigns.

- Preview personalized messages.

- Track campaign performance.

### Sequences

Support initial emails and follow-ups with configurable delays and conditions.

Automatically stop follow-ups after a reply, unsubscribe, hard bounce, or manual removal.

Support reply-dependent branching, out-of-office handling, and rescheduling where appropriate.

### Personalization

Support merge fields such as:

- \`{{firstName}}\`

- \`{{lastName}}\`

- \`{{companyName}}\`

- \`{{jobTitle}}\`

- \`{{website}}\`

- \`{{industry}}\`

- Custom lead fields

Provide fallback values, preview rendering, and validation.

### A/B testing and spintax

Implement multiple campaign variants and configurable recipient assignment.

Support Instantly-style spintax for legitimate text variations, such as:

\`{{RANDOM | Hi | Hello | Hey}} {{firstName}}\`

Support variations in subject lines, greetings, email bodies, and calls to action.

Track results by variant and sequence step.

## 5. Backend Email Sending Pipeline

Build a robust, persistent, queue-based email dispatch system.

Use Redis and BullMQ or an equivalent reliable architecture.

Implement:

- Per-account sending queues.

- Campaign-level queues.

- Persistent scheduled messages.

- Account rotation.

- Configurable daily quotas.

- Workspace-wide quotas.

- Minimum send intervals.

- Bounded randomized scheduling intervals.

- Timezone-based scheduling.

- Gradual volume ramp-up.

- Automatic provider rate-limit handling.

- Exponential-backoff retries.

- Atomic quota reservations.

- Idempotent processing.

- Worker crash recovery.

- Failure monitoring.

- Automatic pauses when account health deteriorates.

Sending jobs must continue when the user closes their browser.

Ensure that parallel workers cannot accidentally exceed sending limits or send duplicate messages.

Distinguish provider-accepted messages from confirmed delivery.

Respect Gmail, Microsoft, and other providers' actual restrictions; do not attempt to circumvent enforced limits.

## 6. Warm-Up and Deliverability

Recreate Instantly's user-facing warm-up configuration, dashboard, scheduling, and deliverability tools as closely as practical.

Build:

- Account warm-up settings.

- Automatic sending-volume ramp-up.

- Warm-up activity tracking.

- Account reputation diagnostics.

- Domain authentication checks.

- SPF, DKIM, and DMARC analysis.

- MX and DNS checks.

- Bounce monitoring.

- Deliverability warnings.

- Health-based sending slowdowns.

- Custom warm-up schedules.

- Configurable daily warm-up volumes.

- Optional inbox-placement testing.

- Integration interfaces for legitimate external warm-up providers.

Investigate how Instantly's warm-up workflows behave through public documentation and observable product behavior.

Implement comparable controls and supported functionality without assuming access to its proprietary network of participating mailboxes.

For automated email exchanges, use only explicitly authorized or opt-in mailboxes and keep testing activity separate from genuine customer-engagement metrics. Do not manufacture deceptive engagement signals or claim artificial warm-up guarantees inbox placement.

## 7. Lead Management

Build a complete lead/contact database with:

- CSV uploads.

- Automatic and manual column mapping.

- Email validation.

- Duplicate detection.

- Lead-list creation.

- Custom fields.

- Tags and filters.

- Bulk editing.

- Contact history.

- Campaign attribution.

- Import and export.

- Durable suppression lists.

- Email verification integration hooks.

Support importing relevant historical conversations from authorized accounts and associating them with leads.

Prevent the same contact from receiving conflicting outreach campaigns.

## 8. Unified Inbox

Build an Instantly-style centralized inbox.

Support:

- All connected email accounts.

- Threaded conversations.

- Search and filtering.

- Campaign attribution.

- Contact information.

- Reply composition.

- Attachments.

- Notes.

- Read/unread status.

- Reply categorization.

- Follow-up reminders.

Correctly identify incoming replies using email headers and provider identifiers.

Automatically cancel pending follow-ups upon genuine recipient replies.

Classify replies as interested, not interested, neutral, meeting requested, out of office, unsubscribe, automated response, or uncertain.

Use deterministic rules and optional AI classification. Allow manual corrections.

## 9. Email Analytics and Event Tracking

Track:

- Scheduled messages.

- Sending attempts.

- Provider acceptance.

- Sending failures.

- Hard and soft bounces.

- Unsubscribes.

- Replies.

- Positive replies.

- Negative replies.

- Optional estimated opens.

- Optional clicks.

- Meetings.

- Opportunities.

- Won and lost deals.

- Revenue.

Store events reliably and deduplicate incoming provider notifications.

Distinguish actual recipient engagement from estimates, automated opens, and privacy-proxy activity.

Support accurate reporting by campaign, sender, template variant, recipient segment, and time period.

## 10. Sales CRM

Implement a complete CRM with customizable pipeline stages.

Default stages:

1. Not Contacted
2. Contacted
3. Replied
4. Interested
5. Meeting Scheduled
6. Proposal Sent
7. Negotiation
8. Closed Won
9. Closed Lost

Include a Kanban interface, opportunity records, deal values, expected close dates, owner assignment, notes, tasks, reminders, and activity histories.

Attribute opportunities and actual recorded revenue to originating campaigns where possible.

Track conversion rates and revenue per lead.

## 11. Analytics Dashboard

Build dashboards for:

- Outbound volume.

- Connected account usage.

- Remaining daily capacity.

- Campaign progress.

- Reply rates.

- Positive reply rates.

- Bounce rates.

- Unsubscribes.

- A/B performance.

- Meetings booked.

- CRM opportunities.

- Sales conversion.

- Revenue attribution.

- Sender health.

- Deliverability trends.

Provide date filters, campaign filters, account filters, charts, and CSV exports.

All metrics must use real stored data.

## 12. Automation Rules

Create event-driven workflows.

Examples:

- Positive reply → stop sequence and create an opportunity.

- Unsubscribe → suppress contact globally.

- Bounce → stop emails and update health.

- Account quota reached → defer remaining messages.

- Sending failure threshold reached → pause account.

- Deal won → update revenue analytics.

Support authenticated APIs and signed outgoing webhooks.

## 13. Optional AI Features

Provide modular integrations for:

- Email drafting.

- Personalization.

- Follow-up suggestions.

- Reply categorization.

- Conversation summaries.

- Lead scoring.

- CRM recommendations.

- Campaign analysis.

Keep AI generation optional, with human review of AI-written recipient-facing messages by default.

## 14. Security and Compliance

Implement secure OAuth flows, encrypted credentials, tenant isolation, session security, auditing, input validation, appropriate access controls, safe email rendering, and secret management.

Support unsubscribe links, suppression handling, honest sender identification, contact-data deletion, applicable legal compliance settings, and authorized data imports.

Do not fabricate email identities, falsely report delivery, impersonate users, or implement deceptive spam-filter circumvention.

---

# PART II — MANDATORY AUTONOMOUS DEVELOPMENT ORCHESTRATION

**This section takes precedence over the ordinary human-approval and conversational checkpoint behavior of development planning tools, to the extent that their documented workflows permit.**

The user has already approved the overall product objective and the use of an autonomous development workflow.

The user does not want to supervise intermediate steps.

Treat this specification as authorization to perform ordinary planning, internal reviews, code edits, tests, feature branches, commits, and pushes to the configured project repository, subject to repository permissions and safety boundaries.

Do not repeatedly ask whether you should continue.

## 15. Superpowers Plugin — Mandatory

Before implementing anything:

1. Verify that the official Superpowers plugin for Claude Code is installed and available.
2. If unavailable, install it through the supported Claude Code plugin mechanism if the environment permits.
3. Use its documented skills for planning, subagent-driven implementation, test-driven development, code review, debugging, and verification.
4. Follow the currently installed skill instructions rather than relying on outdated command names.
5. Do not silently skip Superpowers when available.

Use these skills where appropriate:

- \`brainstorming\`

- \`writing-plans\`

- \`using-git-worktrees\`

- \`subagent-driven-development\`

- \`dispatching-parallel-agents\`

- \`test-driven-development\`

- \`systematic-debugging\`

- \`requesting-code-review\`

- \`receiving-code-review\`

- \`verification-before-completion\`

- \`finishing-a-development-branch\`

Adapt the normal Superpowers process for autonomous execution as described below.

## 16. Plan, Independently Review, Then Execute

The project must follow this sequence.

### Stage A — Research Instantly.ai

Investigate Instantly.ai's publicly documented functionality and observable workflows.

Consult:

- Official product documentation.

- Official help center.

- Public API documentation.

- Public feature descriptions.

- Available screenshots and demonstrations.

- Provider API documentation.

- Legitimate open-source implementation references.

Construct a comprehensive feature-parity checklist.

Whenever a product behavior is unclear, first investigate how Instantly.ai handles it.

Prioritize functional similarity over arbitrary new design decisions.

Do not reproduce proprietary source code, hidden credentials, inaccessible networks, or copyrighted design assets.

For undisclosed internal implementation details, implement a robust equivalent that produces the intended user-facing behavior.

### Stage B — Create the full implementation plan

Use Superpowers' \`writing-plans\` skill.

Develop a detailed, actionable plan covering the entire project.

The plan must include:

- Architecture.

- Repository organization.

- Database design.

- API contracts.

- Background processing design.

- Email provider integrations.

- All major feature modules.

- Technical dependencies.

- Development milestones.

- Task assignments.

- Acceptance criteria.

- Testing requirements.

- Deployment requirements.

- Feature-parity checklist.

Break the work into small, independently verifiable tasks with explicit file paths and completion tests.

Store the master product specification separately from the implementation plan so agents can reference both.

### Stage C — Independent plan review

**A separate agent must review the plan before implementation begins.**

The agent that wrote the plan must not approve its own plan.

Dispatch an independent planning-review agent with a fresh context.

The reviewer must verify:

- Coverage of all product requirements.

- Correctness and completeness of proposed architecture.

- Feature parity with Instantly.ai.

- Missing integrations or backend dependencies.

- Database consistency.

- Feasibility of the email dispatch design.

- Scalability and reliability.

- Security and authorization.

- Testing coverage.

- Clarity of individual tasks.

- Task dependency ordering.

- Cost efficiency of the implementation process.

The reviewer must produce an explicit assessment: Approved, or Changes Required.

If changes are required:

1. Return findings to the planning agent.
2. Revise the plan.
3. Re-run independent review.
4. Repeat until the plan meets the review requirements.

Do not ask the user to review the plan.

The independent reviewer is responsible for internal plan approval.

Save the final approved plan and review report in the repository.

### Stage D — Automatic execution

Once the plan is approved, immediately transition into implementation using \`subagent-driven-development\`.

Do not wait for another instruction.

Do not ask:

- "Should I begin?"

- "Is this plan approved?"

- "Would you like me to continue?"

- "Which feature should I prioritize?"

- "Should I commit these changes?"

- "Should I start the next phase?"

These decisions are already authorized within the project scope.

Continue automatically.

---

# PART III — MULTI-AGENT EXECUTION

## 17. Main Agent Responsibilities

The main Claude agent acts as the project orchestrator.

It should primarily:

- Maintain the approved implementation plan.

- Track progress.

- Assign work.

- Select appropriate models.

- Manage dependencies.

- Manage context usage.

- Coordinate independent reviews.

- Enforce quality gates.

- Maintain the Git repository.

- Recover interrupted work.

- Ensure the full project is completed.

Avoid having the orchestrator personally perform all implementation work.

Delegate bounded development tasks to fresh-context subagents.

## 18. Agent Model Selection and Cost Optimization

**Do not use the most expensive model by default.**

Use the least expensive available Claude model that is sufficiently capable of reliably completing each task.

Recommended routing:

| Responsibility | Preferred model |

|---|---|

| File inspection and straightforward research | Haiku |

| Simple mechanical edits | Haiku |

| Routine frontend development | Sonnet |

| API integration implementation | Sonnet |

| Database schema and migrations | Sonnet |

| Background workers | Sonnet |

| Unit and integration tests | Sonnet |

| Routine code review | Sonnet |

| Initial architecture | Sonnet or Opus when justified |

| Difficult concurrency/security architecture | Opus when justified |

| Complex unresolved debugging | Opus when justified |

| Final cross-system review | Opus when justified |

These are model-family recommendations. Resolve the specific model versions against the models actually available in the user's Claude environment.

Explicitly specify subagent models rather than silently inheriting a more expensive orchestrator model.

Use Sonnet as the default for most coding and coordination.

Use Haiku only when the task is simple and bounded enough to be reliably completed.

Reserve Opus for tasks with a strong justification based on technical complexity, risk, or repeated failure.

If a cheaper model encounters a genuine reasoning blocker, escalate that specific task, not the entire project.

Do not repeatedly retry identical failed prompts.

### Token and credit efficiency

Minimize unnecessary:

- Repeated repository-wide inspections.

- Large duplicated prompts.

- Re-reading unchanged files.

- Excessive review loops over trivial changes.

- Use of Opus for routine implementation.

- Duplicate subagent investigations.

- Unbounded parallel agent spawning.

Use explicit task briefs, bounded outputs, small diffs, targeted tests, and summarized findings.

Do not sacrifice essential code reviews or security verification simply to save tokens.

## 19. Implementation and Review Loop

Every implementation task should follow this process:

**Step 1 — Dispatch implementer**

Create a clearly scoped task with relevant requirements, file paths, and acceptance tests.

Assign a suitable Claude model.

**Step 2 — Implement**

The agent writes production code and corresponding tests.

Follow test-driven development where appropriate.

**Step 3 — Verify**

Run applicable tests, linting, type checks, and integration checks.

**Step 4 — Commit**

Create a descriptive Git commit once the implementation is verified.

**Step 5 — Independent review**

Dispatch a separate review agent to inspect the task's actual code changes against the approved plan.

Evaluate both specification compliance and code quality.

**Step 6 — Fix findings**

If important issues are found, assign fixes and re-run the relevant reviews.

Do not accept critical unresolved defects.

**Step 7 — Record completion**

Update the persistent project progress files with task status, commit identifiers, tests, and review outcome.

**Step 8 — Continue**

Automatically dispatch the next task.

Do not ask the user for permission between steps.

### Parallel agents

Parallelize tasks only when they can operate safely on independent files or isolated worktrees.

Use separate branches or worktrees when appropriate.

Avoid simultaneous conflicting modifications to the same modules.

Integrate changes through reviewed commits.

Keep the main branch stable.

## 20. Git and Remote Repository Management

Use Git as a permanent record of project development.

Requirements:

- Initialize Git if necessary.

- Use descriptive feature branches.

- Commit at verified task milestones.

- Record meaningful commit messages.

- Use worktrees for isolated development where helpful.

- Push reviewed branches to the configured remote repository.

- Run CI or equivalent checks when available.

- Merge approved work through a controlled integration process.

- Preserve a recoverable history.

- Never commit secrets or OAuth credentials.

Do not make all changes in one enormous unreviewed commit.

The user authorizes ordinary code commits and pushes for this project. Do not request repeated approval for those actions when repository permissions allow them.

If the remote repository is not configured, retain local commits and record the missing setup dependency rather than inventing a remote or blocking unrelated development.

Do not delete repositories, overwrite unrelated branches, or deploy to production without the necessary authorization and safeguards.

---

# PART IV — CONTEXT MANAGEMENT AND UNINTERRUPTED PROGRESS

## 21. Persistent Project Memory

**The entire project must remain resumable without relying on a single Claude conversation's context window.**

Create and maintain the following files:

\`CLAUDE.md\`

Contains concise permanent instructions, product objective, architecture conventions, build commands, testing commands, model-routing defaults, and instructions for autonomous continuation.

\`docs/PRODUCT_SPEC.md\`

Contains the full product requirements and feature-parity checklist.

\`docs/IMPLEMENTATION_PLAN.md\`

Contains the independently approved execution plan.

\`docs/PROGRESS.md\`

Contains completed phases, current milestones, and remaining work.

\`docs/DECISIONS.md\`

Records significant architecture and implementation decisions with explanations.

\`docs/HANDOFF.md\`

Contains the exact current execution state and recovery instructions.

\`docs/REVIEW_LOG.md\`

Records plan approvals, implementation reviews, outstanding issues, and review outcomes.

\`docs/TASKS.json\`

Contains machine-readable task identifiers, statuses, dependencies, assigned models, commit identifiers, and acceptance criteria.

These files are durable project memory and must be kept synchronized with actual repository state.

Do not rely on conversation summaries alone.

## 22. Automatic Context Management

Monitor context usage throughout the project.

Before approaching context limits:

1. Finish or checkpoint the current bounded operation.
2. Save all relevant code changes.
3. Update the progress and handoff files.
4. Record the active task and next action.
5. Commit recoverable progress when appropriate.
6. Use Claude Code's supported context-compaction or session continuation mechanisms.
7. Resume from the durable project state.

Keep the main orchestrator's context small by delegating implementation and reviews to independent subagents.

Avoid importing large unrelated code files into the orchestrator's context.

Always preserve essential architectural decisions, active task state, and unresolved issues on disk.

### Context handoff requirements

Before ending or replacing any working context, record:

- Current phase.

- Current task ID.

- Task completion status.

- Latest Git branch and commit.

- Files modified.

- Tests performed and their results.

- Unresolved issues.

- Review status.

- Next exact implementation action.

- Any external dependencies.

- Instructions for continuation.

The next session must be able to recover without reading the entire previous conversation.

## 23. Handling Interrupted Sessions and Credit Exhaustion

The application may take multiple Claude Code sessions to complete.

**If a session stops because of credit exhaustion, rate limits, connection interruptions, server restarts, or context exhaustion, the project must remain recoverable.**

Before and during execution, continuously maintain durable checkpoints.

If interruption occurs:

- Preserve all completed code.

- Preserve local Git history.

- Push reviewed checkpoints when possible.

- Preserve the complete approved plan.

- Preserve progress and review records.

- Record the precise next task.

- Avoid leaving uncommitted changes undocumented.

When the user returns after credits become available, the following instruction must be sufficient:

**"Keep going."**

Interpret that instruction as:

1. Read \`CLAUDE.md\`.
2. Read the approved implementation plan.
3. Read progress and handoff files.
4. Inspect Git status and recent commits.
5. Reconcile recorded progress against actual code.
6. Determine the first incomplete or interrupted task.
7. Recover or rerun only the necessary verification.
8. Continue the autonomous implementation process.
9. Resume independent reviews and commits.
10. Continue through the remaining project phases.

Do not restart the entire project.

Do not regenerate an existing approved plan unless a substantial architectural change genuinely requires it.

Do not reimplement completed functionality.

Do not repeatedly ask the user to restate the objective.

Do not lose completed work simply because the previous context is unavailable.

Credit exhaustion may prevent further execution until capacity returns; preserve enough durable state that a later session can resume cleanly rather than pretending execution can continue without resources.

## 24. Recovery and Resume Command

Create a repository file named:

\`docs/RESUME_INSTRUCTIONS.md\`

It should define the recovery process for any fresh Claude Code session.

Its primary instruction should be:

> You are resuming the autonomous development of an open-source Instantly.ai alternative. Read the project specification, approved Superpowers plan, progress files, handoff notes, task records, and Git history. Resume the first unfinished task. Continue implementing, testing, independently reviewing, and committing work without requesting routine user approval. Use cost-appropriate Claude models. Do not restart completed work. Continue until the project requirements and acceptance criteria are satisfied or an unavoidable external blocker occurs.

Document supported Claude Code session-resumption options, including \`--continue\` and \`--resume\` where available.

The project must also remain resumable from a completely new session using only the repository files.

---

# PART V — DECISION-MAKING WITHOUT USER INVOLVEMENT

## 25. Instantly.ai as the Product Reference

**When requirements are unclear, use Instantly.ai's publicly documented and observable behavior as the primary product reference.**

Examples:

- If uncertain how to configure a campaign, investigate Instantly's campaign flow.

- If uncertain how account rotation should work, investigate its documented behavior.

- If uncertain about lead statuses, follow its supported contact-management conventions.

- If uncertain about the inbox interface, use its observable workflows as a reference.

- If uncertain about warm-up settings, consult its public documentation.

- If uncertain how analytics are presented, implement comparable metrics and reporting.

Do not repeatedly ask the user how these features should behave.

When Instantly's implementation is private or undocumented, make a reasoned engineering decision producing equivalent functionality.

Document significant departures and limitations.

### Decision hierarchy

Use this order:

1. Explicit requirements in this prompt.
2. Publicly verified Instantly.ai behavior.
3. Approved product specification.
4. Approved architecture and implementation plan.
5. Reliable provider documentation.
6. Standard engineering best practices.
7. Independent agent review of unresolved alternatives.

Choose sensible defaults and proceed.

## 26. No Routine Human-in-the-Loop

Do not interrupt the user for:

- Architectural preferences.

- Database naming.

- UI styling decisions.

- Ordinary technology choices.

- Implementation sequencing.

- Routine code reviews.

- Test fixes.

- Plan approvals.

- Routine commits or authorized pushes.

- Beginning the next phase.

Use internal agent review and project requirements to resolve these decisions.

### Genuine external blockers

Human participation may still be necessary for:

- OAuth consent and external account authorization.

- Account verification.

- Providing credentials or configuring secret stores.

- Acquiring unavailable third-party services.

- Paid purchases.

- Irreversible destructive operations.

- Legally required decisions.

- Security-sensitive external actions without authorization.

When an external blocker arises:

1. Record the exact dependency.
2. Continue all independent work that does not require it.
3. Implement mocks or test harnesses where appropriate, explicitly labeling them as such.
4. Document the future configuration steps.
5. Ask the user only when no further meaningful development can proceed.

Do not fabricate successful external integrations or claim a service is configured when credentials are missing.

---

# PART VI — DEVELOPMENT PHASES

## 27. Required Implementation Order

Use the independently reviewed plan to implement all phases.

### Phase 1 — Foundation

Repository, Docker, authentication, database, project architecture, frontend shell, and testing infrastructure.

### Phase 2 — Email Provider Connections

Google OAuth, Gmail API, secure token management, multiple mailbox connections, real sending, inbox synchronization, and provider-health diagnostics.

### Phase 3 — Campaign Automation

CSV import, contact lists, campaign builder, personalized templates, spintax, multistep sequences, scheduler, quotas, and account rotation.

### Phase 4 — Incoming Mail and Tracking

Unified inbox, real reply detection, thread matching, automatic follow-up cancellation, bounce handling, suppression, tracking, and event processing.

### Phase 5 — Deliverability

Domain health, sending ramp-up, warm-up management, verification hooks, reputation diagnostics, and health-based protection.

### Phase 6 — CRM and Analytics

Lead stages, opportunities, Kanban pipeline, task management, revenue attribution, dashboards, and campaign analytics.

### Phase 7 — Advanced Features

Microsoft integration, IMAP/SMTP integrations, AI features, advanced workflow rules, A/B testing, webhooks, improved UI, and operational hardening.

### Phase 8 — Final Verification

Independently verify the complete application against the original specification and the Instantly.ai feature-parity checklist.

Identify missing functionality, correct defects, and complete outstanding features.

Do not mark the project complete merely because all planned tasks have been checked off.

The implemented software must satisfy the acceptance criteria.

---

# PART VII — QUALITY AND COMPLETION

## 28. Continuous Verification

Every phase must finish with:

- Working application code.

- Relevant automated tests.

- Passing type checks.

- Passing lint checks.

- Integration verification where applicable.

- Independent code review.

- Git commits.

- Updated progress records.

- Updated handoff records.

Implement end-to-end tests of:

1. Google account connection.
2. Real authorized test-email sending.
3. Lead CSV import.
4. Campaign creation.
5. Automated multistep sending.
6. Sending quota enforcement.
7. Correct account rotation.
8. Reply synchronization.
9. Automatic cancellation of follow-ups.
10. Bounce detection and suppression.
11. Inbox threading.
12. CRM opportunity creation.
13. Revenue recording.
14. Analytics accuracy.
15. Worker restart recovery.
16. Session interruption and project resumption.

Use mocks for deterministic provider tests and separately document real-integration verification.

## 29. Final Independent Review

After all phases, dispatch a fresh independent senior-review agent.

This agent must evaluate:

- Feature parity.

- Architecture.

- Security.

- Reliability.

- Data consistency.

- Queue correctness.

- Provider compliance.

- Test quality.

- Scalability.

- Recoverability.

- Documentation.

- Deployment readiness.

Run appropriate full-project test suites.

Fix critical or important findings.

Repeat the final review where necessary.

Only report the application as complete when its acceptance criteria have actually been met.

## 30. Final Deliverables

Produce:

- Complete source repository.

- Working frontend and backend.

- Database schema and migrations.

- Background workers.

- Connected email-provider infrastructure.

- Campaign automation engine.

- Reply and bounce tracking.

- Unified inbox.

- CRM.

- Analytics dashboards.

- Deliverability and warm-up management.

- Docker deployment configuration.

- Environment variable documentation.

- OAuth setup instructions.

- Tests and verification reports.

- API documentation.

- Final feature-parity assessment.

- Known limitations.

- Resume instructions.

Provide actual repository and deployment information rather than claiming success without verification.

---

Additional Requirement — Existing Mailbox Reactivation and Re-Warm-Up

Implement a complete email account reactivation system for email addresses that have previously been warmed up and used successfully but have been inactive for an extended period.

This is a required feature, not optional.

1\. Detect inactive mailboxes

For every connected email account, track:

- Date of last outbound email.
- Date of last campaign activity.
- Historical sending volume.
- Historical bounce and reply rates.
- Recent provider errors.
- Duration of inactivity.
- Previous warm-up configuration.
- Current domain authentication health.

Allow configurable inactivity thresholds, such as 7, 14, 30, and 60 days.

Automatically flag accounts that may benefit from a gradual restart.

2\. Re-Warm-Up Mode

Provide a dedicated Re-Warm Account button in the Email Accounts dashboard.

When activated:

- Preserve the account's historical data.
- Recheck SPF, DKIM, DMARC, and account connectivity.
- Reset the campaign sending volume to a conservative starting level.
- Gradually increase permitted daily sending volume.
- Monitor bounce rates, provider errors, and deliverability indicators.
- Automatically pause or reduce volume if account health deteriorates.
- Return the account to its normal sending limits when the configured reactivation criteria are satisfied.

Do not require the user to delete and reconnect the email account or create a new mailbox.

3\. Automatic Reactivation Scheduling

Allow the user to enable automatic reactivation protection.

If an account has been inactive beyond a configurable threshold, the system should recommend or automatically activate a reduced-volume restart policy before the next campaign.

Apply the reduced limits directly to the backend sending scheduler.

Campaigns must respect these restrictions even when multiple sending workers are active.

4\. Reactivation Dashboard

Display:

- Current account status: Active, Inactive, Re-Warming, Paused, or Needs Attention.
- Days since last sending activity.
- Current daily sending allowance.
- Configured target volume.
- Reactivation progress.
- Historical and current deliverability indicators.
- Any outstanding warnings.
- Estimated reactivation schedule, clearly labeled as a configurable plan rather than a guaranteed reputation recovery timeline.

5. Warm-Up Activity

   Support legitimate, authorized warm-up and inbox-placement testing with participating mailboxes, but do not fabricate human engagement or manipulate spam classifications.

   If a warm-up network is not available, provide an honest account-reactivation workflow based on gradual sending-volume increases and actual account health.

   Investigate Instantly.ai's publicly documented warm-up and account-management features for functional inspiration, without copying proprietary infrastructure or violating its terms.
6. Implementation and Testing

   Include reactivation in the approved Superpowers development plan.

   Have an independent agent verify that previously active accounts can be reactivated without losing their settings or historical data.

   Test these scenarios:

- Account inactive for 30 days.
- Account inactive for 60 days.
- Previously active account reconnecting after OAuth token expiration.
- Account exceeding a bounce-rate threshold.
- Account successfully returning to its configured normal sending limit.

Make sure the reactivation system works automatically through persistent backend jobs, even when the user is offline.

Mandatory offline recovery: Every time rightnow-ai starts, it must synchronize all connected mailboxes, including incoming replies, outgoing messages, bounces, unsubscribes, and conversation changes that occurred while offline. It must update campaign states, lead records, CRM records, and analytics before allowing automated sending to resume. Synchronization must be incremental where possible, with a full reconciliation fallback, and must handle extended downtime without duplicate sends or missed follow-up cancellations. Include automated tests simulating 1, 7, and 30 days of downtime.

---

## Mandatory Local-First and VPS-Ready Deployment

Implement the **same codebase** to work in both deployment modes:

1. **Local mode:** Start and stop the web app, backend workers, PostgreSQL, and Redis through Docker Compose on a personal computer; persist database and queue state on durable local volumes. When the machine sleeps or is powered off, no background work runs, but the system must recover correctly after startup.
2. **VPS mode:** Run the same services on a Linux VPS, with health checks, automatic restart policies, durable volumes, HTTPS through a supported reverse proxy, backup/restore scripts, secrets management, and operations documentation.

Every local startup **must block outbound campaign processing** until inbox reconciliation completes sufficiently to prevent stale follow-ups. Sync both incoming and provider-sent messages, bounces, suppression requests, and state changes since the last checkpoint; fall back to history reconciliation if incremental sync state has expired. Never burst-send an offline backlog or duplicate uncertain sends. Follow configured daily quotas and sending windows. Test simulated outages of 1, 7, and 30 days. Explicitly document events that cannot be reconstructed without a live tracking service (such as unrecorded tracking-pixel opens).

Provide start, stop, upgrade, backup, and restore commands for both modes and a tested migration procedure from local to VPS.

## Email Provider Compliance Gate

Prior to implementing live automated sending, document each provider's current API acceptable-use requirements. Do not assume a Gmail OAuth app is authorized for unsolicited commercial outreach merely because its API can send messages. Use permitted provider integrations, comply with quotas, and keep any unsupported delivery channel behind a disabled integration interface. Allow lawful campaign creation and testing independently of unavailable or disallowed provider access.

---

# FINAL EXECUTION DIRECTIVE

**You are not being asked to discuss how to build this application. You are being instructed to build it.**

The primary objective is to reproduce Instantly.ai's major user-facing functionality with original, open-source, self-hosted software.

Your responsibilities are to:

1. Research Instantly.ai.
2. Write the complete product specification.
3. Use Superpowers to create a detailed implementation plan.
4. Have a separate agent independently review and approve that plan.
5. Automatically begin execution.
6. Use appropriately priced Claude models for individual tasks.
7. Independently review implementation code.
8. Fix identified issues.
9. Commit and push reviewed progress.
10. Maintain persistent context and checkpoints.
11. Automatically continue through all project phases.
12. Recover cleanly after interruptions or credit exhaustion.
13. Conduct an independent final review.
14. Deliver the working application and documentation.

**Do not stop at the planning stage. Do not stop after an MVP. Do not request routine user approvals. Do not lose progress when context becomes limited. Do not restart completed work after an interruption.**

Use Instantly.ai as the primary behavioral reference wherever the specification leaves an implementation decision unresolved.

Start the autonomous Superpowers workflow now.

