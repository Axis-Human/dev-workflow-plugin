---
name: wiki-sync
description: Synchronizes the wiki with changes in source repositories since the last sync, always diffing against each repo's configured base branch — regardless of what branch is currently checked out locally. Invoke when the user asks to sync or update the wiki, or wants to bring it up to date with recent commits.
allowed-tools: Read Write Edit Bash AskUserQuestion
effort: medium
---

# wiki-sync

Incrementally updates the wiki based on what changed in the source repos
since the last sync. Reads only the diff — never re-scans everything.

Output messages to the user in the same language as the wiki (see wiki-conventions.md).

---

## Step 0 — Load conventions and config

Read two files:

1. `.claude/wiki-conventions.md` — authoritative source for all wiki standards.
   Every wiki edit must follow those conventions exactly.

2. `wiki/sync-config.md` — list of source repos and file impact patterns.
   This file defines which repos to sync and which file patterns have wiki impact.

If `wiki/sync-config.md` doesn't exist, abort:
> "wiki/sync-config.md not found. Run /wiki-init to configure repos, or create it manually."

Parse `wiki/sync-config.md` to extract:
- `REPOS`: list of `{ name, remote_url, stack, base_branch }` objects from the Repositories table. The `remote_url` and `stack` come from the `Remote URL` and `Stack` columns respectively. The `base_branch` comes from the `Base branch` column in the table; if that column is absent or the value is empty for a given repo, default to `main`.
- `IMPACT_PATTERNS`: per-repo list of file glob patterns with wiki impact
- `NO_IMPACT_PATTERNS`: list of patterns to ignore

If `REPOS` is empty (no data rows in the Repositories table, or the table body
contains only a placeholder like `"(none)"`), inform the user:
> "No source repos configured in wiki/sync-config.md. Nothing to sync."
Then stop.

---

## Step 0.5 — Ensure bare clone cache

For each repo in `REPOS`:

1. Compute `CACHE_PATH = wiki/.sync-cache/[repo.name]`.

2. Check if `CACHE_PATH/HEAD` exists (marker of a valid bare repo).
   If it exists, skip to the next repo.

3. If it does not exist, clone:

   ```bash
   git clone --bare [repo.remote_url] wiki/.sync-cache/[repo.name]
   ```

   After the clone succeeds, configure the fetch refspec so that
   `origin/[branch]` references work (bare clones default to mapping
   remote heads directly into `refs/heads/`):

   ```bash
   git -C wiki/.sync-cache/[repo.name] config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
   git -C wiki/.sync-cache/[repo.name] fetch origin
   ```

4. If the clone fails, classify the error from stderr:

   **Authentication problem** — stderr contains patterns like "could not read
   Username", "Authentication failed", "Permission denied", "403", or a
   username/password prompt failure:

   Tell the user:

   > The clone failed because git could not authenticate. This usually means
   > the credential flow needs an interactive prompt that cannot run from
   > this automated session.
   >
   > Please run this command yourself in your own terminal:
   > ```
   > git clone --bare [repo.remote_url] wiki/.sync-cache/[repo.name]
   > ```
   > Your system's native credential dialog (Git Credential Manager, browser
   > OAuth flow, SSH passphrase prompt) will appear and let you authenticate.
   > Once it finishes, let me know and I will continue from here.

   After the user confirms, verify the clone landed by checking that
   `CACHE_PATH/HEAD` exists. If it does, configure the fetch refspec as
   described in step 3 above, then continue.

   **Repository not found** — stderr contains patterns like "repository not
   found", "not found", "does not exist":

   Tell the user the URL appears incorrect and ask them to review the
   `Remote URL` for this repo in `wiki/sync-config.md`. Once they confirm
   the correction, re-read the updated `wiki/sync-config.md` and retry
   the clone with the new URL.

After processing all repos, ensure `wiki/.gitignore` contains the line
`.sync-cache/`:
- If `wiki/.gitignore` does not exist, create it with `.sync-cache/` as
  its only line.
- If the file exists, check whether it already contains `.sync-cache/`.
  Only append the line if it is missing — never duplicate it.

From this point on, every reference to `[repo.path]` in the steps below
means `CACHE_PATH` (`wiki/.sync-cache/[repo.name]`) — never a local
working copy of the source code.

---

## Step 1 — Read the sync state

Read `wiki/sync.md`. It contains the last synced commit hash for each repo.

