#!/usr/bin/env node
/**
 * Sizing baseline for the vertical-slice skill.
 *
 * Two read-only sources, neither of which blocks slicing:
 *   1. Delivery history: merged pull requests through the GitHub CLI (`gh`,
 *      signed in), or git merge commits when GitHub is unavailable. Working
 *      days from first commit to merge, files changed, shallow vs deep, and how
 *      much work each developer had open at once.
 *   2. ClickUp time-in-status (optional): the JSON returned by the ClickUp MCP
 *      tool `clickup_get_bulk_tasks_time_in_status`, passed in by the skill,
 *      plus a status → category map the developer confirmed.
 *
 * Writes nothing. The report goes to stdout as markdown; logs go to stderr.
 * Every way of not having data prints a "no baseline" line and exits 0, so the
 * skill falls back to its default rules instead of treating it as a failure.
 * Uses Node built-ins only.
 *
 * Usage:
 *   node slice-baseline.mjs [--window-days <n>] [--repo-dir <path>]...
 *     [--time-in-status <file|->] [--status-map '<json>'] [--no-github]
 *     [--now <ISO date>]
 *
 *   --window-days     How far back to look (default 180).
 *   --repo-dir        Repo to measure; repeat for a multi-repo product (default: cwd).
 *   --time-in-status  The MCP response as a file, or `-` for stdin.
 *   --status-map      JSON object of ClickUp status name → category
 *                     (Backlog | Active | Review | QA | Done). Required with
 *                     --time-in-status.
 *   --no-github       Skip GitHub and read git merge commits only.
 *   --now             Pretend "now" is this date, for repeatable output.
 *
 * Exit codes: 0 ok, with or without a baseline · 2 usage.
 *
 * Adapted from the slice-baseline tool in tech-lead-stack.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXIT_USAGE = 2;
/** Files a slice should stay within. Mirrors the limit in check-slice.mjs. */
export const TARGET_FILES = 24;
/** Hard file limit, reachable only by shallow changes. */
export const CEILING_FILES = 45;
/** Changes one developer should have open at the same time. */
export const OPEN_LIMIT = 3;
/** Fewest data points a figure needs before it is reported. */
export const MIN_SAMPLE = 5;
/** Below this many changed lines per file, a change counts as shallow. */
export const SHALLOW_LINES_PER_FILE = 20;
/** Categories every ClickUp status is mapped to through `--status-map`. */
export const CATEGORIES = ['Backlog', 'Active', 'Review', 'QA', 'Done'];
/** Printed instead of a report; the skill then falls back to these defaults. */
export const NO_DELIVERY_BASELINE =
  'No delivery baseline (too few merged changes, no git history, or a squash-merged repo without GitHub access). Use the default rules: <=2 working days, <=24 files, at most 3 open per developer.';
export const NO_FLOW_BASELINE =
  'No time-in-status baseline (no data passed in, too few tasks, or the "Total time in Status" ClickApp is off).';

const DEFAULT_WINDOW_DAYS = 180;
const SEARCH_CAP = 1000; // GitHub search returns at most 1000 results.
const DAY_MS = 24 * 60 * 60 * 1000;
/** Time of day (UTC) at which `openAtOnce` counts the open changes. */
const SAMPLE_HOUR_UTC = 14;
/** Share of calendar time that falls on weekdays; ClickUp reports calendar minutes. */
const WORKING_SHARE = 5 / 7;

// Diagnostics go to stderr so stdout carries only the report the skill reads.
const log = (...args) => process.stderr.write(args.join(' ') + '\n');

// --- Pure helpers --------------------------------------------------------------

