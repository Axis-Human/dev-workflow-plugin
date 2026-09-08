---
name: create-draft-pr
description: Creates a GitHub pull request (always as Draft, no exceptions) auto-populated from the repo's `templates/pull_request_template.md`. Infers base branch, title, and every section from git context (diff, commits, branch name, CODEOWNERS). Uses gh CLI first, GitHub MCP as fallback. Runs without human input when `--auto` is passed or called by another skill/agent.
argument-hint: [--base <branch>] [--ticket-id <id>] [--auto]
allowed-tools: Bash AskUserQuestion mcp__github__create_pull_request mcp__github__list_branches
effort: low
---

# create-draft-pr

Open a reviewer-ready **draft** PR from git context alone — no manual writing. `--auto` (or being called by another skill/agent) skips all confirmations.

## 1. Parse args

`--base <branch>`, `--ticket-id <id>`, `--auto` (sets `AUTO_MODE=true`).

## 2. Gather context

```bash
git branch --show-current
git remote get-url origin          # extract OWNER/REPO
git config user.email              # exclude self from FYI
git branch -r --format='%(refname:short)' | sed 's/origin\///'
git log HEAD --oneline -20
# after BASE_BRANCH is resolved:
git diff <BASE_BRANCH>...HEAD --name-only
git diff <BASE_BRANCH>...HEAD --stat
git diff <BASE_BRANCH>...HEAD
```

If uncommitted changes exist, warn they won't be included (skip the warning in `AUTO_MODE`).

## 3. Infer base branch

Use `--base` if given (trust it, no confirmation — always correct when called by `implement-task`). Otherwise pick, in order: `main` → `master` → `develop` → `staging` → first `release/*` → most recently committed remote branch. If not `AUTO_MODE` and the pick isn't `main`/`master`, confirm with the user. Stop if current branch == base branch.

## 4. Infer PR title

Strip type prefix (`feat/fix/chore/refactor/docs/hotfix`) and any ticket/sprint prefix → hyphens to spaces → Title Case → prepend `[Feature]/[Fix]/[Refactor]/[Docs]/[Chore]/[Hotfix]` → append `(TICKET-ID)` if known.
Example: `feat/CU-123-user-auth` → `[Feature] User auth (CU-123)`.

## 5. Populate the template

Read `templates/pull_request_template.md` at the repo root and use it verbatim as the skeleton — do not add or remove sections. Derive each section from Step 2's git context:

- **Description 📝** — 2-4 bullets covering why + what, each starting with `add`/`update`/`fix`/`refactor`/`delete`. Rewrite commit messages as intent statements; reference real function/component/route names.
- **Module** — extract `M{N}` and `S{N}` from branch name/commits (patterns like `M1`, `migration-1`, `S12`, `sprint-12`). Use `<!-- TBD -->` if absent — never invent.
- **Shared Code Impact** — flag files under `shared/`, `core/`, `common/`, `lib/`, `utils/`, `helpers/`, `hooks/`, `composables/`, `services/`, `types/`, `constants/`. List them if any; `Team notified: No`.
- **FYI 🙋** — merge GitHub handles from `CODEOWNERS` (root or `templates/`) for changed files with contributor emails from `git log <BASE>...HEAD --format="%ae" -- <files>`, dedupe, remove the current author (`git config user.email`). If empty: "No additional stakeholders identified."
- **Screenshots 📸** — if changed files touch UI (`pages/`, `views/`, `routes/`, `screens/`, `app/`, `src/app/`, or `.vue/.svelte/Page./View./Screen./Layout.`), list affected routes and note screenshots are needed at `.github/evidence/<filename>.png`. Otherwise: "No UI changes in this PR."
- **Testing** — set `Breaking changes` (Yes if diff/commits show removed API params/responses, changed shared function signatures, dropped DB columns, or `BREAKING CHANGE:`/`!` in commit type), `Manual testing completed`, `Unit tests added/updated` based on the diff. Add brief instructions only if a reviewer needs specific steps to verify.
- **Release Readiness** — `Ready for release: Yes` unless known gaps exist; `Needs additional work: No` unless something is incomplete.

If `--ticket-id` or a branch-extracted ticket ID exists and the template has no dedicated field for it, it still appears via the PR title (Step 4) — don't add a section the template doesn't define.

## 6. Confirm

If not `AUTO_MODE`: show the rendered title + body, ask "Does this look correct? Reply Yes to create it, or paste corrections." Apply corrections, then proceed. In `AUTO_MODE`, skip straight to Step 7.

## 7. Create the PR — always Draft, no exceptions

```bash
gh pr create --title "<title>" --body "<body>" --base "<BASE_BRANCH>" --head "<current branch>" --draft
```

On failure, fall back to:

```
mcp__github__create_pull_request { owner, repo, title, body, head, base, draft: true }
```

If both fail, report both errors and stop.

## 8. Report

```
## Pull Request Created (Draft)
Title:  <title>
URL:    <pr_url>
Base:   <BASE_BRANCH> <- <current branch>
Files:  <count> changed
Method: <gh CLI | GitHub MCP (fallback)>
```

Store `PR_URL`/`PR_NUMBER` in context for any calling skill/agent.
