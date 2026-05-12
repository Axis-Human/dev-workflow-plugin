# Wiki Conventions — {{VAULT_NAME}}

Single source of truth for all formatting, writing, and quality standards
for the pages in this wiki.

Read by `/wiki-forge` and `/wiki-sync` at the start of every write operation.
Not read during queries (read-only).

---

## Language

All pages are written in **{{LANGUAGE}}**.
Titles, sections, body text — everything in {{LANGUAGE}}.
Technical product names are kept in their original form.
Wikilinks are never translated.

When delegating to subagents: always include the explicit instruction
"Write everything in {{LANGUAGE}}".

---

## File names

- Format: `kebab-case` without accents or special characters
- Correct: `concept-name.md`
- Incorrect: `Concept Name.md`, `concept_name.md`

---

## Frontmatter

All wiki pages must have exactly these 5 fields.
Do not use alternative fields (`title`, `description`, `slug`, `created`, etc.).

```yaml
---
tags: [category, subcategory]
type: technique | concept | person | tool | decision | source
sources: ["original-source-name"]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

---

## Wikilinks

- Format: `[[file-name]]` without `.md` extension
- Alias: `[[file-name|Visible text]]` when the name doesn't fit in the sentence
- **Minimum 8 wikilinks per page**, distributed throughout the body text
  — not grouped only in the "Relations" section at the end
- Every mention of a concept or entity that has its own page must be a wikilink
- **0 broken wikilinks** — verify that every target exists as a `.md` file

---

## Page format

Standard structure (adapt based on the type of page):

```markdown
---
[frontmatter]
---

# Title

Description in 2-3 paragraphs with [[wikilinks]] woven into the text.

## Detail section

Content development with [[wikilinks]] distributed throughout.

## Example

> Quote or concrete example extracted from the sources.

## Relations

- See also: [[related-page]]
- Depends on: [[previous-concept]]
- Connected to: [[another-page]]
```

Length: **200-500 words** per page. If it grows longer, split into more specific pages.

---

## Content rules

- **Current state only**: pages reflect how the system is today.
  No historical notes ("previously was X", "renamed from Y",
  "added on DD-MM-YYYY"). That context belongs in `wiki/logs/`.
- **Extend, don't rewrite**: when updating an existing page, preserve
  the current content and add what's new. Only remove what is no longer valid.
- **No duplication**: if content already exists on another page, link to it.
  Never copy.
- **Concrete evidence**: every page must include at least one example,
  specific data point, or real code snippet.

---

## Delegating to subagents

Every delegation prompt must explicitly include these 4 elements:

1. **Language**: "Write everything in {{LANGUAGE}}"
2. **Frontmatter**: paste the exact 5-field template (see Frontmatter section)
3. **List of existing pages**: so wikilinks point to real pages
4. **Density**: "Minimum 8 wikilinks per page, distributed throughout the body text"

Without these 4 explicit instructions, subagents produce pages in the wrong
language, with inconsistent frontmatter, too few links, or links to nonexistent pages.