/** A ticket id at the start of a lower-cased title, e.g. `[cu-86c0abc] ` or `abc-123: `. */
const LEADING_TICKET = /^(?:\[[^\]]*\]|[a-z]+-\d[a-z0-9]*)\s*[:|-]?\s*/;
/** Conventional change type at the start of a lower-cased title, optionally in brackets. */
const CHANGE_TYPE = /^\[?(feat|feature|fix|refactor|chore|docs|test)\b/;

/**
 * Lock files and generated output: they don't count toward the file limits.
 * Formatting-only changes can't be told apart from real ones here.
 */
const EXCLUDED_FILE =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|Pipfile\.lock|uv\.lock|composer\.lock|go\.sum|[^/]+\.lock)$|(^|\/)(dist|build|__generated__|generated)\/|\.(min\.(js|css)|snap|map)$|\.generated\./;

/**
 * @param {string | undefined} file Repo-relative path.
 * @returns {boolean} True when the file must not count toward the file limits.
 */
export const isExcludedFile = (file) => EXCLUDED_FILE.test(file ?? '');

/**
 * Change type from a PR title: `feat: x`, `[Feature] x`, or the same after a
 * leading ticket id such as `[CU-86c0abc]` or `ABC-123:`.
 *
 * @param {string | undefined} title PR title, or the merge commit's title.
 * @returns {string} `hotfix` (anywhere in the title wins), `feat`, `fix`,
 *   `refactor`, `chore`, `docs`, `test`, or `other`.
 */
export function typeOf(title) {
  const t = (title ?? '').toLowerCase().trim();
  if (t.includes('hotfix')) return 'hotfix';
  const type =
    CHANGE_TYPE.exec(t)?.[1] ??
    CHANGE_TYPE.exec(t.replace(LEADING_TICKET, ''))?.[1];
  if (!type) return 'other';
  return type === 'feature' ? 'feat' : type;
}

/**
 * Monday–Friday days between two timestamps (ms, UTC), fractional.
 *
 * @param {number} from Start, in epoch milliseconds.
 * @param {number} to End, in epoch milliseconds.
 * @returns {number} Weekday time between them, in days; 0 when `to <= from`.
 */
export function workingDays(from, to) {
  let days = 0;
  // Step one UTC day at a time (the first and last steps may be partial days)
  // and add only the time that falls on a weekday.
  for (let t = from; t < to;) {
    const next = Math.min(to, (Math.floor(t / DAY_MS) + 1) * DAY_MS);
    const weekday = new Date(t).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += (next - t) / DAY_MS;
    t = next;
  }
  return days;
}

/**
 * Release work, by branch or PR title: `v23.0.0`, `V24.0.0 -> Main`,
 * `release/x`, `release-please--…`. Release PRs bundle other changes, so
 * counting them would double-count that work.
 *
 * @param {string | null | undefined} name Branch name or title.
 * @returns {boolean}
 */
export const isRelease = (name) => /^(v\d+\.\d+|release[-/])/i.test(name ?? '');

/**
 * Linear-interpolation percentile, rounded to 2 decimals; null when empty.
 *
 * @param {number[]} values Unsorted values; not modified.
 * @param {number} p Fraction between 0 and 1 (0.5 is the median).
 * @returns {number | null}
 */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return Number((sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)).toFixed(2));
}

/**
 * @template T
 * @param {T[]} rows Must not be empty.
 * @param {(row: T) => boolean} test
 * @returns {number} Whole-number percentage of rows that pass `test`.
 */
const share = (rows, test) =>
  Math.round((100 * rows.filter(test).length) / rows.length);

/**
 * @template T, K
 * @param {T[]} rows
 * @param {(row: T) => K} key
 * @returns {Array<[K, T[]]>} Groups in order of first appearance.
 */
function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const k = key(row);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  return [...groups.entries()];
}

/**
 * Shallow = fewer than 20 changed lines per counted file (moves, renames).
 *
 * @param {{ files: number, lines: number }} change Counted files and changed lines.
 * @returns {boolean}
 */
export const isShallow = ({ files, lines }) =>
  files > 0 && lines / files < SHALLOW_LINES_PER_FILE;

