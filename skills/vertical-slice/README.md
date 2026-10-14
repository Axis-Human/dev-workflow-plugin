# vertical-slice

> Token cost: ~8300 tokens

Splits one complete ClickUp user story into thin vertical slices, numbered in the order they
should be built, and creates each slice as a subtask on the story.

Every slice:

- ships observable behaviour on its own, even when a feature flag still hides it
- takes **2 working days or less** of active work. This limit never changes.
- changes **24 files or fewer**. Up to 45 is allowed only for shallow changes such as renames and moves, with a reason.
- has the same structure every time, taken from [`templates/clickup/vertical_slice_template.md`](../../templates/clickup/vertical_slice_template.md)

**Developers only.** The skill is for engineers, developers, tech leads and CTOs. It only runs when
someone types `/vertical-slice`. The router, `orchestrate` and other agents can't start it, because
its frontmatter sets `disable-model-invocation: true`. Its first step also asks for the caller's
role and stops for anyone else. Claude Code has no real role permissions, so this gate guides
people rather than enforcing access.

---

## Usage

```bash
# Slice a user story
/vertical-slice --ticket-id 86bc7jwwm

# Use a shorter history window for the sizing baseline (default: 180 days)
/vertical-slice --ticket-id 86bc7jwwm --window-days 90

# Preview everything without writing anything
/vertical-slice --ticket-id 86bc7jwwm --dry-run
```

### What `--dry-run` does

The skill runs every step: it checks the story, reads the code, builds the baseline, cuts the
slices, renders them and checks their structure. Then it stops at the preview. It also prints
the exact ClickUp calls it _would_ send for each slice: the subtask it would create and any
counterpart link it would add.

Nothing is written: no ClickUp subtasks, no links, no local tasks. Use it to smoke-test the
skill, or to show a story's slices to the team before committing to them.

ClickUp reads still happen in a dry run (the story, its subtasks, time-in-status). Reads never
change anything in ClickUp.

---

## How it works

| Step                     | What happens                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Role gate             | Asks your role and stops for anyone who isn't an engineering role.                                                                                                                                                                                                                                                      |
| 1. Story check           | Fetches the ticket. It must be a `[US]` (or "User Story" type) and complete against [`us_task_template.md`](../../templates/clickup/us_task_template.md). Anything else gets a proposal to reject it, with a redirect. An incomplete story can be sliced only if you choose to, and every slice then carries a warning. |
| 2. Questions             | Asks once per story, only when the story doesn't say: is the work behind a feature flag, and is it full-stack, frontend only or backend only? If the other side's code isn't in your working directory, it asks for the full absolute path.                                                                             |
| 3. Discovery             | Reads `AGENTS.md`, `WIKI.md`, `DESIGN.md` and the code: the flag mechanism, existing contracts, design states and your validation commands.                                                                                                                                                                             |
| 4. Baseline              | Measures your team's real delivery history and ClickUp flow (below).                                                                                                                                                                                                                                                    |
| 5. Requirement Inventory | Turns every acceptance criterion, copy string, rule and design state into a row that some slice must cover.                                                                                                                                                                                                             |
| 6. Slicing               | Deployability test, Given–When–Then boundaries, slicing strategies, the slice-count check, a merge pass and the 1 + 2 open-work rule.                                                                                                                                                                                   |
| 7. Counterparts          | For single-sided slices, finds the other side's subtask (or reports it missing) and lists contract details that still need confirming.                                                                                                                                                                                  |
| 8. Render and check      | Fills the template and runs a structure check. A slice that doesn't match the template exactly is regenerated.                                                                                                                                                                                                          |
| 9. Preview               | Shows everything and waits for your confirmation. `--dry-run` stops here.                                                                                                                                                                                                                                               |
| 10. Create               | Creates the subtasks in order 1 → N and links counterparts. It reads each one back to check ClickUp rendered the formatting.                                                                                                                                                                                            |
| 11. Report               | Lists the created slices, missing counterparts, open contract points and next steps.                                                                                                                                                                                                                                    |

---

## The metrics

The baseline only ever **tightens** the limits or explains them. It never loosens them. A team
whose typical pull request is 40 files still slices to 24 or fewer.

### Delivery history

