#!/usr/bin/env node
/**
 * Deterministic checks for the test-case-generation skill.
 *
 * `--ticket <id|url>`:
 *   Validates a ClickUp task reference and prints `PASS <task id>`.
 *   Accepts a bare id (`86bd2jj2t`), a custom id (`DEV-1234`) or a task URL; digits-only ids are lists
 *   (`https://app.clickup.com/t/<id>` or `/t/<workspace>/<id>`).
 *
 * `--list <id|url>`:
 *   Validates a ClickUp list reference and prints `PASS <list id>`. Accepts a digits-only id,
 *   `…/v/li/<id>` or a list view link `…/v/l/<view>-<id>-<n>`.
 *
 * Preview (default):
 *   Checks the rendered Test Plan preview before it is shown or created:
 *   - `## Test Plan: <name>`, then `Source <kind>: [title](url)`, then `User story: [title](url)`
 *   - at least one `### TCNN - <Area> - Verify <behaviour>`, numbered consecutively from `--start`
 *   - each TC with `#### Preconditions` (bullets), `#### Steps` (1. 2. 3.)
 *     and `#### Expected Result` (text), in that order, none empty
 *   - no repeated TC title, no stray line before the first TC, and no heading inside a TC
 *     (plain text after the last `#### Expected Result` is read as another paragraph of it)
 *   `--json` prints, on PASS, the exact ClickUp names and markdown descriptions to create.
 *
 * Writes nothing. Uses Node built-ins only.
 *
 * Usage:
 *   node check-test-cases.mjs --ticket <id|url>
 *   node check-test-cases.mjs --list <id|url>
 *   node check-test-cases.mjs [--start <n>] [--json] <preview.md|->
 *
 * Exit codes: 0 pass · 1 differences found · 2 usage.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EXIT_FAIL = 1;
export const EXIT_USAGE = 2;

// Native ids are lowercase alphanumeric with a digit and a letter (`86bd2jj2t`); custom ids look like `DEV-1234`.
// Digits-only ids are rejected: in ClickUp those are lists, not tasks.
const ID = "((?=[a-z0-9]*[0-9])(?=[a-z0-9]*[a-z])[a-z0-9]{6,12}|[A-Z][A-Z0-9]*-[0-9]+)";
const TICKET_URL = new RegExp(
  `^https?://app\\.clickup\\.com/t/(?:[0-9]+/)?${ID}(?:[/?#]\\S*)?$`,
);
const TICKET_ID = new RegExp(`^${ID}$`);

/**
 * @param {string} value a ClickUp task id or URL
 * @returns {string|null} the task id, or null when the value is not a task reference
 */
export function parseTicket(value) {
  const v = (value ?? "").trim();
  const m = TICKET_URL.exec(v) ?? TICKET_ID.exec(v);
  return m ? m[1] : null;
}