Format expected:
```
# Wiki Sync State

| Repo | Last synced hash | Date |
|------|-----------------|------|
| repo-name | abc1234 | YYYY-MM-DD |
```

If `wiki/sync.md` doesn't exist, treat all repos as first-time syncs.
Use `git -C [CACHE_PATH] rev-parse --short origin/[repo.base_branch]` to get the current remote base branch tip as a baseline,
then run a full scan instead of a diff. The file list for the scan must come from
the remote base branch tree, not the local working tree (the repo may be checked
out to a different branch):

```bash
git -C [CACHE_PATH] ls-tree -r --name-only origin/[repo.base_branch]
```

---

## Step 2 — Compute the diff for each repo

For each repo in `REPOS`, first fetch the latest remote state for the repo's base branch:

```bash
git -C [CACHE_PATH] fetch origin [repo.base_branch] 2>/dev/null
```

Then compute the diff against the repo's base branch:

```bash
git -C [CACHE_PATH] log [last-hash]..origin/[repo.base_branch] --name-status --pretty=format:"" 2>/dev/null
```

Where `[last-hash]` comes from `wiki/sync.md` for that repo.
If the repo has no entry in sync.md (first sync), use an empty diff and
treat the full file list as Added.

Status letters: `A` = Added, `M` = Modified, `D` = Deleted, `R<score>` = Renamed.

If all diffs are empty across all repos:
> "Everything is up to date. No changes since last sync."
Then stop — do not modify anything.

---

## Step 3 — Classify each changed file

For each changed file, check against the patterns in `wiki/sync-config.md`:

**Has wiki impact** — matches a pattern in `IMPACT_PATTERNS` for its repo.

**No wiki impact** — matches a pattern in `NO_IMPACT_PATTERNS`, or matches
none of the impact patterns.

Group files by: has-impact vs no-impact. Only process the has-impact group.

---

## Step 4 — Apply changes to the wiki

Follow conventions loaded in Step 0 for all edits.

### Added (`A`) or Modified (`M`)

1. Read the file's content **as it exists on the repo's remote base branch** —
   never read it from the local working tree, since the repo may currently be
   checked out to a different branch than `[repo.base_branch]`:
   ```bash
   git -C [CACHE_PATH] show origin/[repo.base_branch]:[file-path] 2>/dev/null
   ```
   This never switches branches or touches the working tree, so it works
   regardless of what's currently checked out locally.
2. Identify which wiki page(s) cover it (`wiki/index.md` as reference).
3. Update those pages — amplify, do not rewrite. Add or adjust only what
   the changed file introduces; preserve everything else.
4. If no page covers this file and it introduces a meaningful new concept,
   create a new wiki page following the format in `wiki-conventions.md`.
5. Update `wiki/index.md` if a new page was created.

### Deleted (`D`)

1. Identify wiki page(s) that document this file.
2. Whole page is about this file → delete the wiki page.
3. File is one part of a larger page → remove only that section.
4. Remove deleted page from `wiki/index.md`.
5. Find all `[[wikilinks]]` pointing to the deleted page and fix them.

### Renamed (`R`)

1. Cosmetic rename (path change only): update path references, no content change.
2. Semantic rename (purpose changed): treat as Delete + Add.
3. If a wiki page was named after the old file, rename it and update
   `wiki/index.md` and all inbound wikilinks.

### After all changes

Scan modified pages for `[[wikilinks]]` that don't resolve to an existing
`.md` file. Fix any ghost links before proceeding.

---

## Step 5 — Update sync state

For each repo, get the current base branch hash:

```bash
git -C [CACHE_PATH] rev-parse --short origin/[repo.base_branch] 2>/dev/null
git -C [CACHE_PATH] log -1 origin/[repo.base_branch] --pretty=format:"%s" 2>/dev/null
```

Overwrite `wiki/sync.md` with the new hashes and today's date:

```markdown
# Wiki Sync State

| Repo | Last synced hash | Date |
|------|-----------------|------|
| [repo.name] | [new-hash] | YYYY-MM-DD |
```

---

## Step 6 — Create sync log file