/**
 * Changes open (first commit done, not merged) at 14:00 UTC on each weekday in
 * the window, counting only the days that had something open.
 *
 * @param {DeliveryItem[]} rows One developer's changes.
 * @param {object} window
 * @param {number} window.since Window start, in epoch milliseconds.
 * @param {number} window.now Window end, in epoch milliseconds.
 * @returns {number[]} One open-change count per sampled weekday.
 */
export function openAtOnce(rows, { since, now }) {
  const counts = [];
  // 14:00 UTC on the day the window starts (36e5 ms = 1 hour).
  const first = Math.floor(since / DAY_MS) * DAY_MS + SAMPLE_HOUR_UTC * 36e5;
  for (let t = first; t < now; t += DAY_MS) {
    const weekday = new Date(t).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const count = rows.filter((r) => r.start <= t && r.end > t).length;
    if (count) counts.push(count);
  }
  return counts;
}

/**
 * One merged change, from either GitHub or git.
 *
 * @typedef {object} DeliveryItem
 * @property {string} dev Author login (GitHub) or name (git).
 * @property {string} type Change type from `typeOf`.
 * @property {number} files Changed files, excluding lock files and generated output.
 * @property {number} lines Added plus deleted lines in the counted files.
 * @property {number} start First commit (or PR creation, if earlier), in epoch milliseconds.
 * @property {number} end Merge time, in epoch milliseconds.
 */

/**
 * One row of the delivery table.
 *
 * @param {string} type Change type, or `all`.
 * @param {Array<DeliveryItem & { days: number }>} rows Changes of that type, with working days.
 * @returns {object} Typical (median) and slow-end (85th percentile) figures, and
 *   the share of changes over each limit. `wideShallowPct` is null when no
 *   change falls between the target and the ceiling.
 */
function typeRow(type, rows) {
  const days = rows.map((r) => r.days);
  const files = rows.map((r) => r.files);
  const wide = rows.filter((r) => r.files > TARGET_FILES && r.files <= CEILING_FILES);
  return {
    type,
    count: rows.length,
    daysTypical: percentile(days, 0.5),
    daysSlowEnd: percentile(days, 0.85),
    withinTwoDaysPct: share(rows, (r) => r.days <= 2),
    filesTypical: percentile(files, 0.5),
    filesHigh: percentile(files, 0.85),
    overTargetPct: share(rows, (r) => r.files > TARGET_FILES),
    overCeilingPct: share(rows, (r) => r.files > CEILING_FILES),
    wideShallowPct: wide.length ? share(wide, isShallow) : null,
  };
}

/**
 * Delivery report data, or null when there are fewer than MIN_SAMPLE changes.
 *
 * @param {object} input
 * @param {DeliveryItem[]} input.items Changes from every repo.
 * @param {number} input.since Window start, in epoch milliseconds.
 * @param {number} input.now Window end, in epoch milliseconds.
 * @param {string} input.source Where the changes came from, for the report header.
 * @param {number} input.windowDays Window length, for the report header.
 * @returns {object | null} Input for `renderDelivery`.
 */
export function buildDeliveryReport({ items, since, now, source, windowDays }) {
  // Only changes merged inside the window count.
  const rows = items
    .filter((r) => r.end >= since && r.end <= now)
    .map((r) => ({ ...r, days: workingDays(r.start, r.end) }));
  if (rows.length < MIN_SAMPLE) return null;
  // Per-type rows, most common type first; types with too few changes are
  // still counted in the `all` row.
  const types = groupBy(rows, (r) => r.type)
    .filter(([, group]) => group.length >= MIN_SAMPLE)
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([type, group]) => typeRow(type, group));
  // Work in progress per developer; skipped for anyone with too few open days.
  const developers = groupBy(rows, (r) => r.dev)
    .map(([dev, group]) => ({ dev, open: openAtOnce(group, { since, now }) }))
    .filter(({ open }) => open.length >= MIN_SAMPLE)
    .map(({ dev, open }) => ({
      dev,
      openTypical: percentile(open, 0.5),
      openMax: Math.max(...open),
      overLimitPct: share(open, (c) => c > OPEN_LIMIT),
    }));
  return {
    source,
    windowDays,
    count: rows.length,
    types: [typeRow('all', rows), ...types],
    developers,
  };
}

