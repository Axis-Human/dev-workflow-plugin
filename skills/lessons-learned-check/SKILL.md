---
name: lessons-learned-check
description: Searches the agency's "Lecciones aprendidas" ClickUp list for lessons about features similar to the one being discovered, scores each from 0 to 1, offers the strong (> 0.8) and low-confidence (> 0.7) matches with an explanation, and asks whether to continue the discovery or reuse what already exists. Runs at the start of every feature discovery.
argument-hint: [--input "<feature idea>"] [--project "<project name>"] [--list-id <clickup list id>]
allowed-tools: Read Bash AskUserQuestion mcp__clickup__clickup_filter_tasks mcp__clickup__clickup_get_task mcp__clickup__clickup_create_task_comment
effort: medium
---

# lessons-learned-check

**Role:** Delivery lead who remembers what the agency already built and learned.
**Goal:** Before a discovery interview starts, check whether a similar feature was already built somewhere in the agency, so the PM can reuse the lesson instead of rediscovering it.

---

## Ground rules

1. **Never invent a match.** Every match must come from a real task in the list, quoted by its ClickUp link.
2. **Explain every score.** A score with no reason is noise. Say what overlaps and what does not.
3. **This is a gate, not the discovery.** Do not ask discovery questions here. Find, score, offer, ask, return.
4. **Ask before writing.** The only write is a comment on a reused lesson (Step 5b), and only after the user agrees.
5. **The report format is fixed.** Headings, labels and score format are always the ones in Step 4, in Spanish, and the report must pass `check-report.mjs` before it is shown. Only the free text (reasons, recommendations) follows the language of the feature idea.

---

## Step 1 — Inputs

Parse `$ARGUMENTS`:

