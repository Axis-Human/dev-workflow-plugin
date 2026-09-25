---
name: orchestrate
description: >
  Classifies user intent and launches the appropriate workflow pipeline or
  specialized agent/skill. The central router for all ai-toolbox engineering
  work — handles wiki setup, context gathering, branch creation, and dispatch.
argument-hint: "<task description or ticket ID>"
allowed-tools: Workflow Agent Skill Bash Read AskUserQuestion mcp__clickup__clickup_get_task mcp__clickup__clickup_get_workspace_hierarchy
effort: medium
---

# Orchestrate

> Route engineering work to the right workflow pipeline or single-hop agent.

---

## Fast path — answer, do not orchestrate

If the request is any of the following, **answer it directly and stop**:
- A question about the codebase, the toolbox, or how something works.
- A lookup, explanation, or summary — anything read-only.
- A single trivial edit (one file, a few lines, no design decision).
- Chatter, acknowledgement, or a follow-up to something already answered.

A workflow must buy something: a plan, a test suite, a review, a PR.
When it buys nothing, skip it.

---

## Workflow

```yaml
0_install_workflows: |
  The Workflow tool can only read scripts from the working directory.
  Copy the plugin's workflow scripts into the project's .claude/workflows/
  so the Workflow tool can find them. Run exactly:

    bash: |
      PLUGIN_WF="$(find ~/.claude -path "*/axis-human-ai-toolbox/workflows" -type d 2>/dev/null | head -1)"
      if [ -n "$PLUGIN_WF" ]; then
        mkdir -p .claude/workflows
        for f in "$PLUGIN_WF"/*.js; do
          cp -u "$f" .claude/workflows/ 2>/dev/null || cp "$f" .claude/workflows/
        done
        echo "synced"
      else
        echo "plugin-not-found"
      fi

  If "plugin-not-found": warn the user that the axis-human-ai-toolbox plugin
  may not be installed and stop.

1_wiki_check: |
  Skip for anything on the fast path.
  Otherwise:
    bash: test -f WIKI.md && echo "exists" || (test -f wiki/WIKI.md && echo "exists-nested" || echo "missing")
  If "exists" or "exists-nested": proceed.
  If "missing": delegate to wiki-agent via Agent tool:
    Agent({ subagent_type: "axis-human-ai-toolbox:wiki-agent",
            prompt: "operation=init — initialize the project wiki" })
  Wait for return before continuing.

2_intent_classification: |
  Classify the user's request as one of:
    quick_task     — Well-defined task, often with a ticket ID
    implementation — Plan already exists, wants code written now
    refactor       — Improve structure without changing behavior
    bug            — Broken behavior, error, or regression
    new_feature    — Unclear scope, needs discovery interview
    design_system  — Design system or Storybook setup
    accessibility  — WCAG compliance check
    code_review    — Review uncommitted or branch changes
    wiki           — Wiki operations or documented knowledge queries

3_context_gathering: |
  If a ClickUp ticket ID is mentioned (CU-xxx), fetch its details with
  mcp__clickup__clickup_get_task.
  If intent is unknown, ask ONE clarifying question.

4_environment_setup: |
  For code changes (quick_task, implementation, refactor, bug):
    bash: git checkout -b {task-id}-{slug}
  Use the ticket ID or a short kebab-case slug from the description.

5_dispatch: |
  Route to the correct mechanism based on intent — see Routing Table below.
```

---

## Routing Table

### Multi-step routes → Workflow pipelines

These intents run as deterministic workflow scripts via the Workflow tool.
After step 0 copies them, they live at `.claude/workflows/` in the project.

| Intent | Script | Pipeline |
|---|---|---|
| `quick_task` | `quick-task.js` | plan → test → implement → review → PR |
| `implementation` | `implement.js` | test → implement → review → PR |
| `refactor` | `refactor.js` | plan → implement → review → PR |
| `bug` | `bug-fix.js` | reproduce → fix → review → PR |

Call pattern:
```
Workflow({
  scriptPath: ".claude/workflows/<script>",
  args: {
    description: "<user request>",
    ticketId: "<CU-xxx if present>",
    branch: "<branch name from step 4>",
    baseBranch: "main"
  }
})
```

For `implementation` intent, also pass `subtasks` in args if the plan text is available.

### Single-hop routes → Agent or Skill directly

These intents do not benefit from a workflow — invoke them directly:

| Intent | Dispatch |
|---|---|
| `new_feature` | `Agent({ subagent_type: "axis-human-ai-toolbox:planning-features-agent", prompt: "<description + ticket context>" })` |
| `design_system` | `Agent({ subagent_type: "axis-human-ai-toolbox:design-system-setup-agent", prompt: "<description>" })` |
| `accessibility` | `Skill("axis-human-ai-toolbox:a11y-auditor")` |
| `code_review` | `Skill("axis-human-ai-toolbox:code-review")` |
| `wiki` | `Agent({ subagent_type: "axis-human-ai-toolbox:wiki-agent", prompt: "<query or operation>" })` |

---

## Boundaries

```yaml
can:
  - Classify intent and dispatch to workflows or agents.
  - Create feature branches for code changes.
  - Fetch ClickUp ticket details for context.
  - Ask one clarifying question when intent is ambiguous.
  - Initialize the project wiki if missing.
  - Copy workflow scripts into the project for local use.

cannot:
  - Write implementation code directly — dispatch to a workflow.
  - Merge code to any branch.
  - Approve code reviews.
  - Guess feature requirements — dispatch to planning-features-agent.
  - Launch a workflow for a request the fast path already covers.
```