/** Calendar minutes → working days, approximated as 5/7 of calendar time. */
const minutesToWorkingDays = (minutes) => (minutes / 1440) * WORKING_SHARE;

/**
 * Per-task working days in each category, from the MCP response
 * `{ tasks: { <id>: { status_history: [{ status, total_time_minutes }] } } }`.
 * Statuses missing from the map are reported, not guessed.
 *
 * @param {object} json The parsed MCP response, or its bare `tasks` object.
 * @param {Record<string, string>} statusMap ClickUp status name → category.
 *   Names are matched case-insensitively.
 * @returns {{ rows: Array<Record<string, number>>, unmapped: string[] }} One
 *   row per task with working days per category, and the lower-cased status
 *   names that had no mapping.
 * @throws {Error} When the map uses a category not in `CATEGORIES`.
 */
export function parseTimeInStatus(json, statusMap) {
  const lookup = new Map(
    Object.entries(statusMap).map(([status, category]) => [
      status.trim().toLowerCase(),
      category,
    ])
  );
  for (const category of lookup.values())
    if (!CATEGORIES.includes(category))
      throw new Error(`unknown category "${category}"; use ${CATEGORIES.join(', ')}`);
  const tasks = json?.tasks && typeof json.tasks === 'object' ? json.tasks : json;
  const unmapped = new Set();
  const rows = Object.values(tasks ?? {})
    .filter((task) => Array.isArray(task?.status_history))
    .map((task) => {
      const days = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
      for (const entry of task.status_history) {
        const status = String(entry.status ?? '').trim().toLowerCase();
        const category = lookup.get(status);
        if (!category) {
          unmapped.add(status);
          continue;
        }
        days[category] += minutesToWorkingDays(Number(entry.total_time_minutes) || 0);
      }
      return days;
    });
  return { rows, unmapped: [...unmapped] };
}

/**
 * Flow report data, or null when there are fewer than MIN_SAMPLE tasks.
 *
 * @param {ReturnType<typeof parseTimeInStatus>} input Output of `parseTimeInStatus`.
 * @returns {object | null} Input for `renderFlow`. Flow efficiency is the share
 *   of in-work time (Active + Review + QA) spent Active, i.e. not waiting.
 */
export function buildFlowReport({ rows, unmapped }) {
  if (rows.length < MIN_SAMPLE) return null;
  const pick = (fn) => rows.map(fn);
  const inWork = (r) => r.Active + r.Review + r.QA;
  const categoryRow = (name, values) => ({
    name,
    typical: percentile(values, 0.5),
    slowEnd: percentile(values, 0.85),
  });
  const efficiency = rows
    .filter((r) => inWork(r) > 0)
    .map((r) => r.Active / inWork(r));
  return {
    count: rows.length,
    unmapped,
    categories: [
      categoryRow('Backlog (before work starts)', pick((r) => r.Backlog)),
      categoryRow('Active', pick((r) => r.Active)),
      categoryRow('Review', pick((r) => r.Review)),
      categoryRow('QA', pick((r) => r.QA)),
      categoryRow('Review + QA wait', pick((r) => r.Review + r.QA)),
      categoryRow('Work started → done', pick(inWork)),
    ],
    flowEfficiencyPct:
      efficiency.length ? Math.round(100 * percentile(efficiency, 0.5)) : null,
    reviewQaWaitTypical: percentile(pick((r) => r.Review + r.QA), 0.5),
  };
}

/**
 * @param {NonNullable<ReturnType<typeof buildDeliveryReport>>} report
 * @returns {string} The "Delivery baseline" markdown section. Developer names
 *   appear in it, so the skill keeps this table out of ClickUp.
 */
