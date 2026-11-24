---
name: test-case-generation
description: Generates a ClickUp Test Plan and its Test Cases for one requirement (user story, slice, task or bug) given as a ClickUp task ID or URL. Use it whenever someone shares a ClickUp task and asks for test cases, a test plan or QA coverage ("generar casos de prueba", "crear el test plan", "analiza este requerimiento y créame los TC", "necesito casos de prueba para esta tarea"), or pastes a clickup.com/t/… link and clearly wants QA test design. Always shows a validated dry-run and creates nothing without explicit approval. Not for manual test cases with no ClickUp source, API/Postman testing, or Playwright automation code.
argument-hint: --ticket-id <id|url> [--us-id <id|url>] [--target <id|url>] [--dry-run]
allowed-tools: Read Bash AskUserQuestion mcp__clickup__clickup_get_task mcp__clickup__clickup_filter_tasks mcp__clickup__clickup_create_task mcp__clickup__clickup_get_operators mcp__clickup__clickup_execute_operator mcp__clickup__clickup_get_workspace_hierarchy
effort: medium
---

# test-case-generation

**Role:** QA analyst who designs test cases straight from the requirement.
**Goal:** Turn one ClickUp task into a Test Plan with numbered, reproducible Test Cases that cover every acceptance criterion, and create them in ClickUp only after the user has seen and approved a dry-run.

ClickUp structure this skill writes into (three task types, each a subtask of the one above):

| Level | Task type | Holds |
| --- | --- | --- |
| Root | `Test Scenario` | the user story: `Source requirement: [<US title>](<url>)` and its slices |
| Subtask | `Test Plan` | the task you were given (one plan per task) |
| Sub-subtask | `Test Case` | one `TCNN - <Area> - Verify …` per case |

---

## Ground rules (always apply)

1. **A ClickUp task is required.** No `--ticket-id` (or a ClickUp link in the request) → ask for one. No free-text input, ever.
2. **Test the task you were given.** The TCs cover the task passed in `--ticket-id`. The user story is context only: never write TCs for parts of the story the task does not touch.
3. **Always a user story.** If the task is not a user story, ask for its user story before writing anything (Step 2).
4. **The format is fixed, in English.** Every preview must pass `check-test-cases.mjs` before it is shown. The fixed parts (`Verify`, section headings, `Source`, `User story`) stay in English on purpose, so plans read the same in every project; free text inside the TCs follows the task's language.
5. **Dry-run before every write.** Nothing is created until the user has seen the dry-run (Step 7) and said yes. `--dry-run` stops after it.
6. **Evidence, not guesses.** Every TC traces to an acceptance criterion, a described behaviour or an attached design of the task. Strings, labels, URLs and values are copied character for character. What the task leaves unclear goes into "Open questions" in chat, never into a TC.
7. **Never edit or delete existing tasks.** This skill only creates.

---

## Step 1 — Validate the inputs (hard gate)

Parse `$ARGUMENTS`: `--ticket-id <id|url>` (required), `--us-id <id|url>`, `--target <id|url>`, `--dry-run`. When the skill was triggered by a message instead of a command, take the ClickUp link or id from that message as `--ticket-id`.

Validate and normalize `--ticket-id` and `--us-id` (a `--target` is resolved in Step 6, like a pasted destination):

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/test-case-generation/scripts/check-test-cases.mjs" --ticket "<value>"
```

`PASS <id>` → use `<id>`. `FAIL` → show the reason and ask for a valid ClickUp task id or `https://app.clickup.com/t/…` link. A digits-only id fails on purpose: in ClickUp that is a list, and this skill needs a task. Never guess an id.

---

## Step 2 — Fetch the task and its user story

```
mcp__clickup__clickup_get_task {
  task_id: "<ticket-id>",
  include: ["description", "custom_fields", "attachments", "subtasks"]
}
```

`attachments` returns the attached designs Step 4 reads (metadata only). If the call fails, say the task could not be read — the id may be wrong, or the ClickUp MCP is not connected or authenticated (`/mcp`) — and stop.

The task is a **user story** when its title starts with `[US]` or its task type is "User Story". Then it is both the task under test and its own context; go to Step 3.

Otherwise (skip when `--us-id` was given) ask in plain chat — not with `AskUserQuestion`, whose picker has no text field — so the user can paste the link in the same reply. End your turn with exactly:

> "[<task title>](<task url>) is not a user story. Paste the link (or id) of its user story to continue, or reply **no user story**."

