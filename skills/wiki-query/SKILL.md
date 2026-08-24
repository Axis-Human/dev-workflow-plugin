---
name: wiki-query
description: Searches and answers questions by querying the active vault's wiki (LLM Wiki / Karpathy pattern). Activate when the user searches the wiki, asks about documented topics, or uses phrases like "what does the wiki say about" or "search my notes". If a wiki/ folder with an index.md exists, this skill is the fastest path to an answer.
allowed-tools: Read Glob AskUserQuestion Bash
effort: low
---

# wiki-query

Smart search in any LLM wiki vault.

Implements the QUERY flow of the LLM Wiki pattern: find information
in the wiki quickly and precisely, without unnecessary traversal.

Works with any vault that follows the standard LLM wiki structure,
regardless of the topic (a course, a project, personal notes, etc.).

---

## Step 0 — Discover the wiki

Look for a `wiki/` folder containing an `index.md` file by walking up from
the current working directory:

```bash
test -f wiki/index.md && echo "local" || (test -f wiki/wiki/index.md && echo "local-nested" || echo "missing")
```

- **"local"**: wiki is at `wiki/index.md`. Use it directly for the rest of
  this skill (Steps 1-4 below, reading with `Read`/`Glob` as usual).

- **"local-nested"**: wiki repo is cloned into `wiki/`, and the actual wiki
  pages are in `wiki/wiki/`. Use `wiki/wiki/index.md` as the entry point
  and resolve all wiki page paths relative to `wiki/wiki/`.

- **"missing"**: no wiki found. Tell the user "No wiki is available — no
  local `wiki/` folder with an `index.md` was found. Run `/wiki-init` to
  create a new wiki, or `/wiki-connect` to clone one from a remote
  repository." Then stop.

If `wiki/index.md` is not found but a `CLAUDE.md` exists at the project
root, check whether it mentions a wiki location — it may indicate a custom
path.

---

## Step 1 — Sync the wiki (staleness-gated, every query)

Run this check on **every** query, not just the first one of a conversation
— there is no reliable way to detect "new conversation" from inside a
skill, so don't try. Instead, gate the pull on an on-disk timestamp so it
runs at most once per 6 hours regardless of how many conversations touch
the wiki.

If the wiki folder found in Step 0 is inside a git repository (a `.git`
directory exists at or above the wiki root), resolve the git dir and check
the last-pull marker stored inside it (the git dir is never tracked by git
itself, so this marker is safe from commits, pulls, and `git status`):

```bash
GIT_DIR=$(git -C <wiki-root> rev-parse --git-dir 2>/dev/null)
STAMP_FILE="$GIT_DIR/wiki-query-last-pull"
FRESH=$([ -n "$GIT_DIR" ] && find "$STAMP_FILE" -mmin -360 2>/dev/null)
```

- **If `$FRESH` is non-empty**: the wiki was pulled less than 6 hours ago.
  Skip the pull and go to Step 2 — unless the user explicitly asked to
  refresh (e.g. "refresh the wiki", "pull latest changes"), in which case
  pull anyway.
- **Otherwise**: run the pull and refresh the marker:

```bash
git -C <wiki-root> pull
touch "$STAMP_FILE"
```

Do **not** pass `-c credential.helper=` or any authentication overrides —
let the user's normal git configuration handle authentication. If the pull
triggers a credential prompt, the user is present in the session and can
resolve it interactively.

If the `git pull` fails:
- **Uncommitted local changes, diverged history, or merge conflicts**: stop
  and tell the user clearly what is blocking the pull (include the error
  message). Ask them to resolve it manually (commit, stash, or decide how
  to handle the conflict). Do **not** run `git reset --hard` or any
  destructive command to force the update. Do **not** touch the marker
  file in this case — the next query should retry.
- **Network errors or other transient failures**: warn the user that the
  wiki may be stale, but continue answering from the local copy. Do **not**
  touch the marker file — the next query should retry.

If the wiki folder is not inside a git repository, skip this step entirely
and go to Step 2.

---

## Step 2 — Scan the index

Read `wiki/index.md`. This file lists all wiki pages with a one-line
summary each, organized by category (the wiki subdirectories).

From the index, identify the 1-3 pages most relevant to the user's question.
The key: the index already tells you what each page contains.
You don't need to open all of them — only the ones that fit.

---

## Step 3 — Read the relevant pages

Open only the pages identified in the previous step. Each page has:

- **YAML frontmatter**: tags, type, sources, dates — useful for filtering
- **Content**: the text with the information
- **Wikilinks** `[[page-name]]`: links to related pages

If a page references another via wikilink and that reference seems important
to complete the answer, open it too. But don't chain long read sequences —
2-3 pages are usually enough.

---

## Step 4 — Synthesize and answer

Answer the user's question citing the wiki pages consulted.
Natural and direct format. At the end, include the sources as references:

> Sources: [[page-name-1]], [[page-name-2]]

---

## When to go to the original sources

Many wikis have a `raw/` folder with raw materials
(transcripts, articles, original documents). These are immutable.

Only go to `raw/` if:

- The user asks for an exact verbatim quote
- The wiki doesn't have enough detail to answer
- You need to verify something specific

Pages in the `sources/` subfolder of the wiki are summaries of each
original source — they work as a bridge between the processed wiki and
the raw material. Check them first before going directly to `raw/`.

---

## What NOT to do

- **Do not grep or launch agents**. The index exists precisely
  to avoid brute-force searches. Use it.
- **Do not read all pages "just in case"**. Read the index, identify
  the relevant ones, and go directly.
- **Do not answer without consulting the wiki**. The purpose of this skill
  is that the answer comes from the pages, not from general knowledge.
- **Do not invent information**. If it's not in the wiki, say so clearly.
  You can suggest the user ingest new information with wiki-forge.