export function renderDelivery(report) {
  const lines = [
    '## Delivery baseline',
    `Source: ${report.source} · last ${report.windowDays} days · ${report.count} changes`,
    `Limits: <=2 working days · <=${TARGET_FILES} files (up to ${CEILING_FILES} only for shallow changes) · at most ${OPEN_LIMIT} open per developer`,
    '',
    `| Type | Count | Days typical | Days slow end | ≤2 days | Files typical | Files high | Over ${TARGET_FILES} | Over ${CEILING_FILES} | Shallow in ${TARGET_FILES + 1}–${CEILING_FILES} |`,
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.types.map(
      (r) =>
        `| ${r.type} | ${r.count} | ${r.daysTypical} | ${r.daysSlowEnd} | ${r.withinTwoDaysPct}% | ${r.filesTypical} | ${r.filesHigh} | ${r.overTargetPct}% | ${r.overCeilingPct}% | ${r.wideShallowPct === null ? 'n/a' : `${r.wideShallowPct}%`} |`
    ),
    '',
    'Open at once (chat only; never copy developer names into ClickUp):',
    '',
    `| Developer | Typical open at once | Max | Days over ${OPEN_LIMIT} open |`,
    '| --- | --- | --- | --- |',
    ...report.developers.map(
      (d) => `| ${d.dev} | ${d.openTypical} | ${d.openMax} | ${d.overLimitPct}% |`
    ),
  ];
  if (report.developers.length === 0)
    lines.push('| (no developer with enough open days) | | | |');
  return lines.join('\n') + '\n';
}

/**
 * @param {NonNullable<ReturnType<typeof buildFlowReport>>} report
 * @returns {string} The "Time-in-status baseline" markdown section.
 */
export function renderFlow(report) {
  const lines = [
    '## Time-in-status baseline',
    `Source: ClickUp time-in-status · ${report.count} closed tasks · working days (calendar time × 5/7)`,
    '',
    '| Category | Typical | Slow end (85%) |',
    '| --- | --- | --- |',
    ...report.categories.map((c) => `| ${c.name} | ${c.typical} | ${c.slowEnd} |`),
    '',
    `Flow efficiency (active ÷ work started → done), typical: ${report.flowEfficiencyPct === null ? 'n/a' : `${report.flowEfficiencyPct}%`}`,
    `Typical review + QA wait: ${report.reviewQaWaitTypical} working days`,
  ];
  if (report.unmapped.length)
    lines.push(`Statuses not in the map (left out): ${report.unmapped.join(', ')}`);
  return lines.join('\n') + '\n';
}

// --- Sources: GitHub first, git merge commits as the fallback ------------------

/**
 * One page (100) of merged PRs. `commits(first: 1)` gives the first commit's
 * date, where the work started. `files(first: 100)` lists at most 100 files,
 * so for larger PRs `changedFiles` is the real total.
 */
const PR_QUERY = `
query MergedPullRequests($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title headRefName createdAt mergedAt changedFiles
        author { __typename login }
        commits(first: 1) { nodes { commit { authoredDate } } }
        files(first: 100) { nodes { path additions deletions } }
      }
    }
  }
}`;

/**
 * Work PRs only (no bots, no release PRs), timed from the first commit.
 *
 * @param {object[]} nodes PullRequest nodes from `PR_QUERY`.
 * @returns {DeliveryItem[]}
 */
