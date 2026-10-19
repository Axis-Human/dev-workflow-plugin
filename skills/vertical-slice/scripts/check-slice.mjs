#!/usr/bin/env node
/**
 * Structure check for one rendered vertical slice.
 *
 * Compares the slice against templates/clickup/vertical_slice_template.md so
 * that every slice has the same structure on every run:
 *   - the title format and slice numbering
 *   - every heading, field label and fixed line, in the template's order
 *     (the Frontend/Backend blocks follow the slice's Scope)
 *   - the fixed-choice field values and the rules that tie fields together
 *   - no template placeholder left behind
 *   - matching A-IDs in "Unconfirmed contract points" and "Contract confirmations"
 *   - the technical prompt block and its fixed line prefixes
 *
 * Writes nothing. Prints "PASS" or the list of differences.
 * Uses Node built-ins only.
 *
 * Usage:
 *   node check-slice.mjs --template <path> [--n <n> --total <N>] <slice.md|->
 *
 * Exit codes: 0 pass · 1 differences found · 2 usage.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EXIT_FAIL = 1;
export const EXIT_USAGE = 2;

// --- Line shapes ---------------------------------------------------------------

/** `# [SLICE n/N] <title>`; captures n and N. */
const TITLE = /^# \[SLICE (\d+)\/(\d+)\] \S.*$/;
/** `#`, `##` or `###` heading; captures the hashes and the heading text. */
const HEADING = /^(#{1,3}) (.+)$/;
/** `- **Label:** value` field line; captures the label and its value. */
const LABEL = /^\s*- \*\*([^*]+):\*\*\s?(.*)$/;
/** Template placeholder such as `{actor}`: single-line, no nested braces. */
const PLACEHOLDER = /\{[^{}\n]+\}/g;
/** Opening or closing code fence. */
const FENCE = /^\s*```/;
/** `Word:` or `Two words:` at the start of a technical prompt line (e.g. `Scope:`). */
const PROMPT_PREFIX = /^([A-Z][A-Za-z ]*?):(?: |$)/;
/** Fixed part of a Definition of Done checkbox, e.g. `- [ ] Deployable: `. */
const CHECKBOX_PREFIX = /^- \[ \] [^:{]+: /;
/** The one-line "Vertical slice" user story. */
const VERTICAL_SLICE = /^As an? \*\*.+\*\*, I can \*\*.+\*\* \[happy path\]\.$/;
/** Start of the technical prompt's first line, which names the slice. */
const PROMPT_FIRST_LINE = 'Implement "';
/** The ```text block under this heading is the technical prompt. */
const PROMPT_HEADING = "## Technical prompt";

// --- Allowed field values ------------------------------------------------------
// These must stay in step with templates/clickup/vertical_slice_template.md.

const SCOPES = ["Full-stack", "Frontend only", "Backend only"];
const SOURCES = ["Stubbed contract, then real", "Real contract", "N/A"];
const CONFIDENCE = ["High", "Medium", "Low"];
const ACTIVE_DAYS = "≤ 2 working days (hard limit)";
const FLAG_REMOVAL = "Flag owner removes at go-live.";
const CONTRACT_POINTS_OPEN =
  "every point confirmed and aligned, no `ASSUMPTION(` markers left";
const NO_POINTS_CONFIRMATIONS = "N/A: no unconfirmed points";
/** One acceptance criterion in Given/When/Then form. */
const GWT = /^- \*\*Given\*\* .+ \*\*When\*\* .+ \*\*Then\*\* .+$/;
/** One unconfirmed contract point; captures its A-number. */
const POINT =
  /^- \*\*A(\d+)\*\* `[^`]+`: assumed .+\. Confirms: (Backend|Frontend) \(.+\)$/;
/** The confirmation row for one contract point; captures its A-number. */
const CONFIRMATION =
  /^- \*\*A(\d+)\*\* Status: (Pending|Confirmed as assumed|Corrected: .+) · Confirmed by: .+ · Aligned in code: (No|Yes)$/;

/**
 * One structural line of a slice or of the template.
 *
 * @typedef {object} Token
 * @property {'title' | 'heading' | 'label' | 'line' | 'prompt'} kind
 *   `title` is the `#` heading, `heading` a `##`/`###` heading, `label` a
 *   `- **Label:** value` field, `prompt` a line of the technical prompt block,
 *   and `line` any other non-empty line.
 * @property {string} text Whole line; for a `label`, the label name only.
 * @property {string | null} section The enclosing `## …` heading line, or null before the first one.
 * @property {string | null} block The enclosing `### …` heading text (without hashes), reset by each `##`.
 * @property {string} [value] `label` only: the trimmed text after the label.
 * @property {string} [line] `label` only: the raw line, used by the placeholder check.
 */

