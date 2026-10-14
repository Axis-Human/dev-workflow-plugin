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
export const TARGET_FILES = 24;
export const CEILING_FILES = 45;
export const OPEN_LIMIT = 3;
export const MIN_SAMPLE = 5;
export const SHALLOW_LINES_PER_FILE = 20;
export const CATEGORIES = ['Backlog', 'Active', 'Review', 'QA', 'Done'];
export const NO_DELIVERY_BASELINE =
  'No delivery baseline (too few merged changes, no git history, or a squash-merged repo without GitHub access). Use the default rules: <=2 working days, <=24 files, at most 3 open per developer.';
export const NO_FLOW_BASELINE =
  'No time-in-status baseline (no data passed in, too few tasks, or the "Total time in Status" ClickApp is off).';

const DEFAULT_WINDOW_DAYS = 180;
const SEARCH_CAP = 1000; // GitHub search returns at most 1000 results.
const DAY_MS = 24 * 60 * 60 * 1000;
const SAMPLE_HOUR_UTC = 14;
const WORKING_SHARE = 5 / 7;

const log = (...args) => process.stderr.write(args.join(' ') + '\n');

// --- Pure helpers --------------------------------------------------------------

const LEADING_TICKET = /^(?:\[[^\]]*\]|[a-z]+-\d[a-z0-9]*)\s*[:|-]?\s*/;
const CHANGE_TYPE = /^\[?(feat|feature|fix|refactor|chore|docs|test)\b/;

/**
 * Lock files and generated output: they don't count toward the file limits.
 * Formatting-only changes can't be told apart from real ones here.
 */
const EXCLUDED_FILE =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|Pipfile\.lock|uv\.lock|composer\.lock|go\.sum|[^/]+\.lock)$|(^|\/)(dist|build|__generated__|generated)\/|\.(min\.(js|css)|snap|map)$|\.generated\./;

export const isExcludedFile = (file) => EXCLUDED_FILE.test(file ?? '');

/**
 * Change type from a PR title: `feat: x`, `[Feature] x`, or the same after a
 * leading ticket id such as `[CU-86c0abc]` or `ABC-123:`.
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

/** Monday–Friday days between two timestamps (ms, UTC), fractional. */
export function workingDays(from, to) {
  let days = 0;
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
 * `release/x`, `release-please--…`.
 */
export const isRelease = (name) => /^(v\d+\.\d+|release[-/])/i.test(name ?? '');

/** Linear-interpolation percentile, rounded to 2 decimals; null when empty. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return Number((sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)).toFixed(2));
}

const share = (rows, test) =>
  Math.round((100 * rows.filter(test).length) / rows.length);

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const k = key(row);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  return [...groups.entries()];
}

/** Shallow = fewer than 20 changed lines per counted file (moves, renames). */
export const isShallow = ({ files, lines }) =>
  files > 0 && lines / files < SHALLOW_LINES_PER_FILE;

/**
 * Changes open (first commit done, not merged) at 14:00 UTC on each weekday in
 * the window, counting only the days that had something open.
 */
export function openAtOnce(rows, { since, now }) {
  const counts = [];
  const first = Math.floor(since / DAY_MS) * DAY_MS + SAMPLE_HOUR_UTC * 36e5;
  for (let t = first; t < now; t += DAY_MS) {
    const weekday = new Date(t).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const count = rows.filter((r) => r.start <= t && r.end > t).length;
    if (count) counts.push(count);
  }
  return counts;
}

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

/** Delivery report data, or null when there are fewer than MIN_SAMPLE changes. */
export function buildDeliveryReport({ items, since, now, source, windowDays }) {
  const rows = items
    .filter((r) => r.end >= since && r.end <= now)
    .map((r) => ({ ...r, days: workingDays(r.start, r.end) }));
  if (rows.length < MIN_SAMPLE) return null;
  const types = groupBy(rows, (r) => r.type)
    .filter(([, group]) => group.length >= MIN_SAMPLE)
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([type, group]) => typeRow(type, group));
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

/** Flow report data, or null when there are fewer than MIN_SAMPLE tasks. */
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

/** Work PRs only (no bots, no release PRs), timed from the first commit. */
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

const git = (repoDir, args) =>
  execFileSync('git', args, {
    cwd: repoDir,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

function githubOrigin(repoDir) {
  try {
    const url = git(repoDir, ['remote', 'get-url', 'origin']).trim();
    const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
    return match ? { owner: match[1], repo: match[2] } : null;
  } catch {
    return null;
  }
}

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

/** Branch a merge commit brought in, from its subject line. */
export function mergeHead(subject) {
  return (
    /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject)?.[1] ??
    /^Merge branch '([^']+)'/.exec(subject)?.[1] ??
    null
  );
}

/** Records printed by `git log --format=%H%x1f%cI%x1f%s%x1f%b%x1e`. */
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

/** `git diff --numstat` output → counted files and changed lines. */
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

function fromGit({ repoDir, since }) {
  try {
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

function deliverySection(opts) {
  const since = opts.now - opts.windowDays * DAY_MS;
  const items = [];
  const sources = new Set();
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

function flowSection(opts) {
  if (!opts.timeInStatus) return NO_FLOW_BASELINE + '\n';
  const raw = readFileSync(opts.timeInStatus === '-' ? 0 : opts.timeInStatus, 'utf8');
  const report = buildFlowReport(parseTimeInStatus(JSON.parse(raw), opts.statusMap));
  return report ? renderFlow(report) : NO_FLOW_BASELINE + '\n';
}

export function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    log(err.message);
    log('See the header of slice-baseline.mjs for flags.');
    return EXIT_USAGE;
  }
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
