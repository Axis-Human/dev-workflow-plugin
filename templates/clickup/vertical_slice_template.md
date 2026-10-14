# [SLICE {n}/{N}] {Imperative title naming the user-facing flow}

## Slice
- **Parent story:** {story ID} — {story title}
- **Slice:** {n} of {N} (implementation order)
- **Scope:** {Full-stack | Frontend only | Backend only}
- **Counterpart:** {{ID} — {title} | ⚠ none found | Not needed: no {backend | frontend} change | N/A: full-stack}
- **Depends on:** {earlier slice IDs | None}

---

## Dark release
- **Flag required:** {yes: `{flag name}` | no}
- **Removal:** {Flag owner removes at go-live. | N/A}

## Data source
- **Source:** {Stubbed contract, then real | Real contract | N/A}

---

## Definition of Ready
- [ ] GWT defined
- [ ] ≤ 2 working days (active)
- [ ] ≤ 24 files changed (est.), or up to 45 if most of them are small edits such as renames or moved files
- [ ] Testable
- [ ] Dependencies resolved

## Definition of Done
- [ ] Integrated to trunk
- [ ] Unit tests pass
- [ ] Code reviewed
- [ ] Deployable: {the flag hides incomplete behaviour | no incomplete behaviour is reachable}
- [ ] Docs updated
- [ ] No known defects
- [ ] QA-ready: {only when counterpart {ID | still to be created} is complete | this slice alone}
- [ ] Contract points: {every point confirmed and aligned, no `ASSUMPTION(` markers left | N/A}

---

## Vertical slice
As a **{actor}**, I can **{observable behaviour}** [happy path].

## Acceptance criteria (GWT)
- **Given** {context} **When** {action} **Then** {observable result}

---

## Estimate
- **Active days:** ≤ 2 working days (hard limit)
- **Files (est.):** {n} ({shallow | deep})
- **Expected lead time:** {n.n} working days (active + typical review/QA wait)
- **Confidence:** {High | Medium | Low}
- **Baseline:** {source and sample size | defaults: {reason}}

---

## Technical details

### Frontend
- **Changes:** {UI, state, client-side data layer, flag wiring}
- **Contract used:** {one sub-bullet per read or write site}
  - {read | write | event} `{exact operation name}` ({path}:{line}), uses `{type.field}`
```{language}
{payload as a typed schema}
```
- **Evidence:** {one sub-bullet per grounding}
  - `{repo}/{path} :: {symbol}` ({line or snippet})

### Backend
- **Changes:** {endpoints, services, jobs, access rules, data}
- **Contract provided:** {one sub-bullet per operation}
  - {read | write | event} `{exact operation name}` ({path}:{line}), extends `{type.field}`
```{language}
{payload as a typed schema}
```
- **Schema/migration delta:** {backward-compatible change | none}
- **Evidence:** {one sub-bullet per grounding}
  - `{repo}/{path} :: {symbol}` ({line or snippet})

---

## Unconfirmed contract points
- **Confirmer:** {@ClickUp user | Tag the confirming developer here}
- **A1** `{field or operation}`: assumed {value or shape}. Confirms: {Backend | Frontend} ({counterpart ID | ⚠ none found})
{or: None}

## Contract confirmations
Filled in by the confirming side. The implementing side then aligns its code and this slice.
- **A1** Status: {Pending | Confirmed as assumed | Corrected: {actual value or shape}} · Confirmed by: {@ClickUp user, date} · Aligned in code: {No | Yes}
{or: N/A: no unconfirmed points}

---

## Design reference
- **Design:** {link or frame name | none provided}
- **States covered:** {populated, empty, error, read-only, flag off, …}
- **Source material:** {document and section | none}
- **Layout rule:** The current app layout and styling take priority. Only add or change what this slice needs.

---

## Technical prompt
_Use when handing this slice to an agent or a planning skill: copy the block below as-is._

```text
Implement "[SLICE {n}/{N}] {title}", a subtask of ClickUp story {story ID} ({story URL}).
Read the slice first. Its acceptance criteria, contract and contract confirmations are the source of truth.

Goal: As a {actor}, I can {observable behaviour}.
Scope: {Full-stack | Frontend only: do not change backend code | Backend only: do not change frontend code}
Feature flag: {Put all new behaviour behind `{flag name}`; with the flag off, behaviour is unchanged. | No flag.}

Target files:
- {path}: {what changes}

Frontend:
- {step, naming the existing component, hook or module to reuse}

Backend:
- {step, naming the existing model, endpoint or service to extend}

Contract assumptions:
- {A1: mark in code as ASSUMPTION(A1) and keep it in one constant or helper | None}

Tests:
- {test file}: {behaviour it proves}

Validation: {the project's own lint, type-check and test commands}. All must pass.
Done when: every acceptance criterion passes and validation is green. Stop there and summarise the changes for review.
```
