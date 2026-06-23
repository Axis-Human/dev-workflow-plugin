# Dev Workflow Plugin — Codex

> Adapts the `axis-human-ai-toolbox` orchestrator workflow to the Codex CLI.
> Codex has no sub-agent delegation, so **you** (the single Codex agent) play the
> role of the orchestrator: classify the request, then invoke the matching
> **skills** yourself, in sequence.

## Core rule

For every request, before acting:

1. Classify the intent (see Routing Table).
2. Run the skills in the listed sequence, in order, waiting for each to finish.
3. Only write code after the required upstream steps (spec, plan, tests) are done.

Skills live in `~/.codex/skills/<name>/SKILL.md` and are invoked the same way as
any other Codex skill. Never re-implement a skill's logic inline — load and follow
its `SKILL.md` exactly.

## Startup check

Before the first task in a repo, check the wiki:

```bash
test -f WIKI.md && echo exists || echo missing
```

If missing, run `wiki-init` before anything else. If present, proceed.

## Routing Table (intent → skills)

| Intent | When | Skill sequence |
|---|---|---|
| `new_feature` | New product feature, unclear scope | `planning-features` → `implement-task` → `code-review` → `create-pr` |
| `quick_task` | Well-defined task, often a ClickUp ID | `plan-expert` → `implement-task` → `code-review` → `create-pr` |
| `implementation` | Plan exists, write code now | `implement-task` → `code-review` → `create-pr` |
| `refactor` | Improve structure, no behavior change | `plan-expert` → `implement-task` → `code-review` → `create-pr` |
| `bug` | Broken behavior / regression, isolated | `create-issue` (triage) → `implement-task` → `code-review` → `create-pr` |
| `design_system` | Set up / document design system | `design-system-setup` |
| `accessibility_audit` | WCAG / a11y review | `a11y-auditor` → `implement-task` (if fixes needed) |
| `code_review` | Review changes before a PR | `code-review` |
| `wiki_management` | Sync / reinitialize / query the wiki | `wiki-query` · `wiki-sync` · `wiki-init` |
| `unknown` | Ambiguous | Ask one clarifying question, then re-classify |

## Lifecycle

DEFINE → `feature-discovery` / `create-task` · PLAN → `plan-expert` ·
BUILD → `implement-task` · VERIFY → `code-review` · REVIEW → `code-review` +
`a11y-auditor` · SHIP → `create-pr`.

## Environment setup

For any code change, create a branch before editing:

```bash
git checkout -b {task-id}-{slug}
```

## Boundaries

- Do **not** merge code, approve reviews, or delete/archive ClickUp tickets.
- Do **not** guess feature requirements — run `feature-discovery` first.
- Open PRs as **Draft** (the `create-pr` skill enforces this).