Validate the reply as in Step 1 and fetch it with `clickup_get_task` (`include: ["description", "attachments", "subtasks"]`). A reply with no valid id → ask the same question again. Never continue without the user story, and never pick one yourself (not even the task's parent). On "no user story", stop:

> "Test cases need the user story for context. Create it with `/create-task --type US`, then run `/test-case-generation` again."

---

## Step 3 — Check the QA task types (hard gate)

Find the workspace id (the number in a `/t/<workspace>/<id>` link, or `mcp__clickup__clickup_get_workspace_hierarchy`). There is no dedicated tool for task types; the ClickUp MCP exposes them through its operator catalog, and it requires `mcp__clickup__clickup_get_operators` (`model_operators: ["task_type.list"]`) once before the first `clickup_execute_operator` call. Its result is only that discovery; then:

```
mcp__clickup__clickup_execute_operator {
  model: "task_type", operator: "list",
  parameters: { workspace_id: <id> },
  query: "task_types[*].name"
}
```

All three of `Test Scenario`, `Test Plan` and `Test Case` must exist (match names case-insensitively, use the exact stored name when creating). If any is missing, stop:

> "This workspace has no `<missing types>` task type. Create them in ClickUp (Settings → Task Types), then run `/test-case-generation` again."

---

## Step 4 — Analyse the task

Read, from the task first and the story second:

- acceptance criteria, described behaviour, business rules and validations
- states shown in attached designs (empty, loading, error, populated, disabled, read-only, desktop, tablet, mobile)
- roles and permissions, data limits, formats and boundaries
- what must keep working (regressions the task could cause)

Build a coverage list: every acceptance criterion of the task → at least one TC. Add negative, boundary and regression cases when the task implies them. Skip criteria that belong only to the story and not to this task.

**Area** is where the case runs, as the product names it (a page, module, app or tool such as `Storybook`, `Admin`, `Checkout`). Keep one name per surface across the plan.

---

## Step 5 — Render and validate the preview

Render exactly this shape (nothing before the heading):

```
## Test Plan: <plan name>

Source <requirement|story|slice|task|bug>: [<task title>](https://app.clickup.com/t/<task id>)
User story: [<story title>](https://app.clickup.com/t/<story id>)

### TC01 - <Area> - Verify <observable behaviour>

#### Preconditions

- <state, data or access needed before step 1>

#### Steps

1. <one action>
2. Observe: <what to look at>

#### Expected Result

<the observable outcome that passes the case>
```

- `<plan name>` is the task title until the destination is known; Step 6 renames it to the project's convention.
- `Source` uses `slice` for a `[SLICE…]` task, `bug` for `[BUG]`, `story` when the task is the user story, `task` otherwise.
- One behaviour per TC. Titles start with `Verify` and name the observable outcome.
- Steps are single actions, numbered from 1, with concrete values in backticks. Use `Observe: …` steps to point at what the expected result checks.
- The expected result is observable and unambiguous — never "works correctly".
- TCs are numbered `TC01`, `TC02`, … (or from the next free number, Step 6).

Validate before showing:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/test-case-generation/scripts/check-test-cases.mjs" --start <n> - <<'PREVIEW'
<rendered preview>
PREVIEW
```

`PASS` → keep it; it is shown in Step 7. `FAIL` → fix every listed difference and check again. Never show a preview that has not passed. If `node` is unavailable, check the shape by hand and say so.

Do not ask for confirmation here: the user confirms everything once, in Step 7.

---

## Step 6 — Ask where to create them

Skip the question when `--target` was given. Otherwise ask in plain chat, for the same reason as Step 2, and end your turn with exactly:

> "Where should I create the Test Plan? Paste the link (or id) of an existing **Test Scenario**, an existing **Test Plan** (to add the cases to it), or a **ClickUp list**."

Work out what the reply (or `--target`) is, in this order:

- a task link (`…/t/…`), or an id with at least one letter → validate it as in Step 1, fetch it with `clickup_get_task`, and use its task type
- anything else, including a digits-only id (list ids are all digits) → check it as a list (`…/v/li/<id>`, a list view `…/v/l/6-<id>-1`, or the id):

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/skills/test-case-generation/scripts/check-test-cases.mjs" --list "<reply>"
  ```

  `PASS <list id>` → **list** `<list id>`. `FAIL` → ask the same question again.

Resolve the destination:

- **Test Scenario** → the new Test Plan is its subtask.
- **List** → `mcp__clickup__clickup_filter_tasks` with `list_ids: [<list>]`, `subtasks: false`, `include_closed: true` (read every page) returns the root tasks, without description or task type. Shortlist the ones whose name shares the story's key words (scenarios are often a shortened feature name, e.g. `Tables New Filter` for the story `Tables – New filter UX across all platform tables`), then confirm each with `clickup_get_task` (`include: ["description"]`): it is the scenario when its task type is `Test Scenario` and its description links the story id. Found → use it. Not found → propose creating `Test Scenario` `<story title>` with the description below, and include it in the dry-run.
- **Test Plan** → no new plan; the TCs become its subtasks. Fetch it with `include: ["subtasks"]`, then for its existing `TCNN` subtasks:
  - drop generated TCs that cover the same behaviour as an existing one (list them as "Already covered")
  - renumber the rest from the next free number and re-run Step 5's check with `--start <next>`

**New Test Scenario description.** Two paragraphs; the second only when the story has subtasks whose name starts with `[SLICE` (from Step 2's `subtasks`):

```
Source requirement: [<story title>](https://app.clickup.com/t/<story id>)

Vertical slices: [Slice 1](https://app.clickup.com/t/<id>), [Slice 2](https://app.clickup.com/t/<id>), …
```

List every slice of the story, not only the task under test, ordered by the number in `[SLICE <n>/<N>]`, labelled `Slice <n>`, separated by `, ` and ending with `.`. An existing Test Scenario is never edited, even when its slice list is out of date.

Any other task type, or a reply that is none of these → say what it is and ask the same question again.

**Name the new Test Plan the way this project already does.** Projects name plans differently (by story and slice, by feature, by sprint, or by the raw task title), so never assume one. Read the names of up to 5 existing `Test Plan` tasks: the destination scenario's subtasks first, then those of other scenarios in the same list (`clickup_get_task` with `include: ["subtasks"]` on 1–2 scenarios). Infer the pattern and apply it to this task, for example `<story title> - Slice <n>: <short summary>` when the existing plans look like `Date Picker & Date Range - Slice 1: Single Date Picker in Storybook`. No existing plans or no clear pattern → keep the task title. Update the `## Test Plan:` line, re-run Step 5's check, and state in the dry-run which convention you followed and which plan it came from.

---

## Step 7 — Preview and confirm (always a dry-run first)

Get the exact payloads from the validated preview:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/test-case-generation/scripts/check-test-cases.mjs" --start <n> --json - <<'PREVIEW'
<validated preview>
PREVIEW
```

**Show everything in your own message text.** The user never sees tool output (a `cat`, a script's stdout, a file you wrote), so anything shown only there was not shown. Show, in order, without creating anything:

1. **Inputs:** task and user story as links, destination (list › Test Scenario, or "new Test Scenario: <name>"), Test Plan ("new: <plan name>" or its link), and naming ("follows <existing plan link>" or "task title (no existing plans)").
2. **Coverage:** a table `Acceptance criterion | TCs`, every criterion of the task in a row; criteria that cannot be tested say why.
3. **Ledger:** a table `# | Task type | Name | Parent`, one row per task that would be created, in creation order (new Test Scenario, new Test Plan, then each TC).
4. **Every TC in full,** exactly as validated (`### TCNN …` with Preconditions, Steps and Expected Result).
5. **Already covered** (TCs dropped in Step 6, or "none") and **Open questions**.

Head it `## Dry-run — nothing has been created`.

**`--dry-run`:** stop after the preview. Also print, for each task, the exact `clickup_create_task` call that would be sent. Nothing is written.

Otherwise ask with `AskUserQuestion`:

- Question: "Create these <N> tasks in ClickUp?"
- "Create them in ClickUp (Recommended)"
- "Change a TC first" — ask what to change, apply it, re-run Step 5's check, and show this preview again
- "Cancel" — create nothing

Anything but an explicit "Create them" creates nothing.

---

## Step 8 — Create (only after yes)

In this order, each with `mcp__clickup__clickup_create_task` in the destination's `list_id`:

`task_type` takes the task type **name** (the ClickUp MCP resolves it, and fails if the type does not exist); do not switch it to the REST API's numeric `custom_item_id`.

1. New Test Scenario (if any): `task_type: "Test Scenario"`, `markdown_description` as in "New Test Scenario description" (Step 6).
2. New Test Plan (if any): `task_type: "Test Plan"`, `parent: <scenario id>`, `name` and `markdown_description` from the JSON `plan`.
3. Each Test Case, in order: `task_type: "Test Case"`, `parent: <plan id>`, `name` and `markdown_description` from the JSON `cases`, copied exactly.

If a call fails, stop, report what was created (with links) and what was not. Never retry blindly — retrying can duplicate tasks.

---

## Step 9 — Report

```
## Test Plan created

Task:       [<task title>](https://app.clickup.com/t/<id>)
User story: [<story title>](https://app.clickup.com/t/<id>)
Test Plan:  [<plan name>](<url>)
Test Cases: <N> created (TCxx–TCyy) · <M> already covered
Coverage:   <K>/<total> acceptance criteria
```

Write every ClickUp task as a markdown link with its name as the text.