- `--input "<text>"` — the feature idea (the discovery seed). If missing, use the seed passed by the caller; if still empty, ask: "What feature are you about to discover?"
- `--project "<name>"` — the current project, used only to rank (see Step 3). If missing, take it from the working directory's `AGENTS.md`, `CLAUDE.md` or `WIKI.md` if one names it; otherwise leave it empty. Do not ask for it.
- `--list-id <id>` — defaults to `901419286257` (the agency's "Lecciones aprendidas" list, Operations Area space).

---

## Step 2 — Load the lessons

1. `mcp__clickup__clickup_filter_tasks` with `list_ids: [<list-id>]` and `include_closed: true`. Read every page: pass `page` (0, 1, 2, …) and stop only when the response says it is the last one (`has_more: false` or `last_page: true`, depending on the ClickUp MCP version). Never score from the first page alone.
2. If the call fails or the ClickUp MCP server is unavailable, report `⚠ Could not read the lessons-learned list (<reason>). Skipping the check.` and return `{ DECISION: "continue", MATCHES: [] }`. Never block the discovery on this.
3. Shortlist by title: drop lessons whose title is clearly about a different subject (team process, estimation habits, communication) when the idea is a product feature, and vice versa. Keep anything plausible — when unsure, keep it.
4. For each shortlisted lesson, `mcp__clickup__clickup_get_task` with `include: ["description", "custom_fields"]`. Read:
   - **Project** and **Category** custom fields. Both are `drop_down` fields: use the option's **name**, never a number. If `value` is an object, take `value.name`; if it is a number, it is the option's `orderindex` — resolve it with `type_config.options.find((o) => o.orderindex === value).name`. No value → `Sin proyecto` / `Sin categoría`.
   - The body, usually *Qué pasó* / *Qué se aprendió* / *Recomendación*. Headings vary (e.g. *Qué aprendimos*, *Qué haríamos distinto*); treat the last one as the recommendation.

---

## Step 3 — Score each lesson (0 to 1)

Score how similar the lesson's feature or situation is to the idea, always as a number from `0.00` to `1.00` with exactly two decimals (never `0.9`, `90%` or `9/10`):

| Score | Meaning |
| --- | --- |
| 0.9 – 1.0 | Same feature or problem; the lesson applies almost directly. |
| 0.81 – 0.89 | Same core mechanism or user need, different context or details. |
| 0.71 – 0.80 | Overlaps in one important aspect (same integration, pattern or risk), but a different feature. |
| ≤ 0.70 | Shares only generic words or the category. |

Judge on: the user problem solved, the mechanism (e.g. polling, feature flags, third-party integration, background jobs), the domain, and the risks the lesson names. A matching **Category** alone never earns more than 0.6. When the lesson's **Project** equals the current project, add 0.05 (max 1.0) — the same codebase makes the lesson more reusable.

Classify:

- `> 0.8` → **high** — offer it as a similar feature.
- `> 0.7` and `≤ 0.8` → **low** — offer it marked "confianza baja".
- `≤ 0.7` → discard silently.

---

## Step 4 — Present

If nothing scores above 0.7, the whole report is this one line, and you return `{ DECISION: "continue", MATCHES: [] }` without asking anything:

```
No se encontraron lecciones similares en Lecciones aprendidas.
```

Otherwise render exactly this shape. Nothing before the heading, nothing after the last match:

```
## Lecciones aprendidas similares

### Alta similitud

- [<lesson title>](https://app.clickup.com/t/<id>) — **<score>** · <Project> · <Category>
  - **Por qué es similar:** <1–2 sentences: what overlaps with the idea, and what differs>
  - **Recomendación:** <the lesson's recommendation, one line>

### Confianza baja

- [<lesson title>](https://app.clickup.com/t/<id>) — **<score>** · <Project> · <Category>
  - **Por qué podría ser similar:** <1–2 sentences>
  - **Recomendación:** <the lesson's recommendation, one line>
```

- `<score>` uses the Step 3 format (`0.86`). "Alta similitud" holds only scores above `0.80`; "Confianza baja" only scores above `0.70` and up to `0.80`. Highest first in each.
- Omit a section with no matches. Never list a lesson twice.
- A lesson with no Project uses `Sin proyecto`; with no Category, `Sin categoría`. Project and Category are always option names (Step 2), never numbers.
- Write each link as `https://app.clickup.com/t/<id>`, with nothing after the id.
- Discarded lessons are not mentioned.

Check the report before showing it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/lessons-learned-check/scripts/check-report.mjs" - <<'REPORT'
<rendered report>
REPORT
```

`PASS` → show it exactly as checked. `FAIL` → fix every listed difference and check again. Never show a report that has not passed. If `node` is unavailable, check the shape by hand against the block above and say so.

---

## Step 5 — Ask how to proceed

One `AskUserQuestion`:

- Header: "Lecciones"
- Question: "Encontré lecciones similares. ¿Seguimos con el discovery o usamos lo que ya existe?"
- Options:
  1. **Continuar con el discovery** — run the full interview; the matched lessons are carried in as context.
  2. **Usar lo que ya existe** — stop the discovery and build on the selected lesson.

If the user picks "Usar lo que ya existe" and there is more than one match, ask which lesson in a second `AskUserQuestion` (one option per match, up to 4, highest score first).

---

## Step 5b — Leave a trace on the reused lesson (only on `reuse`, only with consent)

So the next person knows the lesson was already reused, offer to comment on it. One `AskUserQuestion`:

- Header: "Registro"
- Question: "¿Dejo un comentario en la lección indicando que se reusó?"
- Options: **Sí, comentar** · **No**

On **No**, write nothing. On **Sí**, render exactly this comment (no other lines):

```
♻️ Lección reusada en un discovery
- **Idea:** <the feature idea, one line>
- **Proyecto:** <current project, or Sin proyecto>
- **Similitud:** **<score>**
- **Fecha:** <today, YYYY-MM-DD>
```

`<score>` is the selected lesson's score in the Step 3 format. Check it before posting:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/lessons-learned-check/scripts/check-report.mjs" --comment - <<'COMMENT'
<rendered comment>
COMMENT
```

`PASS` → post it with `mcp__clickup__clickup_create_task_comment` on the selected lesson's task id. `FAIL` → fix and check again; never post a comment that has not passed. If posting fails, say so in one line and continue — never block on it. This comment is the only thing this skill ever writes.

---

## Step 6 — Return

```yaml
DECISION: continue | reuse
SELECTED_LESSON: { id, title, url, score, recommendation } | null   # only when reuse
LESSON_COMMENTED: true | false                                       # Step 5b; false when not reuse
MATCHES:
  - { id, title, url, score, confidence: high | low, project, category, reason, recommendation }
```

This skill never creates tickets. Its only write is the Step 5b comment, and only after the user says yes.

When invoked directly as `/lessons-learned-check`, also print the result as a short summary: the decision, and the selected lesson's link and recommendation when reusing.