This comes from merged pull requests through the GitHub CLI (`gh`, signed in). Without GitHub it
falls back to git merge commits. A squash-merged repository has no usable merge commits, so it
needs `gh`. The baseline covers:

- **Working days from first commit to merge**, typical (median) and slow end (85th percentile), per change type (`feat`, `fix`, …).
- **Share finished in 2 days or less.**
- **Files changed**, typical and high, and the share over 24 and over 45. Lock files and generated output don't count.
- **Shallow vs deep:** a change under 20 lines per file is shallow (moves, renames, call-site updates).
- **Open at once:** how many changes each developer had open on each weekday, which checks the 1 + 2 rule. Developer names stay in the chat and are never written to ClickUp.

Bots and release branches are left out.

### ClickUp time-in-status

This comes from up to 50 recently closed tasks in the story's folder (or list). It needs the
"Total time in Status" ClickApp enabled in the workspace.

- **Status mapping.** You confirm once which of your statuses mean Backlog, Active, Review, QA and Done. ClickUp's own status types don't line up with these categories.
- **Time per category:** typical and slow end, in working days.
- **Flow efficiency:** active time divided by the time from work starting to done.
- **Typical review + QA wait.** Each slice shows an **expected lead time** of 2 working days plus this wait.
- When waiting outweighs working time, the merge pass prefers fewer slices, because every extra slice waits in the queue again.

If either source has fewer than 5 items, the skill says so and uses the default limits.

---

## The QA-readiness rule

A slice is either the whole flow (**full-stack**) or one side of it (**frontend only** or
**backend only**). Single-sided slices carry a `Counterpart` value:

| Counterpart               | Meaning                                                   | Can go to QA alone?                                         |
| ------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| `<ID> — <title>`          | Half of full-stack work; the other half exists            | **No.** Only once the counterpart is complete.              |
| `⚠ none found`            | Half of full-stack work; the other half doesn't exist yet | **No.** The other half must be created and completed first. |
| `Not needed: no … change` | Genuinely one-sided work                                  | Yes                                                         |
| `N/A: full-stack`         | Both sides are in this slice                              | Yes                                                         |

**A slice is QA-ready only when its full-stack work is complete**, unless the work is genuinely
frontend only or backend only. Counterparts are linked in ClickUp without a blocking dependency,
so either side can ship first behind a flag. For example, the UI can be built first while the
backend is still in progress.

A single-sided slice only ever describes its own side. The skill reads the other side's code to
get field names and payload shapes right. It never writes stubs, mocks or the other side's
implementation details into the slice.

---

## Unconfirmed contract points and confirmations

A frontend slice often has to send or read data whose exact shape the backend hasn't confirmed
yet. Examples are a field name, a time format, or the values of an enum. The reverse happens for
backend slices. Two sections in every slice handle this:

1. **Unconfirmed contract points.** The skill lists each detail the slice is assuming, as `A1`, `A2`, …, with the side that must confirm it. Its **Confirmer** line is where the confirming developer gets tagged.
2. **The implementing developer** marks each assumption in code as `ASSUMPTION(A1)` and keeps it in a single constant or helper. A correction then takes a one-line change.
3. **Contract confirmations.** The confirming developer edits the point's line: `Confirmed as assumed`, or `Corrected: <actual value>`, plus their name and the date.
4. **The implementing developer** updates the constant and removes the marker. They also update any acceptance criteria the correction changes, then set `Aligned in code: Yes`.
5. **QA-ready:** every point is confirmed or corrected and aligned, and no `ASSUMPTION(` markers remain. The slice's Definition of Done checks this.

**Tagging in ClickUp.** The skill writes a name you give it as plain `@name` text. ClickUp only
notifies someone when the mention is made in ClickUp itself. To send a notification, type `@` in
the Confirmer or Confirmed by line and pick the person.

Full-stack slices, and slices whose contract already exists in code, show `None` and
`N/A: no unconfirmed points`.

---

## Working across repositories

When a slice needs code outside your working directory, the skill asks for its full absolute
path. This covers a frontend and a backend in separate repos, or a single-sided slice whose
counterpart lives elsewhere. The skill never guesses the path. It only reads that code and never
changes it. To avoid permission prompts for that directory, run:

```
/add-dir /absolute/path/to/the/other/repo
```

---

## Requirements

