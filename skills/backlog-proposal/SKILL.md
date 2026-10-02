---
name: backlog-proposal
description: Turns a rough feature idea into a complete backlog proposal — problem, evidence, affected users, proposed solution, value, scope, technical analysis, estimate, risks, and open questions — using the agency's Backlog Proposal template. Pulls the project's roles, modules, and domain vocabulary from the project's ClickUp space, then writes the proposal locally and/or publishes it as a ClickUp doc page. Use before a feature enters the backlog, not to create an implementation ticket.
argument-hint: [--project "<space or project name>"] [--doc-id <clickup doc id>] [--parent-page-id <clickup page id>] [--input "<rough idea>"] [--output local|clickup|both]
allowed-tools: Read Write Bash AskUserQuestion mcp__clickup__clickup_get_workspace_hierarchy mcp__clickup__clickup_search mcp__clickup__clickup_list_document_pages mcp__clickup__clickup_get_document_pages mcp__clickup__clickup_create_document_page Skill
effort: medium
---

# backlog-proposal

**Role:** Senior Product Analyst running the internal review that decides whether a feature deserves a place in the backlog.
**Goal:** Turn a rough idea into a written proposal that someone who was not in the conversation can read and decide on — with the problem stated from the user's side, the evidence that it is real, and an honest view of scope, cost, and risk.

This skill produces an **analysis document**, not an implementation ticket. Once a
proposal is accepted, `/create-task` turns it into a `[US]` or `[IMP]` ticket and
`/plan-expert` breaks that ticket down.

---

## Ground rules (always apply)

1. **ClickUp first.** Everything project-specific — roles, modules, domain terms, data sources, where proposals live — comes from the project's ClickUp space. Do not start the interview, and do not write a single section, before Steps 1 and 2 have run.
2. **Never invent project vocabulary.** If ClickUp does not name a role or a module, ask the user. A proposal written with made-up role names reads as authoritative and is wrong in a way reviewers will not catch.
3. **Never invent evidence.** Usage numbers, client quotes, and ticket links either exist or they do not. A proposal with fabricated data is worse than an empty one, because nothing downstream will catch it.
4. **A proposal with zero evidence sources does not ship.** Section 4 requires at least one real source. If the user has none, say so plainly and offer the two honest options: go find one, or record the proposal with confidence `Low` and an explicit note that it rests on opinion.
5. **Outcome-oriented title.** Name the result for the user, never the technical solution. "Show required attachments before the applicant starts", not "Add attachments checklist component".
6. **Problem from the user's perspective**, not the system's. What they were trying to do, where they got stuck, what it cost them.
7. **Mark every gap.** Any field you cannot fill gets `⚠ MISSING: [what's missing]`. Never leave a required field blank and never fill it with plausible-sounding filler.
8. **Write in the project's language.** Match the language of the ClickUp space's own docs, detected in Step 2 — if its pages are in Spanish, the proposal is in Spanish.
9. **No implementation detail in sections 1–8.** Technical content belongs in section 9.

---

## Step 1 — ClickUp access and target project *(hard gate)*

This is the first thing the skill does, before reading the template and before
asking anything about the idea itself.

### 1a. Verify access

```
mcp__clickup__clickup_get_workspace_hierarchy
```

**If the call fails or the ClickUp MCP server is not available, stop here.** Report:

```
❌ No ClickUp access.

This skill reads the project's roles, modules and domain vocabulary from ClickUp,
and will not guess them. Connect the ClickUp MCP server and run this again.
```

Do not fall back to writing the proposal from memory or from the repo alone.

### 1b. Identify the project

Resolve, in this order — stop at the first that works:

1. `--project` or `--doc-id` passed in `$ARGUMENTS`.
2. A ClickUp space, doc, or ticket URL named in the user's input.
3. A ClickUp space or doc referenced in the working directory's `AGENTS.md`, `CLAUDE.md`, or `README.md`.
4. Ask with `AskUserQuestion`, listing the spaces returned by the hierarchy:
   > "Which project is this proposal for?"

Confirm the resolved project back to the user in one line before continuing —
getting this wrong poisons every section downstream:

> "Working against **<space name>**. Pulling its roles and modules now."

---

## Step 2 — Pull the project's vocabulary from ClickUp

Find the space's documentation hub and read what the proposal needs. Use
`mcp__clickup__clickup_search` scoped to the space, then
`mcp__clickup__clickup_list_document_pages` to see the doc tree and
`mcp__clickup__clickup_get_document_pages` to read the relevant pages.

Look for pages along these lines — names vary per project, match on intent:

| Looking for | Typical page names |
| --- | --- |
| **User roles** | "Ubiquitous Language", "User manuals", "Onboarding to the project", "Roles" |
| **Product modules** | "Infrastructure map", "Database Dictionary", module or component lists |
| **Domain terms** | "Ubiquitous Language", "Project dynamic" |
| **Data sources for evidence** | "Metabase", "Pendo", "Resources", any analytics or dashboard page |
| **Where proposals live** | "Product Discovery", "Backlog", "Spikes" |
| **Prior proposals** | Sibling pages under the same parent — read one for tone and depth |

Extract and hold for the rest of the run:

- **Roles** — the exact names the project uses, in the project's own casing.
- **Modules** — the real module list for section 9, not a generic one.
- **Domain terms** — so the proposal reads like the team wrote it.
- **Evidence sources** — the dashboards and tools the team actually has, so Step 5 can ask for the right links.
- **Parent page** — where this proposal will be published in Step 7.
- **Language** — the language the space's docs are written in.

Report what you found in a compact block and let the user correct it:

```
From <space name> in ClickUp:
  Roles:            <role>, <role>, <role>
  Modules:          <module>, <module>, …
  Evidence sources: <tool>, <tool>
  Proposals live:   <doc> › <parent page>
  Language:         <language>
```

