// Run: node --test skills/test-case-generation/scripts/check-test-cases.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPreview, parseList, parseTicket } from "./check-test-cases.mjs";

const GOOD = `## Test Plan: Date Picker - Slice 1: Single Date Picker in Storybook

Source slice: [Slice 1: Pick a single date](https://app.clickup.com/t/86bd1cepr)
User story: [Date Picker & Date Range - Apply redesign](https://app.clickup.com/t/86bcehmc2)

### TC01 - Storybook - Verify clicking a day commits the value and closes the panel

#### Preconditions

- The Storybook is accessible.

#### Steps

1. Open the \`DatePicker\` single story.
2. Click any day.
3. Observe: the input value and the panel.

#### Expected Result

The clicked day is committed and the panel closes.

### TC02 - Storybook - Verify typing an invalid date shows an error state

#### Preconditions

- The Storybook is accessible.

#### Steps

1. Type \`13/45/2026\` in the input.

#### Expected Result

The input shows an error state and the value is not committed.
`;

test("ticket references are normalized to the task id", () => {
  assert.equal(parseTicket("86bd2jj2t"), "86bd2jj2t");
  assert.equal(parseTicket("DEV-1234"), "DEV-1234");
  assert.equal(parseTicket("https://app.clickup.com/t/86bd2jj2t"), "86bd2jj2t");
  assert.equal(parseTicket("https://app.clickup.com/t/31625254/86bd2jj2t"), "86bd2jj2t");
  assert.equal(parseTicket("https://app.clickup.com/t/86bd2jj2t?comment=1"), "86bd2jj2t");
  assert.equal(parseTicket(""), null);
  assert.equal(parseTicket("not a ticket"), null);
  assert.equal(parseTicket("hola"), null);
  assert.equal(parseTicket("abcdefgh"), null); // no digit
  assert.equal(parseTicket("901413246506"), null); // digits only: a list id, not a task
  assert.equal(parseTicket("https://example.com/t/86bd2jj2t"), null);
});

test("list references are normalized to the list id", () => {
  assert.equal(parseList("901413246506"), "901413246506");
  assert.equal(parseList("https://app.clickup.com/31625254/v/l/6-901413246506-1"), "901413246506");
  assert.equal(parseList("https://app.clickup.com/31625254/v/li/901413246506"), "901413246506");
  assert.equal(parseList("https://app.clickup.com/t/86bd2jj2t"), null);
  assert.equal(parseList("hola"), null);
});

test("well-formed preview passes and maps to ClickUp payloads", () => {
  const { errors, plan, cases } = checkPreview(GOOD);
  assert.deepEqual(errors, []);
  assert.equal(plan.name, "Date Picker - Slice 1: Single Date Picker in Storybook");
  assert.match(plan.markdown_description, /^Source slice: .*\n\nUser story: /);
  assert.equal(cases.length, 2);
  assert.equal(cases[0].name, "TC01 - Storybook - Verify clicking a day commits the value and closes the panel");
  assert.match(cases[0].markdown_description, /^## Preconditions\n\n- .*\n\n## Steps\n\n1\. .*\n2\. .*\n3\. .*\n\n## Expected Result\n\nThe clicked/);
});

test("header lines are required", () => {
  assert.ok(checkPreview(GOOD.replace("## Test Plan: ", "## Plan: ")).errors.length > 0);
  assert.ok(checkPreview(GOOD.replace(/^User story: .*\n/m, "")).errors.length > 0);
  assert.ok(checkPreview(GOOD.replace("Source slice:", "Source thing:")).errors.length > 0);
  // ClickUp slice titles carry brackets in the link text
  assert.deepEqual(checkPreview(GOOD.replace("[Slice 1: Pick", "[[SLICE 1/6] Pick")).errors, []);
});

test("TC numbering is consecutive from --start", () => {
  assert.ok(checkPreview(GOOD.replace("TC02", "TC03")).errors.some((e) => e.includes("consecutive")));
  assert.ok(checkPreview(GOOD.replace("TC01", "TC1")).errors.length > 0);
  const continued = GOOD.replace("TC01", "TC16").replace("TC02", "TC17");
  assert.deepEqual(checkPreview(continued, 16).errors, []);
  assert.ok(checkPreview(continued).errors.length > 0);
});

test("title format and duplicates are enforced", () => {
  assert.ok(checkPreview(GOOD.replace("Storybook - Verify clicking", "Storybook - Check clicking")).errors.length > 0);
  assert.ok(checkPreview(GOOD.replace("TC01 - Storybook", "TC01 - Story - book")).errors.some((e) => e.includes("area")));
  const dup = GOOD.replace("Verify typing an invalid date shows an error state", "Verify clicking a day commits the value and closes the panel");
  assert.ok(checkPreview(dup).errors.some((e) => e.includes("repeated")));
});

test("sections are required, ordered and well formed", () => {
  assert.ok(checkPreview(GOOD.replace("#### Steps\n\n1. Type", "1. Type")).errors.length > 0); // missing Steps
  assert.ok(checkPreview(GOOD.replace("#### Expected Result\n\nThe input shows an error state and the value is not committed.\n", "")).errors.some((e) => e.includes("missing")));
  assert.ok(checkPreview(GOOD.replace("- The Storybook is accessible.\n\n#### Steps\n\n1. Open", "#### Steps\n\n1. Open")).errors.some((e) => e.includes("empty")));
  assert.ok(checkPreview(GOOD.replace("2. Click", "4. Click")).errors.some((e) => e.includes("out of order")));
  assert.ok(checkPreview(GOOD.replace("- The Storybook is accessible.", "The Storybook is accessible.")).errors.length > 0);
});

test("headings after a TC section fail instead of leaking into the payload", () => {
  const leaked = GOOD + "\n## Open questions\n\n- mobile?\n";
  assert.ok(checkPreview(leaked).errors.some((e) => e.includes("unexpected heading")));
});

test("Expected Result keeps its paragraphs", () => {
  const two = GOOD.replace("The clicked day is committed and the panel closes.", "The clicked day is committed.\n\nThe panel closes.");
  const { errors, cases } = checkPreview(two);
  assert.deepEqual(errors, []);
  assert.match(cases[0].markdown_description, /The clicked day is committed\.\n\nThe panel closes\.$/);
});

test("no test cases or stray lines fail", () => {
  assert.ok(checkPreview(GOOD.split("### TC01")[0]).errors.some((e) => e.includes("no test cases")));
  assert.ok(checkPreview(GOOD.replace("### TC01", "Some note\n\n### TC01")).errors.length > 0);
});