- The ClickUp MCP server, connected and authenticated (`/mcp`).
- Node.js. The plugin's hooks already need it. The skill uses it for two helper scripts with no dependencies: [`slice-baseline.mjs`](scripts/slice-baseline.mjs) and [`check-slice.mjs`](scripts/check-slice.mjs).
- Optional: the GitHub CLI (`gh`), signed in, for the delivery baseline from merged pull requests.
- Optional: the ClickUp "Total time in Status" ClickApp, for the flow baseline.

---

## Can work with (optional)

Before slicing:

- `/backlog-proposal` decides whether an idea earns a story.
- `/create-task --type US` writes or fixes the story this skill needs.
- `planning-features-agent` (through `orchestrate`) runs discovery for ideas that are still vague.
- `/init-project` and `wiki-query` give the stack and domain context the skill reads.
- `/design-expert` produces the `DESIGN.md` used for design states.

After slicing, for each slice:

- `/plan-expert --ticket-id <slice>` gives a file-level breakdown.
- `quick-task.js` / `implement.js` (through `orchestrate`) or `/implement-task --ticket-id <slice>` build it. You can also paste the slice's technical prompt into any agent session.
- `/create-draft-pr` opens the pull request.
- `/code-review` and `/a11y-auditor` (for UI slices) review it.
- `playwright-test-planner` turns the slice's Given–When–Then criteria into end-to-end tests.

---

## Smoke testing a branch

Test a branch copy of the plugin without touching your installed copy or spamming ClickUp.

### 1. Validate the plugin

```bash
claude plugin validate /absolute/path/to/dev-workflow-plugin
```

Don't add `--strict`. The repository's root `CLAUDE.md` produces a warning, and `--strict` turns
warnings into failures.

### 2a. Load the branch in the CLI

```bash
claude --plugin-dir /absolute/path/to/dev-workflow-plugin
```

For that session, the branch copy replaces your installed `axis-human-ai-toolbox`. After editing
any skill file, run `/reload-plugins`.

### 2b. Load the branch in the VS Code extension

The extension has no `--plugin-dir` option. Use the `CLAUDE_CODE_PLUGIN_DIRS` environment
variable instead, which needs Claude Code 2.1.280 or later:

1. Open the Command Palette (Cmd+Shift+P / Ctrl+Shift+P) and run **Preferences: Open User Settings (JSON)**. The setting below is machine-scoped, so it must go in _User_ settings, not workspace settings.
2. Add:
   ```json
   "claudeCode.environmentVariables": [
     { "name": "CLAUDE_CODE_PLUGIN_DIRS", "value": "/absolute/path/to/dev-workflow-plugin" }
   ]
   ```
3. Run **Developer: Reload Window**, then open a new Claude Code session.
4. Type `/` in the prompt box. `vertical-slice` should appear in the list. If it doesn't, check the path and the extension version.
5. After editing skill files, run `/reload-plugins` or start a new session.
6. When you're done, remove the entry and reload the window to go back to your installed plugin. The variable applies to every Claude Code session in VS Code while it's set.

### 3. Run the cases with `--dry-run`

| Case                                               | Expected                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A complete `[US]`                                  | Slices are previewed with their payloads, and nothing is written                   |
| An incomplete `[US]`                               | The reject-or-continue choice appears. Continuing adds the warning to every slice. |
| A `[BUG]` or `[TASK]` ticket                       | A proposal to reject it, with a redirect                                           |
| No `--ticket-id`                                   | The skill stops and asks for one                                                   |
| Role answered as product or project management     | The skill stops                                                                    |
| A frontend-only slice whose backend subtask exists | `Counterpart: <ID> — <title>`, QA-ready only when that counterpart is complete     |
| A frontend-only slice with no backend subtask      | `Counterpart: ⚠ none found`, listed in the report                                  |
| "Slice this story" typed as plain text             | The skill does not start                                                           |

### 4. One real write, in a sandbox

Copy a real user story into a sandbox ClickUp list. Run the skill without `--dry-run` and confirm
the subtasks look right in ClickUp: headings, bold, checklists and dividers rendered, with no
literal `**` or `##`. Then delete the sandbox tasks.

---

_Adapted for the Axis Human toolbox by @bronz3beard from the vertical-slice decomposer in tech-lead-stack._
