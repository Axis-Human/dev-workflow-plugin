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

### 0.1 — Local check

Look for a `wiki/` folder containing an `index.md` file in the current
directory. This file is the master catalog and the mandatory entry point.

If `wiki/index.md` is not found, check if there is a `CLAUDE.md` at the
root — it may indicate where the wiki is or what the main folder is called.

If a local wiki is found, use it directly for the rest of this skill
(Steps 1-3 below, reading with `Read`/`Glob` as usual) — skip 0.2 entirely.

### 0.2 — Remote check (no local wiki found)

Read the central registry: `~/.claude/wiki-registry.json`
(`%USERPROFILE%\.claude\wiki-registry.json` on Windows). This file is
personal to this machine and lists wikis connected via `/wiki-init`'s
remote mode — it is never part of a project repo.

- **File doesn't exist or has no entries**: tell the user "I can't find a
  wiki in this folder, and no remote wiki is connected either. Run
  /wiki-init and choose 'connect a remote wiki' to configure one, or
  /wiki-forge to create one from scratch here." Then stop — do not fall
  back to guessing.

- **Exactly one entry**: use it automatically. The user doesn't need to name
  the project.

- **Two or more entries**: try to identify which one the user meant from
  their question (they may name the alias directly, e.g. "search scorebook
  for how X works"). If it's not clear which project they mean, use
  `AskUserQuestion` listing the aliases from the registry so they pick by
  name — never ask them to type an owner/repo path.

Once resolved to a single `{ alias, owner, repo, path, branch }` entry,
fetch files directly from GitHub's REST API — there is no MCP server
involved. These wikis are always private, so a token is always required.

**Golden rule: never open `~/.claude/wiki-registry.json` with the `Read`
tool** — it holds a live token. Every fetch must go through a script (e.g.
`python3`) that reads the file, uses the token internally, and prints
**only the file content or an HTTP status code** — never the token itself:

```bash
python3 -c "
import json, os, urllib.request
p = os.path.expanduser('~/.claude/wiki-registry.json')
d = json.load(open(p))
entry = next(w for w in d['wikis'] if w['alias'] == '[alias]')
token = entry.get('token') or d.get('github_token')
req = urllib.request.Request(
    f\"https://api.github.com/repos/{entry['owner']}/{entry['repo']}/contents/{entry['path']}/index.md?ref={entry['branch']}\",
    headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github.raw'})
print(urllib.request.urlopen(req).read().decode())
"
```

(Any equivalent in `node`, or `jq` piping straight into `curl`'s
`Authorization` header, works — the requirement is only that the token never
becomes visible output, not that it's this specific tool.) Wrap the whole
thing so HTTP errors print a status code instead of a Python traceback.

This fetched content replaces the local `wiki/index.md` for every step below
— same logic (Steps 1-3: scan index, fetch the 1-3 relevant pages the same
way, synthesize), just retrieved remotely instead of read from disk. Fetch
every additional page (not just `index.md`) through this same script
pattern, one call per file.

Interpret HTTP status codes instead of showing a raw error:
- **404**: the registry entry's owner/repo/path/branch is stale or wrong —
  tell the user and point them to `/wiki-init` to fix that alias.
- **401**: the saved token is invalid, expired, or still the
  `PASTE_TOKEN_HERE` placeholder — send them to `/wiki-init` (remote mode)
  to load a real one.
- **403**: the token is valid but the GitHub account behind it doesn't have
  access to this specific repo — tell them to check that the account was
  added as a collaborator (or has org access) to that repo, or that the
  `repo` scope was checked when the classic token was created.

---

## Step 1 — Scan the index

Read `wiki/index.md`. This file lists all wiki pages with a one-line
summary each, organized by category (the wiki subdirectories).

From the index, identify the 1-3 pages most relevant to the user's question.
The key: the index already tells you what each page contains.
You don't need to open all of them — only the ones that fit.

---

## Step 2 — Read the relevant pages

Open only the pages identified in the previous step. Each page has:

- **YAML frontmatter**: tags, type, sources, dates — useful for filtering
- **Content**: the text with the information
- **Wikilinks** `[[page-name]]`: links to related pages

If a page references another via wikilink and that reference seems important
to complete the answer, open it too. But don't chain long read sequences —
2-3 pages are usually enough.

---

## Step 3 — Synthesize and answer

Answer the user's question citing the wiki pages consulted.
Natural and direct format. At the end, include the sources as references:

> Sources: [[page-name-1]], [[page-name-2]]

**In remote mode (0.2)**, skip the `[[wikilink]]` syntax when citing sources —
non-technical users won't recognize it. Use the page's plain title instead:

> Source: "Sync Architecture"

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