export function parseGitHubPrs(nodes) {
  return nodes
    .filter(
      (p) =>
        p.author?.__typename !== 'Bot' &&
        !isRelease(p.headRefName) &&
        !isRelease(p.title)
    )
    .map((p) => {
      const created = Date.parse(p.createdAt);
      const firstCommit = Date.parse(p.commits?.nodes?.[0]?.commit?.authoredDate);
      const listed = p.files?.nodes ?? [];
      const counted = listed.filter((f) => !isExcludedFile(f.path));
      // Excluded files are only known among the (up to 100) listed files, so
      // they are subtracted from the real total; `lines` covers listed files only.
      const excluded = listed.length - counted.length;
      return {
        dev: p.author?.login ?? 'ghost',
        type: typeOf(p.title),
        files: Math.max(0, (p.changedFiles ?? listed.length) - excluded),
        lines: counted.reduce((sum, f) => sum + (f.additions ?? 0) + (f.deletions ?? 0), 0),
        start: Number.isFinite(firstCommit) ? Math.min(created, firstCommit) : created,
        end: Date.parse(p.mergedAt),
      };
    });
}

/**
 * Runs git in `repoDir` and returns its stdout. Throws when git fails.
 * The large buffer covers `git log` over long histories.
 *
 * @param {string} repoDir
 * @param {string[]} args
 * @returns {string}
 */
const git = (repoDir, args) =>
  execFileSync('git', args, {
    cwd: repoDir,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/**
 * @param {string} repoDir
 * @returns {{ owner: string, repo: string } | null} The GitHub repo behind the
 *   `origin` remote (HTTPS or SSH URL), or null when it is not on github.com.
 */
function githubOrigin(repoDir) {
  try {
    const url = git(repoDir, ['remote', 'get-url', 'origin']).trim();
    const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
    return match ? { owner: match[1], repo: match[2] } : null;
  } catch {
    return null;
  }
}

/**
 * Merged PRs from GitHub through `gh api graphql`.
 *
 * @param {object} input
 * @param {string} input.repoDir Local clone whose `origin` names the GitHub repo.
 * @param {number} input.since Window start, in epoch milliseconds.
 * @returns {DeliveryItem[] | null} null means "use git instead": no GitHub
 *   origin, `gh` missing or signed out, or the query failed.
 */
function fromGitHub({ repoDir, since }) {
  const origin = githubOrigin(repoDir);
  if (!origin) {
    log(`${repoDir}: origin is not on github.com; using git merge commits.`);
    return null;
  }
  const auth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  if (auth.error || auth.status !== 0) {
    log('gh CLI missing or not signed in (run `gh auth login`); using git merge commits.');
    return null;
  }
  try {
    const day = new Date(since).toISOString().slice(0, 10);
    const q = `repo:${origin.owner}/${origin.repo} is:pr is:merged merged:>=${day}`;
    const nodes = [];
    let cursor = null;
    // Page through the search until it runs out or hits GitHub's result cap.
    for (;;) {
      const args = ['api', 'graphql', '-f', `query=${PR_QUERY}`, '-f', `q=${q}`];
      if (cursor) args.push('-f', `cursor=${cursor}`);
      const page = JSON.parse(
        execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
      ).data.search;
      for (const n of page.nodes) if (n && 'number' in n) nodes.push(n);
      if (nodes.length >= SEARCH_CAP) {
        log(`GitHub search stops at ${SEARCH_CAP} PRs; use a shorter --window-days.`);
        nodes.length = SEARCH_CAP;
        break;
      }
      if (!page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.endCursor;
    }
    return parseGitHubPrs(nodes);
  } catch (err) {
    log(`GitHub query failed (${String(err.message).split('\n')[0]}); using git.`);
    return null;
  }
}

/**
 * Branch a merge commit brought in, from its subject line.
 *
 * @param {string} subject e.g. `Merge pull request #12 from org/feat/x` or `Merge branch 'feat/x'`.
 * @returns {string | null} The branch name (`feat/x`), or null for other subjects.
 */
export function mergeHead(subject) {
  return (
    /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject)?.[1] ??
    /^Merge branch '([^']+)'/.exec(subject)?.[1] ??
    null
  );
}

