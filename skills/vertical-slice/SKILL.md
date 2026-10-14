---
name: vertical-slice
description: Developer-only. Splits one complete ClickUp user story ([US]) into thin vertical slices, numbered in implementation order. Each is independently deployable (≤2 working days, ≤24 files), sized against the repo's merged-PR history and the list's ClickUp time-in-status. After confirmation it creates them as subtasks on the story. Rejects anything that is not a complete user story.
argument-hint: --ticket-id <id> [--window-days <n>] [--dry-run]
disable-model-invocation: true
---

# vertical-slice

**Role:** Senior engineer who cuts user stories into thin, deployable slices before anyone writes code.
**Goal:** Turn one complete ClickUp user story into the fewest slices that each ship observable behaviour on their own, in under 2 working days, and hand each one over as a ClickUp subtask that a developer or an agent can pick up without a meeting.

A slice is a thin path through every layer a user or consumer needs, never a layer on its
own. **Done means deployable**, even when a feature flag still hides it.

This skill follows [MinimumCD](https://minimumcd.org/): small batches, a trunk that can always
be released, and deploying kept separate from releasing.

---

## Ground rules (always apply)

1. **Developers only.** Only engineers, developers, tech leads and CTOs run this skill (Step 0).
2. **One complete user story in, nothing else.** The input is a ClickUp `[US]` ticket fetched through the ClickUp MCP. Free text, bugs, tasks and incomplete stories are not sliced without the developer's explicit say-so (Step 1).
3. **The 2-day limit never changes.** A slice is at most 2 working days of active work and at most 24 changed files. Up to 45 files is allowed only for shallow changes (renames, moves, call-site updates) with a one-line reason, and for no more than 1 in 10 slices. The baseline (Step 4) can only tighten these limits, never loosen them.
4. **The template is the output.** Every slice is rendered from `${CLAUDE_PLUGIN_ROOT}/templates/clickup/vertical_slice_template.md`, read fresh on every run, and must pass `check-slice.mjs` before anything is written. Never rebuild the template from memory. If the file can't be read, stop.
5. **Evidence, not guesses.** Every file, symbol and operation named in a slice comes from code you have read, cited as `path :: symbol (line)`. Unknowns go into a "Grounding gaps" list in chat, never into a slice. If a read looks cut off, read it again before naming anything from it.
6. **Exact wording.** Copy strings, enum values, URLs and acceptance-criteria wording from the story are reproduced character for character.
7. **Ledger and Inventory against drift.** The Requirement Inventory (Step 5) and the Slice Ledger (Step 6) are the source of truth for the whole conversation. After any detour (a question, a bug, a deeper look at one slice), fold the outcome into that slice, reprint both tables and name the next pending slice.
8. **No code.** This skill writes no source code and creates no files in the project. Implementation happens later, from each slice's technical prompt.
9. **Developer names stay in chat.** Names from the delivery baseline guide ordering in chat only. Never copy them into ClickUp.

---

## Step 0 — Role gate

Ask with `AskUserQuestion`:

- Question: "This skill is for engineering roles only. What is your role on this project?"
- Options: "Engineer / developer", "Tech lead", "CTO", "Other (product, project management, design, QA, …)"

If the answer is anything other than engineer, developer, tech lead or CTO, stop:

> "`/vertical-slice` is for developers only. To capture or refine the story itself, use `/create-task --type US`; to analyse an idea before it becomes a story, use `/backlog-proposal`."

This gate is advisory: Claude Code has no identity or role permissions. It works together with
`disable-model-invocation: true`, which means the skill only runs when someone types
`/vertical-slice`. The router, `orchestrate` and other agents cannot start it.

---

## Step 1 — Fetch and validate the story (hard gate)

Parse `$ARGUMENTS` for `--ticket-id <id>`, `--window-days <n>` (default 180) and `--dry-run`.
No `--ticket-id` → stop and ask for one. There is no free-text input.

Fetch the story:

```
mcp__clickup__clickup_get_task {
  task_id: "<ticket-id>",
  include: ["description", "subtasks", "custom_fields", "dependencies"]
}
```

If the call fails, tell the developer the ClickUp MCP is not connected or authenticated (`/mcp`) and stop.

**1a. Type check.** The task is a user story when its title starts with `[US]` or its ClickUp task type is "User Story". Anything else: propose rejecting it and redirect:

| Input     | Redirect                                                    |
| --------- | ----------------------------------------------------------- |
| `[BUG]`   | the `bug` route through `orchestrate`, or `/implement-task` |
| `[TASK]`  | `/plan-expert --ticket-id <id>`                             |
| `[SPIKE]` | resolve the spike first; slice the story it unblocks        |
| `[IMP]`   | rewrite it as a story with `/create-task --type US`         |
| No type   | rewrite it as a story with `/create-task --type US`         |

Only continue if the developer explicitly overrides, and list the override in the final report.

**1b. Completeness check** against `${CLAUDE_PLUGIN_ROOT}/templates/clickup/us_task_template.md`:

- the user-story line names an actor, an action and a benefit
- there is a description of the problem or need
- there is at least one testable acceptance criterion
- there is a Definition of Done
- dependencies are stated (or "None")
- no `⚠ MISSING` markers remain
- the task is not closed

If anything is missing, list the gaps and ask with `AskUserQuestion`:

- "Reject and fix the story with `/create-task` first (Recommended)"
- "Continue anyway — every slice will carry an accuracy warning"

When the developer continues, add this as the first acceptance-criteria line of every slice, and
list it in the report:
`- **Given** this slice was cut from an incomplete story (<gaps>) **When** it is refined **Then** its criteria are re-checked before work starts`

**1c. Existing slices.** Collect the story's subtasks whose name starts with `[SLICE`. For each,
fetch it with `clickup_get_task` (include `description`) and note its number, its `Scope` and its
`Counterpart`. With none, continue. Otherwise decide once this run's scope is known (Step 2):

- This run is single-sided and every existing slice is single-sided on the **other** side → continue. The existing slices are counterpart candidates (Step 7), and the new slices are numbered after them (Step 8).
- Anything else (an existing full-stack slice, an existing slice on the same side, or a full-stack run) → stop and show the existing slices. Re-slicing that work needs those subtasks closed or removed first.

**1d. Readiness signal** (never blocks):

```
mcp__clickup__clickup_get_task_time_in_status { task_id: "<ticket-id>" }
```

Warn in one line when the story spent a long time in a blocked or refinement status, or moved
backwards (for example from QA back to in progress). Skip silently if the "Total time in Status"
ClickApp is off.

---

## Step 2 — Scope, feature flag and the other side's code

Read the story for each answer first. Ask only what the story leaves open, once per story, with
defaults suggested from the code (Step 3 can run first to inform the defaults):

1. **Feature flag:** "Will this work ship behind a feature flag? If so, what is the flag called?" Never infer the answer silently.
2. **Scope:** "Is this work full-stack, frontend only, or backend only?"
   - Full-stack is the default: one slice carries the whole flow.
   - Frontend only or backend only is right when the work genuinely touches one side, or when the developer chooses it (for example, a UI-only update first, or a team that owns one side).
   - If the developer picks one side but this repository clearly contains both, ask once more with a one-line note. Don't block.

Every slice inherits these answers. The developer can change any single slice in the preview (Step 9).

If Step 1c found existing slices, apply its rule now that the scope is known.

**The other side's code is never guessed.** Whenever a slice needs code that is not in the
current working directory (the backend for a frontend slice, the frontend for a backend slice,
or a full-stack story spread over two repositories), ask for the **full absolute path** unless
the developer already gave it. Check the path exists and contains code before reading it. Read
it; never change it. Reading outside the working directory may trigger a permission prompt; the
developer can run `/add-dir <path>` to allow it for the session.

---

## Step 3 — Codebase discovery (stack-agnostic)

1. Read `AGENTS.md`, `WIKI.md` and `DESIGN.md` at the project root when present. If none exist, suggest `/init-project` and continue from the manifests and the code.
2. **Domain boundary.** Decide what "end to end" means here: a product team slices to a UI the user observes; a service team slices to an API contract its consumers observe. State which applies.
3. **Feature-flag mechanism.** Find how the project gates unreleased behaviour (config, a flag service, environment switches) and how code reads a flag. Record "none found" if there is none.
4. **Contracts.** For every touchpoint in the story, find the existing operation, endpoint, event or schema it would use or extend, in both repositories when there are two.
5. **Design inputs.** Treat links, screenshots and documents attached to the story as part of the spec. List every state they show (empty, loading, error, populated, read-only, desktop, mobile).
6. **Validation commands.** Note the project's own lint, type-check and test commands for the technical prompt.

---

## Step 4 — Sizing baseline (never blocks slicing)

Two sources, both read-only. Say in one line which ones you used.

**4a. ClickUp time-in-status.** From the story's task, take its folder ID (or its list ID when it has no folder). Fetch tasks closed inside the window:

```
mcp__clickup__clickup_filter_tasks {
  folder_ids: ["<folder id>"],      // or list_ids: ["<list id>"]
  include_closed: true,
  date_closed_from: "<today minus window, YYYY-MM-DD>",
  subtasks: true,
  order_by: "updated"
}
```

Follow `has_more` / `next_page` until done, keep tasks that have a closed date, and take the 50
most recently closed. Fetch their history in one call:

```
mcp__clickup__clickup_get_bulk_tasks_time_in_status { task_ids: ["<id>", …] }
```

Map every status name in the response to one of **Backlog, Active, Review, QA, Done**. Propose the
mapping from the names, then confirm it once with `AskUserQuestion`. Never guess silently:
ClickUp's own status types don't match these categories (it can mark "ready for qa" as done).

If the ClickApp is off or fewer than 5 tasks come back, skip 4a and say so in one line.

**4b. Run the baseline script** from the project root. Pass the time-in-status response exactly
as returned, and add `--repo-dir` once per repository involved:

```bash
STATUS_MAP=$(cat <<'MAP'
<confirmed mapping as JSON, e.g. {"to do's": "Backlog", "in progress": "Active"}>
MAP
)
node "${CLAUDE_PLUGIN_ROOT}/skills/vertical-slice/scripts/slice-baseline.mjs" \
  --window-days <n> --repo-dir "<repo path>" \
  --status-map "$STATUS_MAP" --time-in-status - <<'JSON'
<bulk time-in-status response>
JSON
```

Always pass the mapping through the `MAP` heredoc as shown: status names can contain quotes or
apostrophes (`to do's`), which break an inline quoted argument. Without time-in-status data, leave
out `STATUS_MAP`, `--status-map` and `--time-in-status`. If `node` is not
available, say so in one line and use the default limits.

**Reading the output:**

- The delivery table (merged PRs, or git merge commits when `gh` is unavailable) shows how big and how fast past changes were, per change type. Use the story's change type row (usually `feat`) to judge confidence and to spot a team whose typical change is already over the limits. A team whose typical PR is 40 files still slices to ≤24.
- The open-at-once table checks the 1 + 2 rule (Step 6). It stays in chat.
- The time-in-status table gives the **typical review + QA wait**. Each slice's expected lead time is 2 working days plus that wait.
- When waiting time is larger than working time, prefer fewer slices in the merge pass: every extra slice waits in the review and QA queue again.
- A "No … baseline" line means use the defaults: ≤2 working days, ≤24 files, at most 3 open per developer.

---

## Step 5 — Requirement Inventory

Build it before slicing and reprint it with the Ledger after every detour:

| #   | Requirement | Exact wording | Source (story line / design state) | Covered by slice(s) |
| --- | ----------- | ------------- | ---------------------------------- | ------------------- |

Every acceptance criterion, copy string, enum value, URL, rule and design state in the story
becomes one row. No slicing starts until the inventory is complete.

---

## Step 6 — Slicing engine

**Deployability test** for every candidate slice. Any "no" means it is a layer, not a slice — reslice:

1. Can a user or consumer **observe** new behaviour once it ships (even behind a flag)?
2. Can the team **deploy it without waiting** on another team or slice?
3. Does it deliver **behaviour**, not a layer?

**Find boundaries with Given–When–Then.** Each scenario is a candidate slice with its acceptance criteria built in.

**Slicing strategies** — pick the smallest valuable cut:

| Strategy         | Cut by             | Example                                               |
| ---------------- | ------------------ | ----------------------------------------------------- |
| Workflow step    | one step of a flow | "add to cart" before "checkout"                       |
| Business rule    | one rule           | ">$100 free shipping" before "international shipping" |
| Data variation   | one data type      | "credit card" before "PayPal"                         |
| Operation        | one operation      | "create" before "edit" and "delete"                   |
| Happy path first | the success case   | "completes checkout" before "payment fails"           |
| Platform         | one platform       | "desktop web" before "mobile"                         |
| Performance      | works first        | "returns results" before "under 200 ms"               |

**Design-driven boundaries.** The populated view is the happy path; empty, loading and error
states follow immediately after it (as part of the same slice when the story is already small);
desktop vs mobile is a platform cut; data variants are data-variation cuts.

**Rules:**

- **A story that is already small is one slice.** INVEST-screen the story (Independent, Negotiable, Valuable, Estimable, Small, Testable). If it passes Small (≤2 days, ≤24 files), its scenarios and states become acceptance criteria inside one slice.
- **Slice-count check.** Estimate the story's total changed files. Expect about (total ÷ 24, rounded up) slices. Up to double is fine; more needs a one-line reason in the Ledger. A 28-file story is 2 slices, never 7.
- **Merge pass**, after slicing and before rendering. Merge two slices when all hold: together they still fit one slice; they share a flag (or neither needs one) and mostly touch the same files; neither is worth deploying without the other. Log each merge in the Ledger.
- **Open work: 1 + 2.** A developer actively works on one slice and holds at most two more open (in review, waiting, blocked). Order the slices so nobody needs more than 3 open at once; merge instead of queueing more.
- **Implementation order.** Number slices in the order they should be built. A slice may depend only on lower-numbered slices.
- **Sizing assumes one pull request per slice.**
- **Contracts grow in small steps.** Add only the fields a slice needs, backward-compatible, so each side can deploy on its own.
- **Error handling is not deferred.** Key edge and error cases go in the slice that ships the happy path, or the one right after it.
- **Acceptance criteria always cover**, where they apply: the flag-off behaviour (unchanged), read-only and role-based views, and records saved in the old shape before this change.

**Slice Ledger** — keep it for the whole conversation and reprint it at every checkpoint:

| #   | Slice | Scope | Files (est.) | Flag | Counterpart | Status (queued / rendered / created) | Notes (merges, reasons) |
| --- | ----- | ----- | ------------ | ---- | ----------- | ------------------------------------ | ----------------------- |

---

## Step 7 — Counterparts and contract points

**Counterparts** (single-sided slices only). Read the story's subtasks from Step 1:

- Existing slices from Step 1c start with `[SLICE` and carry a `Scope` field — pair each new slice with the other-side slice(s) covering the same behaviour.
- Hand-made subtasks are matched by title and description.
- Confirm every pairing with the developer before using it.

Set the slice's `Counterpart` to exactly one of:

| Value                                                              | Meaning                                                   | QA-ready line                                           |
| ------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------- |
| `<ID> — <title>`                                                   | half of full-stack work; the other half exists            | `only when counterpart <ID> is complete`                |
| `⚠ none found`                                                     | half of full-stack work; the other half doesn't exist yet | `only when counterpart still to be created is complete` |
| `Not needed: no backend change` / `Not needed: no frontend change` | genuinely one-sided work                                  | `this slice alone`                                      |
| `N/A: full-stack`                                                  | both sides are in this slice                              | `this slice alone`                                      |

**Earlier slices that go out of date.** Creating new slices changes existing slices from Step 1c in
two ways. Prepare the exact line changes now, show them in Step 9 and apply them in Step 10:

- **Every existing slice:** the total `N` grows, so its title `[SLICE n/N]`, its `Slice:` line and its technical prompt's first line get the new total.
- **An existing slice paired with a new one whose `Counterpart` is `⚠ none found`:**
  - `Counterpart:` → `<new slice ID> — <new slice title>`
  - `QA-ready:` → `only when counterpart <new slice ID> is complete`
  - each `Confirms: … (⚠ none found)` under Unconfirmed contract points → `Confirms: … (<new slice ID>)`

An existing slice that says `Not needed: no … change` but now has a counterpart contradicts the new
run: ask the developer which is right before changing anything.

**A single-sided slice describes only its own side.** Read the other side's code (Step 2) to work
out what this slice needs — field names, payload shapes, validation, existing screens — but put
nothing about stubs, mocks or the other side's implementation into the slice. Its Technical details
keep only its own block (`### Frontend` or `### Backend`); its contract lists only the operations it
uses or provides.

**Unconfirmed contract points.** When a single-sided slice relies on a contract detail the other side
has not confirmed (a field name, a value format, an enum value), list it as `A1`, `A2`, … under
"Unconfirmed contract points", each with the side that must confirm it. Add a matching `Pending` line
for every point under "Contract confirmations". When the developer names the person who confirms,
write `@<name>` in the Confirmer line; otherwise write `Tag the confirming developer here`. Full-stack
slices, and slices whose contract is already confirmed in code, have `None` and
`N/A: no unconfirmed points`.

How the loop runs after creation (explained to the team in the skill's README):

1. The implementing developer marks each point in code as `ASSUMPTION(A1)`, kept in one constant or helper.
2. The confirming developer edits the point's line under "Contract confirmations": `Confirmed as assumed` or `Corrected: <actual value>`, with their name and date.
3. The implementing developer updates the constant, removes the marker, updates any acceptance criteria the correction changes, and sets `Aligned in code: Yes`.
4. The slice is QA-ready only when every point is confirmed or corrected, aligned, and no `ASSUMPTION(` markers remain.

---

## Step 8 — Render and check every slice

For each slice, fill the template top to bottom:

- **Title:** `# [SLICE <n>/<N>] <imperative title naming the user-facing flow>`. In ClickUp the task name is this line without the leading `# `.
- **Numbering with existing slices:** with E existing slices (Step 1c) and K new ones, the new slices are numbered E+1 … E+K, and N is E+K.
- Keep every heading, label and fixed line exactly as in the template, in the same order.
- Replace each `{…}` placeholder with one of its listed options, or with content where it describes content. Never leave a placeholder.
- A field that doesn't apply gets its `N/A` / `None` option. Never drop a field.
- **Technical details:** keep both `### Frontend` and `### Backend` for a full-stack slice; keep only the slice's own block for a single-sided slice.
- **Estimate** is always filled by you from the baseline: `Active days` stays the fixed hard limit; `Expected lead time` is 2 plus the typical review + QA wait (or 2 when there is no time-in-status data); `Baseline` names the source and sample size, or `defaults: <reason>`.
- **Technical prompt:** a complete, self-contained instruction someone can paste into a planning skill or straight into an agent. Fill every line from the evidence you gathered: exact target files, the existing components, modules or services to reuse, the tests that prove each criterion, and the project's own validation commands. Keep only the `Frontend:` or `Backend:` lines that match the slice's scope.

Check each rendered slice before showing it to anyone:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/vertical-slice/scripts/check-slice.mjs" \
  --template "${CLAUDE_PLUGIN_ROOT}/templates/clickup/vertical_slice_template.md" \
  --n <n> --total <N> - <<'SLICE'
<rendered slice>
SLICE
```

`PASS` → continue. `FAIL` → fix every listed difference, re-render and re-check. Never show or create
a slice that has not passed. If `node` is unavailable, check the structure by hand against the
template, say so in the report, and do not create anything in ClickUp without the developer's
explicit go-ahead.

---

## Step 9 — Preview and confirm

Show, in order:

1. The baseline summary (one or two lines) and the confirmed scope and flag answers.
2. The Requirement Inventory with every row covered.
3. The Slice Ledger.
4. Every rendered slice in full.
5. The line changes for every earlier slice (Step 7), slice by slice. New slice IDs appear as `<ID of SLICE n>` until they exist.

Then ask with `AskUserQuestion`:

- "Create these slices as subtasks on <story ID> (Recommended)"
- "Change a slice first" — apply the change, re-render, re-check, preview again
- "Keep them local" — create local tasks with `TaskCreate` instead, one per slice, in order

When there are earlier slices to change, also ask: "Update the earlier slices as shown
(Recommended)" or "Leave them — list the edits for me to make by hand".

**`--dry-run`:** stop after the preview. Also print, for each slice, the exact `clickup_create_task`,
`clickup_add_task_link` and `clickup_update_task` calls that would be sent. Nothing is written — not to ClickUp, not to
local tasks.

---

## Step 10 — Create the subtasks

Create the slices in order, 1 → N, so they list top to bottom in implementation order:

```
mcp__clickup__clickup_create_task {
  list_id: "<the story's list id>",
  parent: "<ticket-id>",
  name: "[SLICE <n>/<N>] <title>",
  markdown_description: "<the rendered slice from '## Slice' to the end of the technical prompt>"
}
```

After creating each one:

1. For a found counterpart, link the two tasks (non-blocking: either side can ship first behind a flag):
   ```
   mcp__clickup__clickup_add_task_link { task_id: "<new slice id>", links_to: "<counterpart id>" }
   ```
2. Read the task back with `clickup_get_task`. Its plain-text content must not contain the literal text `## Definition of Done` or `**Scope:**`. Both come only from the template, never from code blocks, so finding either means the markdown was not rendered. If it does, report that the slice's formatting did not render and stop creating further slices.

**Then update the earlier slices**, only if the developer chose to in Step 9. For each one:

1. Fetch it again with `clickup_get_task` (include `description`), so edits people made since Step 1 are kept.
2. Change only the confirmed lines, filling in the new slice IDs.
3. Put `# <new task name>` on top and run `check-slice.mjs` on the result with its `--n` and the new `--total`. On `FAIL`, don't write it: list its edits in the report instead.
4. Write it back:
   ```
   mcp__clickup__clickup_update_task {
     task_id: "<earlier slice id>",
     name: "[SLICE <n>/<new N>] <title>",
     markdown_description: "<updated description, from '## Slice' to the end>"
   }
   ```

Never create or change a slice the developer has not confirmed in Step 9.

---

## Step 11 — Report

```
## Slices created for <story ID>

✅ [SLICE 1/N] <title> — <url>
✅ [SLICE 2/N] <title> — <url>

Baseline: <source and sample, or defaults>
Missing counterparts: <slice → the side still to be created, or "none">
Earlier slices updated: <IDs, or "none">
Edits still to make by hand: <slice → exact line changes, or "none">
Contract points awaiting confirmation: <slice: A1, A2 → confirmer, or "none">
QA rule: a slice that is half of full-stack work goes to QA only when its counterpart is complete.

Next, per slice:
- /plan-expert --ticket-id <slice id> for a file-level breakdown, or
- /implement-task --ticket-id <slice id> to build it, or
- paste the slice's technical prompt into an agent session.
```

End with the final Slice Ledger.

---

## Common pushback

| Pushback                                                   | Response                                                                                                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Split it into a frontend slice and a backend slice."      | Only when the work is genuinely one-sided or the developer chooses it. Otherwise one slice carries the whole flow. A single-sided half is never QA-ready on its own. |
| "Build the whole schema or API first, wire the UI later."  | A layer ships no observable behaviour and its untested contract piles up risk. Slice through every layer the flow needs.                                             |
| "Ship the happy path, backlog the error cases."            | Error handling is not optional. The key edge cases go in the same slice or the very next one.                                                                        |
| "This story is fine at a week, we'll go faster."           | More than 2 days means reslice. Smaller batches are the fix, not speed.                                                                                              |
| "We can't deploy without the other team."                  | That's an undefined contract. Agree it, list the unconfirmed points, and each side deploys on its own behind the flag.                                               |
| "We drifted into a bug, let's keep going there."           | Resolve it, fold it into the slice, reprint the Ledger and Inventory, resume the queue.                                                                              |
| "Every scenario and design state should be its own slice." | More slices means more open work, not faster delivery. Run the merge pass; a small story is one slice.                                                               |
| "It's 35 files, but it's still one slice."                 | Past 24 files most changes miss 2 days. Cut at a deployable seam; only shallow changes may go wider.                                                                 |
| "They can pick up a 4th while one waits for review."       | Review or unblock the open ones first. More open work makes each one finish later.                                                                                   |

## Red flags — stop and fix

- A slice delivers a layer, not behaviour (fails the deployability test).
- A slice has 10 or more acceptance criteria, or an estimate over 2 days.
- More than double (total files ÷ 24) slices with no Ledger reason, or a small story cut into several slices.
- The slice order leaves a developer with more than 3 open slices.
- A single-sided slice that mentions stubs, mocks or the other side's implementation.
- A missing counterpart that is not in the report.
- An earlier slice still saying `⚠ none found` after its counterpart was created, with no update and no manual edit in the report.
- Contract point IDs that don't match between the two contract sections.
- A design state from the story that no slice covers.
- The Ledger or Inventory is missing or stale after a detour.
- Writing source code, or creating any file in the project.

## Final self-check (print before Step 9)

- (a) the input is a complete user story, or the developer chose to continue and every slice carries the warning
- (b) the Requirement Inventory is complete and every row is covered by a slice
- (c) every identifier in every slice is grounded with `path :: symbol`
- (d) exact wording from the story is intact
- (e) every slice passed `check-slice.mjs`
- (f) the baseline source is stated; the slice count is within the check; every merge and extra slice has a Ledger reason
- (g) every single-sided slice has a counterpart value, and the QA-ready line matches it

---

_Adapted for the Axis Human toolbox by @bronz3beard from the vertical-slice decomposer in tech-lead-stack._
