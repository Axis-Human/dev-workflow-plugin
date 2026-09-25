# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is **not an application** — it is a Claude Code **plugin** (`axis-human-ai-toolbox`) packaged as a marketplace source. There is no build, lint, or test pipeline. All "code" is Markdown: skill definitions, agent definitions, and templates that Claude Code loads at runtime.

The plugin is consumed by end users via `claude plugin install` and runs inside their Claude Code sessions in arbitrary downstream projects.

## Architecture

The plugin combines three primitives:

- **Skills** (`skills/<name>/SKILL.md`) — Invoked by the user as `/<name>`. Frontmatter uses `allowed-tools`. Self-contained workflows.
- **Agents** (`agents/<name>.md`) — Sub-agent definitions invoked by workflow pipelines (via `agentType`) or by the orchestrator for single-hop routes. Frontmatter uses `tools` and may declare `skills:` to preload skill bodies inline.
- **Workflows** (`workflows/<name>.js`) — Deterministic JavaScript pipeline scripts that orchestrate multi-step agent sequences via the Claude Code `Workflow` tool. Each script encodes a routing table sequence (e.g., plan → test → implement → review → PR) with structured schemas for data passing and a review retry loop.

### Routing model

The `UserPromptSubmit` hook (`hooks/orchestrator-router.js`) classifies every prompt into bypass / suggest / route. For engineering work, it recommends invoking the `orchestrate` skill (`skills/orchestrate/SKILL.md`), which handles wiki setup, context gathering, branch creation, and workflow dispatch.

For multi-step routes (quick_task, implementation, refactor, bug), the `orchestrate` skill calls `Workflow({ scriptPath: "…/workflows/<name>.js", args: {…} })`. The workflow handles the full pipeline deterministically — no model-driven sequencing between stages. For single-hop routes (new_feature, design_system, code_review, a11y, wiki_management), the skill dispatches to an Agent or Skill directly.

There is no orchestrator agent. The `orchestrate` skill runs in the main session and delegates to workflows (for pipelines) or agents (for single hops). This eliminates the extra agent hop that the old orchestrator required.

All other agents remain as sub-agent definitions. Workflows reference them via `agentType: 'axis-human-ai-toolbox:<agent-name>'`. When you add or rename an agent, update the `AGENTS` constant in any workflow that references it.

Skills and agents often *pair up*: many skills (e.g. `implement-task`, `plan-expert`, `feature-discovery`) have a same-named agent that preloads them via the `skills:` frontmatter field. The skill is for direct `/command` invocation; the agent is for workflow routing. Keep their bodies in sync when editing one.

## Manifest files

- `.claude-plugin/plugin.json` — Plugin metadata loaded by `claude plugin install`. The `name` here (`axis-human-ai-toolbox`) is the canonical plugin identifier used in `~/.claude/settings.json` `enabledPlugins` and in `claude plugins update`.
- `.claude-plugin/marketplace.json` — Marketplace registry entry. The `source.repo` points to where Claude Code fetches the plugin from when installed via the GitHub source.

If you rename the plugin, both files plus `README.md` and `install.sh` must be updated together.

## Installation hooks

`install.sh` installs the plugin via `claude plugin install`. The plugin bundles hooks in `hooks/hooks.json`:

- `UserPromptSubmit` → classifies the prompt and suggests the `orchestrate` skill for engineering work.
- `PreToolUse` → guards against direct writes from the orchestrate context (defense in depth).
- `SubagentStop` / `Stop` / `SessionEnd` → telemetry events.

The merge is idempotent (checks for the exact command string before appending). If you change either hook command in `install.sh`, existing installations will continue to hold the old command and the new one will be appended — there is no migration path, so prefer additive changes.

## External integrations

Skills and agents reference MCP tools by name in their `tools:` / `allowed-tools:` frontmatter:

- `mcp__clickup__*` — ticket reads, task and subtask creation.
- `mcp__github__*` — PR creation, repo operations.

These MCP servers are configured on the *user's* Claude Code installation, not this repo. When editing a skill or agent that uses an MCP tool, verify the tool name matches what the MCP server actually exposes — a typo here fails silently at runtime in the user's session.

## Conventions

- Agents must be **stack-agnostic**: no hardcoded framework names, file paths, package managers, or project-specific tooling in agent files. They run in arbitrary downstream codebases and must discover the stack at runtime (typically via the `init-project` skill or by reading `AGENTS.md` / `WIKI.md`).
- Frontmatter `effort:` is one of `low | medium | high` and signals expected token cost to Claude Code.
- Agent files end with a `version:` field inside a trailing YAML block — bump it when changing routing or workflow semantics.

## Templates

`templates/` holds Markdown scaffolds emitted by skills into the user's project — `issue_template.md`, `pull_request_template.md`, and the `wiki/` starter set. Edits here directly change what end users get in their repos; treat them as user-facing output, not internal code.
