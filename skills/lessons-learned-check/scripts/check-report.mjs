#!/usr/bin/env node
/**
 * Format check for the lessons-learned-check report.
 *
 * Makes every run show matches the same way:
 *   - the fixed heading, or the fixed "no matches" line on its own
 *   - only the "Alta similitud" and "Confianza baja" sections, in that order, none empty
 *   - each match as `- [title](https://app.clickup.com/t/<id>) — **0.NN** · Project · Category`
 *   - scores with two decimals, inside their section's band, highest first
 *   - each match followed by its "Por qué…" and "Recomendación" lines, in that order
 *   - no repeated lesson and no stray lines
 *
 * Writes nothing. Prints "PASS" or the list of differences.
 * Uses Node built-ins only.
 *
 * Usage:
 *   node check-report.mjs <report.md|->
 *
 * Exit codes: 0 pass · 1 differences found · 2 usage.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EXIT_FAIL = 1;
export const EXIT_USAGE = 2;

export const HEADING = "## Lecciones aprendidas similares";
export const NO_MATCHES =
  "No se encontraron lecciones similares en Lecciones aprendidas.";

/** Sections in their required order, with the score band each one accepts. */
const SECTIONS = [
  {
    heading: "### Alta similitud",
    reason: "Por qué es similar",
    accepts: (s) => s > 0.8,
    band: "> 0.80",
  },
  {
    heading: "### Confianza baja",
    reason: "Por qué podría ser similar",
    accepts: (s) => s > 0.7 && s <= 0.8,
    band: "> 0.70 and ≤ 0.80",
  },
];

/** `- [title](https://app.clickup.com/t/<id>) — **0.NN** · Project · Category` */
const ITEM =
  /^- \[([^\]]+)\]\((https:\/\/app\.clickup\.com\/t\/[A-Za-z0-9]+)\) — \*\*(0\.\d{2}|1\.00)\*\* · ([^·]+?) · ([^·]+?)$/;
/** `  - **Label:** text` */
const DETAIL = /^ {2}- \*\*([^*]+):\*\* (\S.*)$/;

/**
 * @param {string} text the rendered report
 * @returns {string[]} differences; empty when the report is well formed
 */
export function checkReport(text) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l !== "");
  if (lines.length === 0) return ["report is empty"];
  if (lines.length === 1 && lines[0] === NO_MATCHES) return [];
  if (lines.includes(NO_MATCHES))
    return [`"${NO_MATCHES}" must be the only line when it is used`];

  const errors = [];
  if (lines[0] !== HEADING)
    errors.push(`line 1: expected "${HEADING}", got "${lines[0]}"`);

  const seen = new Set();
  let sectionIdx = -1;
  let section = null;
  let items = 0;
  let prevScore = Infinity;
  let expectDetails = []; // detail labels still owed by the last item

  const closeSection = () => {
    if (section && items === 0) errors.push(`"${section.heading}" has no matches`);
  };
  const owed = (where) => {
    if (expectDetails.length)
      errors.push(`${where}: missing "${expectDetails.join('", "')}" line(s)`);
    expectDetails = [];
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const at = `"${line.slice(0, 60)}"`;

    const nextIdx = SECTIONS.findIndex((s) => s.heading === line);
    if (nextIdx !== -1) {
      owed(`before ${at}`);
      if (nextIdx <= sectionIdx) errors.push(`${at} is out of order or repeated`);
      closeSection();
      sectionIdx = nextIdx;
      section = SECTIONS[nextIdx];
      items = 0;
      prevScore = Infinity;
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      owed(`before ${at}`);
      if (!section) {
        errors.push(`${at} appears before any section heading`);
        continue;
      }
      items++;
      const [, , url, raw] = item;
      const score = Number(raw);
      if (!section.accepts(score))
        errors.push(`${at}: ${raw} is outside "${section.heading}" (${section.band})`);
      if (score > prevScore)
        errors.push(`${at}: not sorted by score (highest first)`);
      if (seen.has(url)) errors.push(`${at}: lesson listed twice`);
      seen.add(url);
      prevScore = score;
      expectDetails = [section.reason, "Recomendación"];
      continue;
    }

    const detail = DETAIL.exec(line);
    if (detail && expectDetails.length) {
      if (detail[1] !== expectDetails[0])
        errors.push(`${at}: expected "${expectDetails[0]}", got "${detail[1]}"`);
      expectDetails.shift();
      continue;
    }

    errors.push(`unexpected line ${at}`);
  }
  owed("end of report");
  closeSection();
  if (sectionIdx === -1) errors.push("no section: use the no-matches line instead");
  return errors;
}

/**
 * @param {string[]} argv
 * @returns {number} 0 pass, `EXIT_FAIL` differences found, `EXIT_USAGE` bad arguments or unreadable file.
 */
export function main(argv) {
  if (argv.length !== 1) {
    process.stderr.write("Usage: node check-report.mjs <report.md|->\n");
    return EXIT_USAGE;
  }
  let text;
  try {
    // File descriptor 0 is stdin: the skill pipes the report in through a heredoc.
    text = readFileSync(argv[0] === "-" ? 0 : argv[0], "utf8");
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return EXIT_USAGE;
  }
  const errors = checkReport(text);
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
