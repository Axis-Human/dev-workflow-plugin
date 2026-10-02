<!--
  Roles, modules and domain terms are project-specific: take them from the
  project's ClickUp space, never from this file. The {Role 1} / {Module} markers
  below are slots to replace — none of them may survive into a finished proposal.
-->

# {Outcome-oriented title — name the result, not the technical solution}

**One-line summary:** {What we propose and who benefits from it.}

> Example: "Show the applicant a checklist of required attachments before they start, to reduce the number of submissions left as drafts."

---

## 1. Origin

- **Proposed by:** {Name}
- **Date:** {YYYY-MM-DD}

---

## 2. Problem

### What happens today?

{Describe the problem from the user's perspective, not the system's. What are they trying to do, where do they get stuck, what is the consequence.}

### How do they solve it today? (current workaround)

{E.g. "Admins call the applicant on the phone to ask for the missing document." If there is no workaround, say so explicitly.}

### What happens if we do nothing?

{The cost of inaction: wasted time, errors, abandoned submissions, administrative load, regulatory risk.}

---

## 3. Affected users

| Role | How it affects them today | Frequency | Severity (Low/Medium/High) |
| --- | --- | --- | --- |
| {Role 1} | | | |
| {Role 2} | | | |
| {Role 3} | | | |

> One row per role defined in the project's ClickUp space. Delete the rows that do not apply.

### Concrete scenario

{Tell one real or realistic case step by step. E.g. "An applicant completes the whole form, reaches Attachments, does not know which site plan to upload, and abandons the submission."}

---

## 4. Evidence

> **At least ONE source is mandatory.** The more, the better. Include concrete numbers whenever they exist.

- **Usage data:** {query or dashboard} — Link: {…} — Finding: {E.g. "62% of drafts are abandoned at the Attachments step"}
- **Client feedback:** {who, when, what they said} — Link: {…}
- **Related tickets / bugs:** {ClickUp links}
- **Field research / interviews:** {…}
- **Team observation:** {what was observed and in what context}

**Confidence that the problem is real:** ☐ Low ☐ Medium ☐ High

**Why:** {…}

---

## 5. Proposed solution

### Description

{3–6 sentences. What will the user be able to do that they cannot do today.}

### User flow (step by step)

1. {…}
2. {…}
3. {…}

### Business rules

{Conditions, validations, permissions, states. E.g. "Only an admin can mark an attachment as not required."}

### Edge cases

{What happens with incomplete data, historical records, users with no role assigned, tenants with a different configuration, etc.}

### Permissions by role

| Action | {Role 1} | {Role 2} | {Role 3} |
| --- | --- | --- | --- |
| {Action 1} | | | |
| {Action 2} | | | |

### Notifications / communications involved

{Emails, in-app toasts, state changes visible to other roles. "None" is a valid answer.}

---

## 6. Prototype / initial design

> Any tool and any fidelity: Figma, v0, Excalidraw, annotated screenshots, a photo of a sketch.

- **Link:** {…}
- **Fidelity:** ☐ Sketch ☐ Wireframe ☐ Hi-fi mockup ☐ Clickable prototype
- **What it shows:** {…}
- **What it does NOT show / still undefined visually:** {…}
- **Reviewed with design?** ☐ Yes (who): {…} ☐ No

---

## 7. Value

### Value per role

| Role | Concrete benefit |
| --- | --- |
| {Role 1} | |
| {Role 2} | |
| {Role 3} | |

### Impact on the product mission

{How this contributes to the product's core mission. Avoid value claims that cannot be backed up.}

### Validation hypothesis

We believe that **{change}** will achieve **{outcome}** for **{role}**.
We will know we are right when we see **{measurable signal}**.

---

## 8. Scope

### Included

- {…}

### Out of scope (for now)

- {…}

### Possible future phases

{If the idea is large, how it could be split into an MVP and later iterations.}

---

## 9. Technical analysis

### Affected modules

{Tick the modules this change touches, from the project's own module list. Mark any that is uncertain.}

- ☐ {Module 1}
- ☐ {Module 2}
- ☐ {Module 3}

### Impact on the data model

{New or modified tables and columns, migrations, normalization of existing data.}

### Historical data

{Does anything need to be migrated or backfilled? How do existing records behave after the change?}

### Integrations / external services

{…}

### Performance / scalability

{Does it add heavy queries, file processing, AI calls? Any variable cost?}

**Reviewed with backend / frontend / tech lead?** ☐ Yes (who): {…} ☐ No

---

## 10. Estimate

**Size:** ☐ S (< 1 week) ☐ M (1–2 weeks) ☐ L (1 sprint) ☐ XL (needs a SPIKE or a split)

### Rough breakdown

| Area | Estimated hours |
| --- | --- |
| Design | |
| Frontend | |
| Backend | |
| QA | |
| **Total** | |

**Confidence in the estimate:** ☐ Low ☐ Medium ☐ High

**Assumptions behind the estimate:** {…}

---

## 11. Risks and dependencies

| Risk / dependency | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| {…} | | | |

---

## 12. Open questions

### For the client

> Decisions or information only they can provide, phrased so they can be answered directly.

1. {…}

### For the team

> Open technical, design, or product questions.

1. {…}

---

## Summary

{Maximum 3 lines: what we propose, why it is worth doing, and what we need in order to decide.}