/**
 * Records printed by `git log --format=%H%x1f%cI%x1f%s%x1f%b%x1e`.
 * Fields are split on the ASCII unit separator (0x1f) and records on the
 * record separator (0x1e), because subjects and bodies can hold any text.
 *
 * @param {string} raw The `git log` output.
 * @returns {Array<{ sha: string, end: number, title: string, head: string | null }>}
 *   `title` is the body's first line (the PR title on GitHub merges), else the subject.
 */
export function parseGitMerges(raw) {
  return raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, mergedAt, subject, body = ''] = record.split('\x1f');
      return {
        sha,
        end: Date.parse(mergedAt),
        title: body.split('\n')[0].trim() || subject,
        head: mergeHead(subject),
      };
    });
}

/**
 * `git diff --numstat` output → counted files and changed lines.
 * Binary files print `-` for both counts and add no lines.
 *
 * @param {string} raw Lines of `<added>\t<deleted>\t<path>`.
 * @returns {{ files: number, lines: number }}
 */
export function parseNumstat(raw) {
  let files = 0;
  let lines = 0;
  for (const row of raw.split('\n').filter(Boolean)) {
    const [added, deleted, file] = row.split('\t');
    if (isExcludedFile(file)) continue;
    files += 1;
    lines += (Number(added) || 0) + (Number(deleted) || 0);
  }
  return { files, lines };
}

/**
 * Merged changes from local git merge commits: the fallback when GitHub is
 * unavailable. Squash or rebase merges leave no merge commit, so such repos
 * yield few or no changes here.
 *
 * @param {object} input
 * @param {string} input.repoDir
 * @param {number} input.since Window start, in epoch milliseconds.
 * @returns {DeliveryItem[]} Empty when the history can't be read.
 */
function fromGit({ repoDir, since }) {
  try {
    // --first-parent keeps only merges into the current branch, not merges of
    // the main branch back into feature branches.
    const raw = git(repoDir, [
      'log',
      '--merges',
      '--first-parent',
      `--since=${new Date(since).toISOString()}`,
      '--format=%H%x1f%cI%x1f%s%x1f%b%x1e',
    ]);
    return parseGitMerges(raw)
      .filter((m) => !isRelease(m.head) && !isRelease(m.title))
      .map((m) => {
        // ^1 is the branch merged into, ^2 the merged branch. `^1..^2` lists
        // the branch's own commits; the oldest gives the start and author.
        // `^1...^2` diffs from their merge base, i.e. only the branch's changes.
        const [firstAt, dev] = git(repoDir, [
          'log',
          '--reverse',
          '--format=%aI%x1f%aN',
          `${m.sha}^1..${m.sha}^2`,
        ])
          .split('\n')[0]
          .split('\x1f');
        const { files, lines } = parseNumstat(
          git(repoDir, ['diff', '--numstat', `${m.sha}^1...${m.sha}^2`])
        );
        const start = Date.parse(firstAt);
        return {
          dev: dev || 'unknown',
          type: typeOf(m.title),
          files,
          lines,
          start: Number.isFinite(start) ? Math.min(start, m.end) : m.end,
          end: m.end,
        };
      });
  } catch (err) {
    log(`${repoDir}: git history unavailable (${String(err.message).split('\n')[0]}).`);
    return [];
  }
}

// --- CLI -----------------------------------------------------------------------

/**
 * Parses the command line. See the file header for flags.
 *
 * @param {string[]} argv Arguments after `node slice-baseline.mjs`.
 * @returns {{
 *   windowDays: number,
 *   repoDirs: string[],
 *   github: boolean,
 *   timeInStatus: string | null,
 *   statusMap: Record<string, string> | null,
 *   now: number,
 * }} `repoDirs` are absolute and default to the working directory.
 * @throws {Error} On an unknown flag, a missing or bad value, or
 *   `--time-in-status` without `--status-map`.
 */