Create `wiki/logs/YYYY-MM-DD.md` (today's date).
If the file already exists (multiple syncs today), append to it.

Write all section headings, labels, and descriptions in the language
defined in `wiki-conventions.md` (loaded in Step 0). The structure below
is a template — translate every heading and label to match that language:

```markdown
# Sync — YYYY-MM-DD

## Summary

[For each repo:]
- [repo.name]: `<old-hash>` → `<new-hash>` (<N> commits)

## Wiki changes

### Pages updated
- `path/page.md` — brief description of what changed

### Pages created
- `path/page.md` — reason

### Pages deleted
- `path/page.md` — reason

## Diff files with wiki impact (<N> of <total>)

| File | Repo | Status | Action taken |
|------|------|--------|--------------|
| `path/to/file` | repo-name | M | Updated `wiki/page.md` |

## Diff files without wiki impact (<N> ignored)

`tests/SomeTest.php`, `composer.lock`, ...
```

---

## Step 7 — Report to the user

```
Wiki sync complete.

[For each repo:]
[repo.name]: <old-hash> → <new-hash>  (<N> files changed)

Wiki changes:
  Updated:  page-a, page-b
  Created:  page-c          (if any)
  Deleted:  page-d          (if any)

Log: wiki/logs/YYYY-MM-DD.md

Ignored (no wiki impact): tests/SomeTest.php, composer.lock, ...
```

---

## Step 8 — Offer to commit and push (optional)

After reporting to the user, ask whether they want to commit and push the
wiki changes now using `AskUserQuestion`:

- **Question:** "Do you want to commit and push these wiki changes now?"
- **Header:** "Commit & push"
- **Options:**
  - "Yes, commit and push"
  - "No, I'll do it manually"

### If the user selects "No"

Stop here. The skill ends exactly as it would without this step — no git
operations are performed.

### If the user selects "Yes"

#### 1. Stage only the wiki folder

```bash
git add wiki/
```

Never use `git add -A` or `git add .`. Never stage files outside `wiki/`
(`raw/`, `local/`, or any other directory the user may have changed
independently). This skill only modifies content inside `wiki/`, so the
stage must be scoped to match.

#### 2. Check that there is something to commit

```bash
git diff --cached --stat
```

If there are no staged changes (edge case — Step 2 already stops early when
there are no diffs, but guard against it anyway), inform the user:

> No wiki files were changed — nothing to commit.

Then stop. Do not proceed to commit or push.

#### 3. Build the commit message

Reuse the per-repo hash ranges and wiki-change lists already computed in
Steps 5–7. Format:

```
wiki-sync: update from [repo.name]@[old-hash]..[new-hash]
```

If multiple repos had changes, list each on its own line:

```
wiki-sync: update from repo-a@aaa1111..bbb2222, repo-b@ccc3333..ddd4444
```

After the subject line, add a body listing the wiki pages affected:

```
Updated: page-a, page-b
Created: page-c
Deleted: page-d
```

Omit any category that has no entries (e.g., if nothing was deleted, do not
include the `Deleted:` line).

#### 4. Commit

```bash
git commit -m "<message>"
```

#### 5. Push

```bash
git push 2>&1
```

Capture both stdout and stderr and interpret the result:

**Success** — the push exits 0:

Tell the user the changes were pushed, mentioning the remote and branch
(e.g., `origin/main`).

**Authentication failure** — stderr contains patterns like "could not read
Username", "Authentication failed", "Permission denied", "403", or a
username/password prompt failure:

Tell the user:

> The push failed because git could not authenticate. This usually means
> the credential flow needs an interactive prompt that cannot run from
> this automated session.
>
> Please run this command yourself in your own terminal:
> ```
> git push
> ```
> Your system's native credential dialog (Git Credential Manager, browser
> OAuth flow, SSH passphrase prompt) will appear and let you authenticate.

Then stop. Do not retry.

**Any other failure** (e.g., rejected because the remote has new commits,
diverged histories, protected branch, hook failure):

Report the exact error to the user and tell them to resolve it manually
(pull, rebase, or whatever their workflow requires). **Never** run
`git push --force` or any force-push variant automatically, under any
circumstance.

---

## What NOT to do

- Do not re-read the entire codebase. Only read files listed in the diff.
- Do not rewrite wiki pages from scratch — amplify existing content.
- Do not delete a wiki page just because one of its source files changed.
  Only delete when the entire concept it documents was removed.
- Do not update `wiki/sync.md` if the sync failed or was aborted partway.
- Do not ask for confirmation before applying changes.
- Do not invent conventions. All standards come from `.claude/wiki-conventions.md`.
- Do not hardcode file patterns or branch names — always read from `wiki/sync-config.md`. Repo paths are always computed as `wiki/.sync-cache/[repo.name]` — never configurable, never a local working copy.
