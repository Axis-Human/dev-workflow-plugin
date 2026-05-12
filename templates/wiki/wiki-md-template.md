# {{VAULT_NAME}}

{{PROJECT_DESCRIPTION}}

LLM Wiki pattern (Karpathy): the LLM reads sources once, extracts knowledge,
and organizes it into interlinked pages that grow richer with each new source.
Sources are immutable. The wiki belongs to the LLM.

---

## Vault structure

```
wiki/                → Knowledge pages generated and maintained by the LLM.
  index.md           → Master catalog: link + summary of each page. Start here.
  log.md             → Operation history (ingest, lint).
  logs/              → One file per repository sync (YYYY-MM-DD.md).
  sources/           → One summary per ingested source.
{{WIKI_CATEGORIES}}
raw/                 → Original sources. NEVER modify.
{{RAW_STRUCTURE}}
local/               → Ephemeral local files. Not committed to the repo.
.claude/
  wiki-conventions.md → Writing standards (loaded by write-mode skills).
```

---

## Language

All pages in this wiki are written in **{{LANGUAGE}}**.
Titles, sections, body text — everything in {{LANGUAGE}}.
Technical product names are kept in their original form.
Wikilinks are never translated.

---

## Navigation

1. Always start at `wiki/index.md` — it is the map of everything.
2. Follow `[[wikilinks]]` to go deeper.
3. Go to `raw/` only if you need the original source or raw material.
4. Pages in `wiki/sources/` are the bridge between sources and the wiki.

---

## Sources

{{SOURCES_DESCRIPTION}}

---

## Available skills

| Skill | When to use |
| ----- | ----------- |
| `/wiki-forge` | Ingest new sources, create vault, lint |
| `/wiki-sync` | Sync the wiki with repository changes |
| `/wiki-query` | Query and search information in the wiki |