const LIST_URL = /^https?:\/\/app\.clickup\.com\/[0-9]+\/v\/(?:li\/([0-9]+)|l\/[0-9a-z]+-([0-9]+)-[0-9]+)(?:[/?#]\S*)?$/;

/**
 * @param {string} value a ClickUp list id, list link (`…/v/li/<id>`) or list view link (`…/v/l/6-<id>-1`)
 * @returns {string|null} the list id, or null when the value is not a list reference
 */
export function parseList(value) {
  const v = (value ?? "").trim();
  if (/^[0-9]+$/.test(v)) return v;
  const m = LIST_URL.exec(v);
  return m ? (m[1] ?? m[2]) : null;
}

const PLAN =/^## Test Plan: (\S.*)$/;
// Titles may hold brackets (`[SLICE 1/3] …`), so the text is greedy up to the last `](`.
const LINK = "\\[(.+)\\]\\((https://app\\.clickup\\.com/t/[^\\s)]+)\\)";
const SOURCE = new RegExp(`^Source (requirement|story|slice|task|bug): ${LINK}$`);
const STORY = new RegExp(`^User story: ${LINK}$`);
const TC = /^### TC(\d{2,}) - (.+?) - (Verify \S.*)$/;
const SECTIONS = ["Preconditions", "Steps", "Expected Result"];
const BULLET = /^- \S/;
const STEP = /^(\d+)\. \S/;

/**
 * @param {string} text the rendered preview
 * @param {number} start the number the first TC must carry
 * @returns {{ errors: string[], plan: object|null, cases: object[] }}
 */
export function checkPreview(text, start = 1) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l !== "");
  const errors = [];
  const at = (l) => `"${l.slice(0, 70)}"`;

  const plan = PLAN.exec(lines[0] ?? "");
  if (!plan) errors.push(`line 1: expected "## Test Plan: <name>", got ${at(lines[0] ?? "")}`);
  if (!SOURCE.test(lines[1] ?? ""))
    errors.push(`line 2: expected "Source <requirement|story|slice|task|bug>: [title](https://app.clickup.com/t/<id>)", got ${at(lines[1] ?? "")}`);
  if (!STORY.test(lines[2] ?? ""))
    errors.push(`line 3: expected "User story: [title](https://app.clickup.com/t/<id>)", got ${at(lines[2] ?? "")}`);

  const cases = [];
  let tc = null;
  let section = -1;
  const close = () => {
    if (!tc) return;
    if (section !== SECTIONS.length - 1)
      errors.push(`TC${tc.num}: missing "#### ${SECTIONS.slice(section + 1).join('", "#### ')}"`);
    SECTIONS.forEach((s) => {
      if (tc.body[s] && tc.body[s].length === 0) errors.push(`TC${tc.num}: "${s}" is empty`);
    });
    cases.push(tc);
  };

  for (const line of lines.slice(3)) {
    const head = TC.exec(line);
    if (head) {
      close();
      const [, num, area, title] = head;
      if (/ - /.test(area)) errors.push(`${at(line)}: area must not contain " - "`);
      tc = { num, area, title, body: {} };
      section = -1;
      continue;
    }
    if (!tc) {
      errors.push(`unexpected line ${at(line)} before the first TC`);
      continue;
    }
    const sec = /^#### (.+)$/.exec(line);
    if (sec) {
      const idx = SECTIONS.indexOf(sec[1]);
      if (idx !== section + 1)
        errors.push(`TC${tc.num}: expected "#### ${SECTIONS[section + 1] ?? "(none)"}", got ${at(line)}`);
      else {
        section = idx;
        tc.body[SECTIONS[idx]] = [];
      }
      continue;
    }
    if (section === -1) {
      errors.push(`TC${tc.num}: unexpected line ${at(line)} before "#### Preconditions"`);
      continue;
    }
    if (/^#{1,3} /.test(line)) {
      errors.push(`TC${tc.num}: unexpected heading inside "${SECTIONS[section]}": ${at(line)}`);
      continue;
    }
    const name = SECTIONS[section];
    const body = tc.body[name];
    if (name === "Preconditions" && !BULLET.test(line))
      errors.push(`TC${tc.num}: precondition must be a "- " bullet, got ${at(line)}`);
    if (name === "Steps") {
      const m = STEP.exec(line);
      if (!m) errors.push(`TC${tc.num}: step must look like "1. …", got ${at(line)}`);
      else if (Number(m[1]) !== body.length + 1)
        errors.push(`TC${tc.num}: step ${m[1]} out of order (expected ${body.length + 1})`);
    }
    body.push(line);
  }
  close();

  if (cases.length === 0) errors.push("no test cases: add at least one \"### TCNN - <Area> - Verify …\"");
  const titles = new Set();
  cases.forEach((c, i) => {
    const expected = start + i;
    if (Number(c.num) !== expected)
      errors.push(`TC${c.num}: expected TC${String(expected).padStart(2, "0")} (consecutive from ${start})`);
    if (c.num.length > 2 && c.num.startsWith("0")) errors.push(`TC${c.num}: use two digits below 100`);
    const key = c.title.toLowerCase();
    if (titles.has(key)) errors.push(`TC${c.num}: title repeated "${c.title}"`);
    titles.add(key);
  });

  return {
    errors,
    plan: plan && {
      name: plan[1],
      markdown_description: [lines[1], lines[2]].join("\n\n"),
    },
    cases: cases.map((c) => ({
      name: `TC${c.num} - ${c.area} - ${c.title}`,
      // Blank lines are dropped on read: list sections rejoin with "\n", Expected Result paragraphs with "\n\n".
      markdown_description: SECTIONS.map(
        (s) => `## ${s}\n\n${(c.body[s] ?? []).join(s === "Expected Result" ? "\n\n" : "\n")}`,
      ).join("\n\n"),
    })),
  };
}

/**
 * @param {string[]} argv
 * @returns {number} 0 pass, `EXIT_FAIL` differences found, `EXIT_USAGE` bad arguments or unreadable file.
 */
export function main(argv) {
  const usage = () => {
    process.stderr.write(
      "Usage: node check-test-cases.mjs --ticket <id|url>\n       node check-test-cases.mjs --list <id|url>\n       node check-test-cases.mjs [--start <n>] [--json] <preview.md|->\n",
    );
    return EXIT_USAGE;
  };

  if (argv[0] === "--list") {
    if (argv.length !== 2) return usage();
    const id = parseList(argv[1]);
    if (!id) {
      process.stdout.write(`FAIL (1)\n- "${argv[1]}" is not a ClickUp list id or list link\n`);
      return EXIT_FAIL;
    }
    process.stdout.write(`PASS ${id}\n`);
    return 0;
  }

  if (argv[0] === "--ticket") {
    if (argv.length !== 2) return usage();
    const id = parseTicket(argv[1]);
    if (!id) {
      process.stdout.write(`FAIL (1)\n- "${argv[1]}" is not a ClickUp task id or https://app.clickup.com/t/… URL\n`);
      return EXIT_FAIL;
    }
    process.stdout.write(`PASS ${id}\n`);
    return 0;
  }

  let start = 1;
  let json = false;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") json = true;
    else if (argv[i] === "--start") {
      start = Number(argv[++i]);
      if (!Number.isInteger(start) || start < 1) return usage();
    } else rest.push(argv[i]);
  }
  if (rest.length !== 1) return usage();

  let text;
  try {
    // File descriptor 0 is stdin: the skill pipes the preview in through a heredoc.
    text = readFileSync(rest[0] === "-" ? 0 : rest[0], "utf8");
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return EXIT_USAGE;
  }
  const { errors, plan, cases } = checkPreview(text, start);
  if (errors.length === 0) {
    process.stdout.write(json ? `${JSON.stringify({ plan, cases }, null, 2)}\n` : "PASS\n");
    return 0;
  }
  process.stdout.write(`FAIL (${errors.length})\n${errors.map((e) => `- ${e}`).join("\n")}\n`);
  return EXIT_FAIL;
}

// Run only when executed directly, not when imported (e.g. by a test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
