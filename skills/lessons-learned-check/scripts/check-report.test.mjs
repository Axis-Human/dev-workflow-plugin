// Run: node --test skills/lessons-learned-check/scripts/check-report.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkComment, checkReport, NO_MATCHES } from "./check-report.mjs";

const GOOD = `## Lecciones aprendidas similares

### Alta similitud

- [Widget de feature flags](https://app.clickup.com/t/86bbwyvqj) — **0.90** · Gilly · Técnico
  - **Por qué es similar:** Mismo toggle de flags en la UI para el dominio interno.
  - **Recomendación:** Permitir reposicionar el widget.

### Confianza baja

- [Gestión de feature flags](https://app.clickup.com/t/86bbnjaq9) — **0.74** · Herald · Proceso
  - **Por qué podría ser similar:** Define quién activa cada flag.
  - **Recomendación:** Asignar tiempo protegido a la gobernanza.
`;

test("well-formed report passes", () => {
  assert.deepEqual(checkReport(GOOD), []);
});

test("no-matches line alone passes, mixed with a report fails", () => {
  assert.deepEqual(checkReport(NO_MATCHES + "\n"), []);
  assert.ok(checkReport(GOOD + NO_MATCHES).length > 0);
});

test("only one section is fine", () => {
  const onlyHigh = GOOD.split("### Confianza baja")[0];
  assert.deepEqual(checkReport(onlyHigh), []);
});

test("score format and bands are enforced", () => {
  assert.ok(checkReport(GOOD.replace("**0.90**", "**0.9**")).length > 0); // one decimal
  assert.ok(checkReport(GOOD.replace("**0.90**", "**90%**")).length > 0);
  assert.ok(checkReport(GOOD.replace("**0.90**", "**0.80**")).length > 0); // not > 0.8
  assert.ok(checkReport(GOOD.replace("**0.74**", "**0.85**")).length > 0); // too high for low
  assert.ok(checkReport(GOOD.replace("**0.74**", "**0.70**")).length > 0); // discard band
});

test("order, sorting and duplicates are enforced", () => {
  const [head, low] = GOOD.split("### Confianza baja");
  const [, high] = head.split("### Alta similitud");
  const swapped = `## Lecciones aprendidas similares\n\n### Confianza baja${low}\n### Alta similitud${high}`;
  assert.ok(checkReport(swapped).length > 0);

  const highItem = high.trim();
  const unsorted = GOOD.replace(
    highItem,
    highItem.replace("0.90", "0.82") + "\n" + highItem.replace("86bbwyvqj", "abc123"),
  );
  assert.ok(checkReport(unsorted).some((e) => e.includes("not sorted")));
  assert.ok(checkReport(GOOD.replace("86bbnjaq9", "86bbwyvqj")).some((e) => e.includes("twice")));
});

test("detail lines are required, labelled and ordered", () => {
  assert.ok(checkReport(GOOD.replace(/ {2}- \*\*Recomendación:\*\* Permitir.*\n/, "")).length > 0);
  assert.ok(checkReport(GOOD.replace("Por qué es similar", "Por qué")).length > 0);
  assert.ok(checkReport(GOOD.replace("  - **Por qué es", "- **Por qué es")).length > 0);
});

test("stray text and wrong heading fail", () => {
  assert.ok(checkReport(GOOD + "\nEspero que sirva!\n").some((e) => e.includes("unexpected")));
  assert.ok(checkReport(GOOD.replace("## Lecciones", "## Lessons")).length > 0);
  assert.ok(checkReport(GOOD.replace("https://app.clickup.com/t/86bbwyvqj", "86bbwyvqj")).length > 0);
});

test("copied links with a trailing slash or query still pass", () => {
  assert.deepEqual(checkReport(GOOD.replace("t/86bbwyvqj)", "t/86bbwyvqj/)")), []);
  assert.deepEqual(checkReport(GOOD.replace("t/86bbwyvqj)", "t/86bbwyvqj?comment=1)")), []);
  // the same id with a suffix is still a duplicate
  assert.ok(checkReport(GOOD.replace("t/86bbnjaq9)", "t/86bbwyvqj/)")).some((e) => e.includes("twice")));
});

test("drop-down indexes instead of option names fail", () => {
  assert.ok(checkReport(GOOD.replace("· Gilly · Técnico", "· 9 · 10")).some((e) => e.includes("option names")));
});

const COMMENT = `♻️ Lección reusada en un discovery
- **Idea:** Panel interno para activar y desactivar feature flags
- **Proyecto:** Gilly
- **Similitud:** **0.90**
- **Fecha:** 2026-11-18
`;

test("well-formed reuse comment passes", () => {
  assert.deepEqual(checkComment(COMMENT), []);
});

test("reuse comment format is enforced", () => {
  assert.ok(checkComment(COMMENT.replace("♻️ Lección", "Lección")).length > 0);
  assert.ok(checkComment(COMMENT + "Gracias!\n").length > 0); // stray line
  assert.ok(checkComment(COMMENT.replace("- **Proyecto:** Gilly\n", "")).length > 0); // missing field
  const swapped = COMMENT.replace("- **Proyecto:** Gilly\n- **Similitud:** **0.90**", "- **Similitud:** **0.90**\n- **Proyecto:** Gilly");
  assert.ok(checkComment(swapped).length > 0); // wrong order
  assert.ok(checkComment(COMMENT.replace("**0.90**", "0.90")).length > 0);
  assert.ok(checkComment(COMMENT.replace("**0.90**", "**0.65**")).length > 0); // below reuse band
  assert.ok(checkComment(COMMENT.replace("Gilly", "9")).length > 0); // drop-down index
  assert.ok(checkComment(COMMENT.replace("2026-11-18", "2026-02-30")).length > 0); // not a real date
  assert.ok(checkComment(COMMENT.replace("2026-11-18", "18/11/2026")).length > 0);
});

test("comment heading ignores the emoji variation selector", () => {
  assert.deepEqual(checkComment(COMMENT.replace("\u267B\uFE0F", "\u267B")), []);
});