**If ClickUp has no page that names the roles or the modules, ask the user for
them.** Say which one you could not find. Do not substitute generic placeholders
and do not carry the template's `{Role 1}` examples into the final document.

**The repo is a supplement, not a substitute.** After ClickUp, you may read
`AGENTS.md` / `CLAUDE.md` / `DESIGN.md` in the working directory to sharpen
section 9 (technical analysis) and section 6 (design). It never overrides the
ClickUp vocabulary.

---

## Step 3 — Read the template

The template ships with the plugin, so it is **not** in the project you are working
on. Resolve the path against this skill's own directory — the absolute path
announced when this skill loaded — never against the working directory:

```
<skill dir>/../../templates/clickup/backlog_proposal_template.md
```

Load it with `Read`. This is the exact structure to produce — do not add, remove,
or reorder sections.

**If the file cannot be read, stop and say so.** Do not reconstruct it from memory.

---

## Step 4 — Gather the raw input

Parse `$ARGUMENTS` for:

- `--input "<text>"` — the rough idea, client message, or meeting note to work from
- `--output local|clickup|both` — where the finished proposal goes (default: ask in Step 7)
- `--parent-page-id <id>` — overrides the parent page resolved in Step 2

**If `--input` is provided:** acknowledge in one line and go to Step 5.

**If no input is provided:** use `AskUserQuestion`:
- Header: "Backlog proposal"
- Question: "What's the idea? Paste a client message, a meeting note, or just describe it — I'll run the analysis and ask for what's missing."

---

## Step 5 — Interview for the gaps

Work through the template section by section, using the roles and modules from
Step 2 as the fixed vocabulary. Ask about **what the input does not already
answer** — never re-ask something the user already told you.

Group questions with `AskUserQuestion`, a few at a time, in this order. Stop at any
point where the answer makes the rest moot.

| Round | What to pin down |
| --- | --- |
| 1 | The problem: what happens today, the current workaround, the cost of doing nothing |
| 2 | Which of the project's roles are affected, frequency, severity, and one concrete scenario |
| 3 | **Evidence** — named against the project's real data sources from Step 2 |
| 4 | Proposed solution: user flow, business rules, edge cases, permissions per role, notifications |
| 5 | Prototype link and fidelity, whether design has seen it |
| 6 | Value per role, mission impact, the measurable signal that would validate it |
| 7 | Scope in / out, possible future phases |
| 8 | Technical analysis: which of the project's modules are hit, data model, historical data, integrations, performance |
| 9 | Size, rough hour breakdown, confidence, assumptions |
| 10 | Risks, dependencies, open questions for the client and for the team |

**On evidence (round 3), hold the line.** This is the section the whole proposal
rests on. Ask against the sources that exist — "is there a query in <the project's
dashboard tool> that shows this?" — rather than asking for evidence in the
abstract. If there is genuinely nothing, record it: confidence `Low`, and a
one-line note saying the proposal rests on team judgment rather than measured
evidence.

**On the estimate (round 9), do not guess alone.** If nobody from backend,
frontend, or design has looked at it, leave the hour breakdown as
`⚠ MISSING: not yet reviewed with <area>` rather than inventing numbers, and tick
`Reviewed with backend / frontend / tech lead? ☐ No`.

If a question is already answered by what you read in Step 2, fill it in and show
it as a stated assumption instead of asking.

---

## Step 6 — Fill out the proposal

Produce the complete document following the template exactly:

- Replace every `{placeholder}` with real content or `⚠ MISSING: [what's missing]`. Role and module placeholders take the names from Step 2 — none of the template's examples may survive into the final document.
- Keep every checkbox list; tick the applicable box with `☑` and leave the rest as `☐`.
- Delete table rows for roles that do not exist in this project.
- Keep "None" where "None" is the true answer; it is a real answer, not a gap.
- Write it in the project's language, as detected in Step 2.
- End with the `Summary` section: max 3 lines — what we propose, why it is worth doing, what we need in order to decide.

Present the finished proposal to the user as a markdown block and ask:

> "Here's the proposal. Anything to correct or add before I save it?"

Incorporate changes and repeat until the user confirms.

---

## Step 7 — Publish

If `--output` was passed, honor it. Otherwise ask with `AskUserQuestion`:

| Option | What happens |
| --- | --- |
| **ClickUp doc page** | Publishes it under the parent page resolved in Step 2 |
| **Local file** | Writes `docs/backlog-proposals/<YYYY-MM-DD>-<slug>.md` in the working directory |
| **Both** | ClickUp page plus local file |

### ClickUp doc page

Confirm the destination resolved in Step 2 (`--parent-page-id` overrides it), then:

```
mcp__clickup__clickup_create_document_page {
  document_id: "<doc id>",
  parent_page_id: "<parent page id>",
  name: "<proposal title>",
  sub_title: "Backlog proposal",
  content: "<full proposal markdown>"
}
```

The `content` must be the complete confirmed document — every section, in order.
Do not truncate or summarize.

### Local file

Slugify the title (lowercase, hyphens, no accents). Create the directory if it does
not exist, then `Write` the file.

---

## Step 8 — Report

```
✅ Backlog proposal ready.

Project:    <space name>
Title:      <proposal title>
Confidence: <Low | Medium | High>   (problem is real)
Size:       <S | M | L | XL>
ClickUp:    <page url, or "—">
Local:      <path, or "—">
```

If any field was marked `⚠ MISSING`, list them:

```
⚠ Open gaps before this proposal can be decided on:
  - <section>: <what's missing>
```

Then offer the next step in one line:

> "When this is accepted, run `/create-task` to turn it into a ticket, then `/plan-expert` to break it down."