/**
 * Splits markdown into structure tokens. Lines inside code fences are skipped,
 * except the technical prompt's ```text block, whose lines are returned as
 * `prompt` lines.
 *
 * @param {string} markdown Slice or template markdown.
 * @returns {Token[]} Tokens in document order. Blank lines and `---` rules are dropped.
 */
export function tokenize(markdown) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let inFence = false;
  let inPrompt = false;
  // True from the "## Technical prompt" heading until the next heading of any level.
  let afterPromptHeading = false;
  let section = null;
  let block = null;

  for (const line of lines) {
    if (FENCE.test(line)) {
      // Only a ```text fence opened under the prompt heading holds the prompt;
      // every other fenced block (examples, snippets) is ignored.
      if (!inFence && afterPromptHeading && /^\s*```text\s*$/.test(line))
        inPrompt = true;
      if (inFence) inPrompt = false;
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      if (inPrompt) out.push({ kind: "prompt", text: line, section, block });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (level === 2) {
        section = line;
        block = null;
      }
      if (level === 3) block = heading[2];
      afterPromptHeading = line === PROMPT_HEADING;
      out.push({
        kind: level === 1 ? "title" : "heading",
        text: line,
        section,
        block,
      });
      continue;
    }

    const label = LABEL.exec(line);
    if (label) {
      out.push({
        kind: "label",
        text: label[1],
        value: label[2].trim(),
        section,
        block,
        line,
      });
      continue;
    }

    if (line.trim() && line.trim() !== "---")
      out.push({ kind: "line", text: line, section, block });
  }
  return out;
}

/** Technical prompt line prefix → the Technical details block it belongs to. */
const PROMPT_BLOCK_FOR = { "Frontend:": "Frontend", "Backend:": "Backend" };

/**
 * What a slice built from the template must contain, and in what order.
 *
 * Each structure item is a string: `title`, a heading line, `label:<name>`,
 * `line:<fixed text or checkbox prefix>` or `prompt:<fixed text or prefix>`.
 * Template lines that contain a `{placeholder}` and are not checkboxes are
 * free text, so they are left out.
 *
 * @param {Token[]} templateTokens Tokens of the template.
 * @param {object} options
 * @param {string | undefined} options.scope The slice's "Scope" value. A
 *   single-sided scope drops the other side's Technical details block and prompt line.
 * @param {boolean} options.hasPoints Whether the slice lists contract points.
 *   Without any, the "Confirmer" label is not expected.
 * @returns {{
 *   structure: string[],
 *   fixedLines: Set<string>,
 *   linePrefixes: string[],
 *   promptPrefixes: string[],
 *   excludedPromptPrefixes: string[],
 * }} The ordered structure, plus the matchers `actualStructure` needs to map
 *   the slice's lines onto the same items.
 */
export function expectedStructure(templateTokens, { scope, hasPoints }) {
  // A single-sided slice has no Technical details block for the side it does
  // not build, so that side's template lines are dropped. Full-stack drops none.
  const isFrontendOnly = scope === "Frontend only";
  const isBackendOnly = scope === "Backend only";
  const frontendIfBackendOnly = isBackendOnly ? "Frontend" : null;
  const dropBlock = isFrontendOnly ? "Backend" : frontendIfBackendOnly;

  const keep = (t) => {
    if (
      dropBlock &&
      t.block === dropBlock &&
      t.section === "## Technical details"
    )
      return false;
    if (!hasPoints && t.kind === "label" && t.text === "Confirmer")
      return false;
    return true;
  };

  const structure = [];
  const fixedLines = new Set();
  const linePrefixes = [];
  const promptPrefixes = [];
  // Prefixes of the dropped side (e.g. `Backend:` in a frontend-only slice).
  // Kept so `actualStructure` still reports them, and the diff flags them as extra.
  const excludedPromptPrefixes = [];

  for (const t of templateTokens.filter(keep)) {
    if (t.kind === "title" || t.kind === "heading")
      structure.push(t.kind === "title" ? "title" : t.text);
    else if (t.kind === "label") structure.push(`label:${t.text}`);
    // A line without placeholders must appear in the slice word for word.
    else if (t.kind === "line" && !t.text.includes("{")) {
      structure.push(`line:${t.text}`);
      fixedLines.add(t.text);
      // A checkbox with a placeholder: only the part before the value is fixed.
    } else if (t.kind === "line" && CHECKBOX_PREFIX.test(t.text)) {
      const prefix = CHECKBOX_PREFIX.exec(t.text)[0];
      structure.push(`line:${prefix}`);
      linePrefixes.push(prefix);
    } else if (t.kind === "prompt") {
      const prefix = t.text.startsWith(PROMPT_FIRST_LINE)
        ? PROMPT_FIRST_LINE
        : PROMPT_PREFIX.exec(t.text)?.[0].trim();
      if (prefix) {
        if (PROMPT_BLOCK_FOR[prefix] === dropBlock) {
          excludedPromptPrefixes.push(prefix);
          continue;
        }
        structure.push(`prompt:${prefix}`);
        promptPrefixes.push(prefix);
        // Fixed prompt sentences count; `-` bullet lists are free text.
      } else if (
        t.text.trim() &&
        !t.text.includes("{") &&
        !t.text.startsWith("-")
      ) {
        structure.push(`prompt:${t.text}`);
        fixedLines.add(t.text);
      }
    }
  }
  return {
    structure,
    fixedLines,
    linePrefixes,
    promptPrefixes,
    excludedPromptPrefixes,
  };
}

/**
 * The slice's structure in the same item format as `expectedStructure`.
 * Lines that match no fixed line or prefix are the slice's own content and
 * are skipped.
 *
 * @param {Token[]} sliceTokens Tokens of the rendered slice.
 * @param {ReturnType<typeof expectedStructure>} expected The matchers from `expectedStructure`.
 * @returns {string[]} Structure items in document order.
 */
function actualStructure(
  sliceTokens,
  { fixedLines, linePrefixes, promptPrefixes, excludedPromptPrefixes },
) {
  const structure = [];

  for (const t of sliceTokens) {
    if (t.kind === "title") structure.push("title");
    else if (t.kind === "heading") structure.push(t.text);
    else if (t.kind === "label") structure.push(`label:${t.text}`);
    else if (t.kind === "line" && fixedLines.has(t.text))
      structure.push(`line:${t.text}`);
    else if (
      t.kind === "line" &&
      linePrefixes.some((p) => t.text.startsWith(p))
    )
      structure.push(`line:${linePrefixes.find((p) => t.text.startsWith(p))}`);
    else if (t.kind === "prompt") {
      const prefix =
        promptPrefixes.find((p) => t.text.startsWith(p)) ??
        excludedPromptPrefixes.find((p) => t.text.startsWith(p));
      if (prefix) structure.push(`prompt:${prefix}`);
      else if (fixedLines.has(t.text)) structure.push(`prompt:${t.text}`);
    }
  }
  return structure;
}

/**
 * Compares two structures item by item.
 *
 * @param {string[]} expected Structure from `expectedStructure`.
 * @param {string[]} actual Structure from `actualStructure`.
 * @returns {string[]} At most one error. A missing or extra item shifts every
 *   item after it, so later differences would only be noise.
 */
function diffStructure(expected, actual) {
  const errors = [];
  const length = Math.max(expected.length, actual.length);

  for (let i = 0; i < length; i++) {
    if (expected[i] === actual[i]) continue;
    errors.push(
      `Structure differs at item ${i + 1}: expected ${JSON.stringify(expected[i] ?? "(end)")}, found ${JSON.stringify(actual[i] ?? "(end)")}.`,
    );
    break;
  }
  return errors;
}

/**
 * Content lines and labels under one `## …` section.
 *
 * @param {Token[]} tokens
 * @param {string} section The full heading line, e.g. `## Vertical slice`.
 * @returns {Token[]}
 */
const sectionLines = (tokens, section) =>
  tokens.filter(
    (t) => t.section === section && (t.kind === "line" || t.kind === "label"),
  );

/**
 * Value and cross-field rules: fixed-choice fields hold an allowed value, and
 * fields that depend on each other agree (e.g. a flag needs a removal note).
 *
 * @param {Token[]} tokens Tokens of the rendered slice.
 * @param {object} options
 * @param {number | null} options.n Expected slice number; null checks only that the title is self-consistent.
 * @param {number | null} options.total Expected slice count; null works the same way.
 * @returns {string[]} One message per broken rule; empty when all hold.
 */
export function checkValues(tokens, { n, total }) {
  const errors = [];

  // Value of the first `- **<label>:**` field, or undefined when it is missing.
  const value = (label) =>
    tokens.find((t) => t.kind === "label" && t.text === label)?.value;
  // Text after `- [ ] <name>: ` in the Definition of Done, or undefined.
  const checkbox = (name) =>
    tokens
      .find((t) => t.kind === "line" && t.text.startsWith(`- [ ] ${name}: `))
      ?.text.slice(`- [ ] ${name}: `.length);
  const fail = (message) => errors.push(message);

  // Title and numbering: the "# [SLICE n/N]" title, the "Slice" field and the
  // expected n/N passed on the command line must all agree, so slices of one
  // story stay in a clear implementation order.
  const title = tokens.find((t) => t.kind === "title");
  const titleMatch = title && TITLE.exec(title.text);

  if (!titleMatch) fail('Title must match "# [SLICE n/N] <title>".');

  const [sliceN, sliceTotal] = titleMatch
    ? [Number(titleMatch[1]), Number(titleMatch[2])]
    : [];

  if (titleMatch && (sliceN < 1 || sliceN > sliceTotal))
    fail("Slice number must be between 1 and N.");
  if (titleMatch && n && sliceN !== n)
    fail(`Slice number is ${sliceN}, expected ${n}.`);
  if (titleMatch && total && sliceTotal !== total)
    fail(`Slice total is ${sliceTotal}, expected ${total}.`);
  if (
    titleMatch &&
    value("Slice") !== `${sliceN} of ${sliceTotal} (implementation order)`
  )
    fail(
      `"Slice" must read "${sliceN} of ${sliceTotal} (implementation order)".`,
    );

  // Scope and counterpart. A single-sided slice is one half of full-stack work;
  // its counterpart is the slice that delivers the other half.
  const scope = value("Scope");
  if (!SCOPES.includes(scope))
    fail(`"Scope" must be one of: ${SCOPES.join(" | ")}.`);
  const singleSided = scope === "Frontend only" || scope === "Backend only";

  const counterpart = value("Counterpart") ?? "";
  // Classify the value into one of the four allowed forms; null means it
  // matches none. Each constant falls back to the one above it, so every
  // ternary is a single level.
  const isFullStack = counterpart === "N/A: full-stack";
  const isNotNeeded = /^Not needed: no (backend|frontend) change$/.test(
    counterpart,
  );
  const isMissing = counterpart === "⚠ none found";
  const isFound = /^\S+ — .+$/.test(counterpart);
  const kindIfFound = isFound ? "found" : null;
  const kindIfMissing = isMissing ? "missing" : kindIfFound;
  const kindIfNotNeeded = isNotNeeded ? "not-needed" : kindIfMissing;
  const counterpartKind = isFullStack ? "full-stack" : kindIfNotNeeded;

  if (!counterpartKind)
    fail(
      '"Counterpart" must be "<ID> — <title>", "⚠ none found", "Not needed: no backend|frontend change" or "N/A: full-stack".',
    );
  if (
    scope === "Full-stack" &&
    counterpartKind &&
    counterpartKind !== "full-stack"
  )
    fail('A full-stack slice must have "Counterpart: N/A: full-stack".');
  if (singleSided && counterpartKind === "full-stack")
    fail('A single-sided slice cannot have "Counterpart: N/A: full-stack".');
  if (
    scope === "Frontend only" &&
    counterpart === "Not needed: no frontend change"
  )
    fail('A frontend-only slice can only be "Not needed: no backend change".');
  if (
    scope === "Backend only" &&
    counterpart === "Not needed: no backend change"
  )
    fail('A backend-only slice can only be "Not needed: no frontend change".');

  // Feature flag, removal note and data source: a flag is only valid with a
  // removal plan (so flags do not linger), and only a full-stack slice owns the
  // data source, since a single-sided slice consumes the other half's contract.
  const flag = value("Flag required") ?? "";
  const flagged = /^yes: `[^`]+`$/.test(flag);
  if (!flagged && flag !== "no")
    fail('"Flag required" must be "yes: `<flag name>`" or "no".');
  const removal = value("Removal");
  if (flagged && removal !== FLAG_REMOVAL)
    fail(`"Removal" must be "${FLAG_REMOVAL}" when a flag is required.`);
  if (flag === "no" && removal !== "N/A")
    fail('"Removal" must be "N/A" when no flag is required.');

  const source = value("Source");
  if (!SOURCES.includes(source))
    fail(`"Source" must be one of: ${SOURCES.join(" | ")}.`);
  if (singleSided && source !== "N/A")
    fail('A single-sided slice must have "Source: N/A".');
  if (scope === "Full-stack" && source === "N/A")
    fail("A full-stack slice must state its data source.");

  // Definition of Done checkboxes whose wording follows from the fields above.
  const deployable = checkbox("Deployable");
  if (flagged && deployable !== "the flag hides incomplete behaviour")
    fail(
      '"Deployable" must be "the flag hides incomplete behaviour" when a flag is required.',
    );
  if (flag === "no" && deployable !== "no incomplete behaviour is reachable")
    fail(
      '"Deployable" must be "no incomplete behaviour is reachable" when no flag is required.',
    );

  const qaReady = checkbox("QA-ready") ?? "";
  // QA can test the slice by itself unless it is waiting on its other half.
  const alone =
    counterpartKind === "full-stack" || counterpartKind === "not-needed";
  if (alone && qaReady !== "this slice alone")
    fail('"QA-ready" must be "this slice alone" for this counterpart.');
  if (!alone && !/^only when counterpart .+ is complete$/.test(qaReady))
    fail(
      '"QA-ready" must be "only when counterpart <ID | still to be created> is complete" for half of full-stack work.',
    );

  // Sizing. The file limits match slice-baseline.mjs: 24 files, or up to 45
  // when the change is shallow (moves, renames, small edits per file).
  if (value("Active days") !== ACTIVE_DAYS)
    fail(`"Active days" must read "${ACTIVE_DAYS}".`);
  if (!/^\d+ \((shallow|deep)\)$/.test(value("Files (est.)") ?? ""))
    fail('"Files (est.)" must be "<n> (shallow|deep)".');
  const files = Number((value("Files (est.)") ?? "").split(" ")[0]);
  if (
    files > 45 ||
    (files > 24 && !(value("Files (est.)") ?? "").includes("shallow"))
  )
    fail(
      "Over 24 files is allowed only for shallow changes, and never over 45.",
    );
  if (
    !/^\d+(\.\d+)? working days \(active \+ typical review\/QA wait\)$/.test(
      value("Expected lead time") ?? "",
    )
  )
    fail(
      '"Expected lead time" must be "<n.n> working days (active + typical review/QA wait)".',
    );
  if (!CONFIDENCE.includes(value("Confidence")))
    fail(`"Confidence" must be one of: ${CONFIDENCE.join(" | ")}.`);

  // Story and acceptance criteria: the story must be one observable-behaviour
  // sentence and every criterion Given/When/Then, so QA can test each directly.
  const story = sectionLines(tokens, "## Vertical slice");
  if (story.length !== 1 || !VERTICAL_SLICE.test(story[0].text))
    fail(
      '"Vertical slice" must be one line: "As a **<actor>**, I can **<observable behaviour>** [happy path]."',
    );

  const acLines = sectionLines(tokens, "## Acceptance criteria (GWT)");
  if (!acLines.some((t) => GWT.test(t.text)))
    fail(
      'Acceptance criteria need at least one "- **Given** … **When** … **Then** …" line.',
    );
  for (const t of acLines.filter((t) => !GWT.test(t.text)))
    fail(
      `Acceptance criteria line is not in Given/When/Then form: "${t.text}".`,
    );

  // Contract points. Each assumption A<n> about the other side's contract needs
  // a matching confirmation row; "None" and "N/A: no unconfirmed points" pair up.
  const pointsLines = sectionLines(
    tokens,
    "## Unconfirmed contract points",
  ).filter((t) => t.kind === "line");
  const points = pointsLines
    .map((t) => POINT.exec(t.text))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const noPoints = pointsLines.length === 1 && pointsLines[0].text === "None";
  if (!noPoints && points.length !== pointsLines.length)
    fail(
      '"Unconfirmed contract points" must be "None" or only "- **A<n>** `<field>`: assumed … . Confirms: Backend|Frontend (…)" lines.',
    );
  // "Filled in by …" is the template's fixed instruction line, not a confirmation.
  const confirmationLines = sectionLines(
    tokens,
    "## Contract confirmations",
  ).filter((t) => t.kind === "line" && !t.text.startsWith("Filled in by"));
  const confirmations = confirmationLines
    .map((t) => CONFIRMATION.exec(t.text))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const noConfirmations =
    confirmationLines.length === 1 &&
    confirmationLines[0].text === NO_POINTS_CONFIRMATIONS;
  if (!noConfirmations && confirmations.length !== confirmationLines.length)
    fail(
      `"Contract confirmations" must be "${NO_POINTS_CONFIRMATIONS}" or only "- **A<n>** Status: … · Confirmed by: … · Aligned in code: No|Yes" lines.`,
    );
  if (noPoints !== noConfirmations)
    fail(
      `"Unconfirmed contract points: None" and "Contract confirmations: ${NO_POINTS_CONFIRMATIONS}" go together.`,
    );
  const sequential = (ids) => ids.every((id, i) => id === i + 1);
  if (!sequential(points))
    fail("Contract point IDs must run A1, A2, A3… in order.");
  if (points.join() !== confirmations.join())
    fail(
      `Contract point IDs (${points.map((p) => `A${p}`).join(", ") || "none"}) must match the confirmation IDs (${confirmations.map((p) => `A${p}`).join(", ") || "none"}).`,
    );
  const contractPoints = checkbox("Contract points");
  if (points.length && contractPoints !== CONTRACT_POINTS_OPEN)
    fail(
      `"Contract points" must read "${CONTRACT_POINTS_OPEN}" when there are contract points.`,
    );
  if (noPoints && contractPoints !== "N/A")
    fail('"Contract points" must be "N/A" when there are no contract points.');

  // Technical prompt: it must name the same slice and scope as the fields above.
  const prompt = tokens.filter((t) => t.kind === "prompt");
  if (prompt.length === 0)
    fail(
      'The technical prompt must be a ```text block under "## Technical prompt".',
    );
  if (
    titleMatch &&
    prompt.length &&
    !prompt[0].text.includes(`[SLICE ${sliceN}/${sliceTotal}]`)
  )
    fail(
      'The technical prompt\'s first line must name the same "[SLICE n/N]" as the title.',
    );
  const promptScope =
    prompt
      .find((t) => t.text.startsWith("Scope: "))
      ?.text.slice("Scope: ".length) ?? "";
  if (scope && !promptScope.startsWith(scope))
    fail(`The technical prompt's "Scope:" must start with "${scope}".`);
  return errors;
}

/**
 * Finds `{placeholder}` text that was never filled in.
 *
 * @param {string} sliceText The rendered slice.
 * @param {string} templateText The template it was rendered from.
 * @param {Token[]} sliceTokens Tokens of the rendered slice.
 * @returns {string[]} One message per placeholder found.
 */
export function checkPlaceholders(sliceText, templateText, sliceTokens) {
  const errors = [];
  // 1. Any of the template's own placeholders copied over verbatim, anywhere.
  const templatePlaceholders = new Set(templateText.match(PLACEHOLDER) ?? []);
  for (const placeholder of templatePlaceholders)
    if (sliceText.includes(placeholder))
      errors.push(`Template placeholder left in the slice: ${placeholder}`);
  // 2. Any other `{…}` in the slice's prose, such as one the renderer made up.
  // The prompt block and inline code are skipped: braces are normal in code.
  for (const t of sliceTokens.filter((t) => t.kind !== "prompt")) {
    const raw = t.line ?? t.text;
    for (const match of raw.replace(/`[^`]*`/g, "").match(PLACEHOLDER) ?? [])
      if (!templatePlaceholders.has(match))
        errors.push(`Unfilled placeholder: ${match}`);
  }
  return errors;
}

/**
 * All differences between a rendered slice and the template; empty when it passes.
 *
 * @param {object} input
 * @param {string} input.sliceText The rendered slice markdown.
 * @param {string} input.templateText Contents of vertical_slice_template.md.
 * @param {number | null} input.n Expected slice number, or null to skip that check.
 * @param {number | null} input.total Expected slice count, or null to skip that check.
 * @returns {string[]} Structure, value and placeholder errors, in that order.
 */
export function checkSlice({ sliceText, templateText, n, total }) {
  const sliceTokens = tokenize(sliceText);
  const templateTokens = tokenize(templateText);
  // The slice's own Scope and contract points decide which optional parts of
  // the template it must contain.
  const scope = sliceTokens.find(
    (t) => t.kind === "label" && t.text === "Scope",
  )?.value;
  const hasPoints = sliceTokens.some(
    (t) =>
      t.section === "## Unconfirmed contract points" &&
      t.kind === "line" &&
      POINT.test(t.text),
  );
  const expected = expectedStructure(templateTokens, { scope, hasPoints });
  return [
    ...diffStructure(
      expected.structure,
      actualStructure(sliceTokens, expected),
    ),
    ...checkValues(sliceTokens, { n, total }),
    ...checkPlaceholders(sliceText, templateText, sliceTokens),
  ];
}

/**
 * Parses the command line. See the file header for usage.
 *
 * @param {string[]} argv Arguments after `node check-slice.mjs`.
 * @returns {{ template: string, slice: string, n: number | null, total: number | null }}
 *   `slice` is a file path, or `-` for stdin.
 * @throws {Error} On an unknown flag, a bad number, or a missing template or slice.
 */
export function parseArgs(argv) {
  const opts = { template: null, slice: null, n: null, total: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--template") {
      opts.template = value;
      i++;
    } else if (flag === "--n" || flag === "--total") {
      if (!/^[1-9]\d*$/.test(value ?? ""))
        throw new Error(`${flag} needs a positive whole number`);
      opts[flag.slice(2)] = Number(value);
      i++;
    } else if (!opts.slice && (flag === "-" || !flag.startsWith("--"))) {
      opts.slice = flag;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (!opts.template || !opts.slice)
    throw new Error("--template and a slice file (or -) are required");
  return opts;
}

/**
 * Runs the check and prints the result. Returns the exit code instead of
 * exiting, so it can be called from a test.
 *
 * @param {string[]} argv Arguments after `node check-slice.mjs`.
 * @returns {number} 0 pass, `EXIT_FAIL` differences found, `EXIT_USAGE` bad arguments or unreadable file.
 */
export function main(argv) {
  let opts;
  let templateText;
  let sliceText;
  try {
    opts = parseArgs(argv);
    templateText = readFileSync(opts.template, "utf8");
    // File descriptor 0 is stdin: the skill pipes the slice in through a heredoc.
    sliceText = readFileSync(opts.slice === "-" ? 0 : opts.slice, "utf8");
  } catch (err) {
    process.stderr.write(
      `${err.message}\nSee the header of check-slice.mjs for usage.\n`,
    );
    return EXIT_USAGE;
  }
  const errors = checkSlice({
    sliceText,
    templateText,
    n: opts.n,
    total: opts.total,
  });
  if (errors.length === 0) {
    process.stdout.write("PASS\n");
    return 0;
  }
  process.stdout.write(
    `FAIL (${errors.length})\n${errors.map((e) => `- ${e}`).join("\n")}\n`,
  );
  return EXIT_FAIL;
}

// Run only when executed directly, not when imported (e.g. by a test).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(main(process.argv.slice(2)));
}