export function parseArgs(argv) {
  const opts = {
    windowDays: DEFAULT_WINDOW_DAYS,
    repoDirs: [],
    github: true,
    timeInStatus: null,
    statusMap: null,
    now: Date.now(),
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1] ?? '';
    // Takes the next argument as this flag's value. `-` (stdin) is allowed;
    // another `--flag` means the value was left out.
    const needsValue = (what) => {
      if (!value || (value.startsWith('--') && value !== '-'))
        throw new Error(`${flag} needs ${what}`);
      i++;
      return value;
    };
    if (flag === '--no-github') {
      opts.github = false;
    } else if (flag === '--window-days') {
      if (!/^[1-9]\d*$/.test(value))
        throw new Error('--window-days needs a positive whole number');
      opts.windowDays = Number(value);
      i++;
    } else if (flag === '--repo-dir') {
      opts.repoDirs.push(path.resolve(needsValue('a path')));
    } else if (flag === '--time-in-status') {
      opts.timeInStatus = needsValue('a file path or -');
    } else if (flag === '--status-map') {
      opts.statusMap = JSON.parse(needsValue('a JSON object'));
    } else if (flag === '--now') {
      opts.now = Date.parse(value);
      if (!Number.isFinite(opts.now)) throw new Error('--now needs an ISO date');
      i++;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (opts.repoDirs.length === 0) opts.repoDirs.push(process.cwd());
  if (opts.timeInStatus && !opts.statusMap)
    throw new Error('--time-in-status needs --status-map');
  return opts;
}

/**
 * @param {ReturnType<typeof parseArgs>} opts
 * @returns {string} The delivery markdown section, or the "no baseline" line.
 */
function deliverySection(opts) {
  const since = opts.now - opts.windowDays * DAY_MS;
  const items = [];
  const sources = new Set();
  // Each repo uses GitHub when it can and git otherwise, so one report can mix
  // both sources; the header names every source used.
  for (const repoDir of opts.repoDirs) {
    const github = opts.github ? fromGitHub({ repoDir, since }) : null;
    items.push(...(github ?? fromGit({ repoDir, since })));
    sources.add(github ? 'GitHub merged PRs' : 'git merge commits');
  }
  const report = buildDeliveryReport({
    items,
    since,
    now: opts.now,
    source: `${[...sources].join(' + ')} (${opts.repoDirs.length} repo${opts.repoDirs.length > 1 ? 's' : ''})`,
    windowDays: opts.windowDays,
  });
  return report ? renderDelivery(report) : NO_DELIVERY_BASELINE + '\n';
}

/**
 * @param {ReturnType<typeof parseArgs>} opts
 * @returns {string} The time-in-status markdown section, or the "no baseline" line.
 * @throws {Error} When the input can't be read or parsed; `main` turns that
 *   into the "no baseline" line.
 */
function flowSection(opts) {
  if (!opts.timeInStatus) return NO_FLOW_BASELINE + '\n';
  const raw = readFileSync(opts.timeInStatus === '-' ? 0 : opts.timeInStatus, 'utf8');
  const report = buildFlowReport(parseTimeInStatus(JSON.parse(raw), opts.statusMap));
  return report ? renderFlow(report) : NO_FLOW_BASELINE + '\n';
}

/**
 * Prints both baseline sections to stdout. Returns the exit code instead of
 * exiting, so it can be called from a test.
 *
 * @param {string[]} argv Arguments after `node slice-baseline.mjs`.
 * @returns {number} 0, with or without a baseline; `EXIT_USAGE` on bad arguments.
 */
export function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    log(err.message);
    log('See the header of slice-baseline.mjs for flags.');
    return EXIT_USAGE;
  }
  // Bad time-in-status input must not block slicing: log it and carry on
  // without that section.
  let flow;
  try {
    flow = flowSection(opts);
  } catch (err) {
    log(`Time-in-status input unreadable (${String(err.message).split('\n')[0]}).`);
    flow = NO_FLOW_BASELINE + '\n';
  }
  process.stdout.write(deliverySection(opts) + '\n' + flow);
  return 0;
}

// Run only when executed directly, not when imported (e.g. by a test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
