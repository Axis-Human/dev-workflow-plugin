#!/usr/bin/env node
// AI usage telemetry collector.
//
// Records what each turn actually cost — tokens, model, wall time, which
// sub-agent ran, and which GitHub account the machine belongs to — and ships it
// to the dashboard so the numbers can be optimised instead of guessed at.
//
// Wiring (hooks.json), one process per event:
//   UserPromptSubmit  opens a turn and remembers where the transcript ended
//   SubagentStop      closes one sub-agent run, billed from its own transcript
//   Stop              closes the turn, then hands it to a detached finalizer
//   SessionEnd        emits the session rollup, including real cost in USD
//   --finalize        detached child that reads the transcript once it is on disk
//   --flush           detached child that POSTs the spool; never runs inline
//
// Why a turn is not billed inline: Claude Code flushes the transcript
// asynchronously, so at the moment Stop fires the turn's own records are
// usually not on disk yet — reading there bills every turn as zero. The
// finalizer waits, then reads. It also bounds the read by the turn's start and
// end timestamps, because by the time it looks the next turn may already have
// appended records of its own.
//
// Two rules this file must never break:
//   1. Nothing on stdout. On UserPromptSubmit stdout is injected into the
//      model's context, so a stray log line would become an instruction.
//   2. Never fail the session. Telemetry is not worth a broken turn, so every
//      path exits 0 and every error is swallowed to the local log.
//
// Prompt text is deliberately never collected — only its length and a hash.
// The dashboard is readable without a login, and a prompt can carry client
// data, credentials or proprietary code. Length and hash answer "which turn
// was expensive" and "is this the same prompt again" without holding content.
//
// Nobody configures anything. This repo is public, so it carries no secret —
// each machine generates its own the first time it runs and presents it on
// every POST. A machine the dashboard has not seen before is parked as pending
// and nothing it sends is stored until someone approves it there; its records
// wait in the spool meanwhile, so the approval is not a data cliff.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, '.claude', 'ai-usage');
const SPOOL = path.join(STATE_DIR, 'spool.jsonl');
const IDENTITY = path.join(STATE_DIR, 'identity.json');
const LOG = path.join(STATE_DIR, 'collector.log');

// Where the dashboard lives. Not a secret — it is a URL that answers 401 to
// anyone who is not an approved machine — so it ships in the repo rather than
// asking every teammate to paste it. Replace the placeholder with the real
// domain; while it holds the placeholder, the collector stays inert.
const DASHBOARD_URL = 'https://dashboard.axishuman.ai/api/ai-usage';

// Overridable only for pointing a dev machine at a local dashboard.
const ENDPOINT = process.env.AI_TELEMETRY_URL || DASHBOARD_URL;

const DEVICE_FILE = path.join(STATE_DIR, 'device.json');
const BLOCKED_FILE = path.join(STATE_DIR, 'blocked');

// Inert until the URL is real, and inert for good once the dashboard says this
// machine is blocked: told no, it stops asking.
const ENABLED = !ENDPOINT.includes('REPLACE-ME') && !fileExists(BLOCKED_FILE);

const IDENTITY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SPOOL_BYTES = 5 * 1024 * 1024;   // stop growing if the server is gone
const MAX_BATCH = 200;
const MAX_OUTBOX_FILES = 50;   // drain a backlog, do not flood a server that just returned
const FLUSH_TIMEOUT_MS = 10000;
// How long to give Claude Code to write the turn's records before reading them.
const FINALIZE_DELAY_MS = 4000;

main();

function main() {
  const mode = process.argv[2] || '';

  if (mode === '--flush') return flush();       // detached child, no stdin
  if (mode === '--finalize') return finalize(process.argv[3]);
  if (!ENABLED) return process.exit(0);

  let raw = '';
  process.stdin.on('data', c => (raw += c));
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(raw || '{}');
      handle(mode || input.hook_event_name, input);
    } catch (err) {
      note('handle failed', err);
    }
    process.exit(0);
  });
  // A hook with no stdin attached must not hang the turn waiting for one.
  process.stdin.on('error', () => process.exit(0));
}

function handle(event, input) {
  switch (event) {
    case 'UserPromptSubmit': return openTurn(input);
    case 'SubagentStop':     return closeAgent(input);
    case 'Stop':             return closeTurn(input);
    case 'SessionEnd':       return closeSession(input);
    default:                 return;
  }
}

// ---------------------------------------------------------------- turn state

// One marker file per live turn. Keyed by prompt_id because that is the only id
// that both UserPromptSubmit and Stop agree on.
function markerPath(input) {
  const key = `${input.session_id || 'nosession'}.${input.prompt_id || 'noprompt'}`;
  return path.join(STATE_DIR, `turn-${sha(key).slice(0, 16)}.json`);
}

function openTurn(input) {
  const file = markerPath(input);

  // UserPromptSubmit fires again when the loop resumes after a sub-agent, with
  // the same prompt_id. Overwriting here would move the turn's start past
  // everything that ran before the sub-agent and bill only the tail of it.
  if (readJson(file)) return;

  const prompt = typeof input.prompt === 'string' ? input.prompt : '';

  write(file, JSON.stringify({
    started_at: new Date().toISOString(),
    started_ms: Date.now(),
    // Where the transcript ended before this turn ran. Everything appended
    // past this offset is what the turn is billed for.
    transcript_offset: sizeOf(input.transcript_path),
    prompt_chars: prompt.length,
    prompt_sha256: prompt ? sha(prompt) : null,
    // The id the prompt named, kept as a fallback for when the branch does not
    // carry one. Only the id is taken; the prompt itself is never stored.
    ticket_hint: ticketFromText(prompt),
    permission_mode: input.permission_mode || null,
    cwd: input.cwd || null,
  }));
}

function closeTurn(input) {
  const file = markerPath(input);
  const marker = readJson(file);
  if (!marker) return;                       // Stop without an open turn

  // Everything the finalizer will need, so it does not depend on a hook payload
  // it will never see.
  write(file, JSON.stringify({
    ...marker,
    kind: 'turn',
    ended_at: new Date().toISOString(),
    duration_ms: Date.now() - marker.started_ms,
    transcript_path: input.transcript_path || null,
    ...context(input, marker),
  }));

  finalizeDetached(file);
}

function closeAgent(input) {
  // A sub-agent gets its own transcript, so the whole file is this run and
  // nothing needs to be offset away — but it is written just as lazily as the
  // session's, so it goes through the same finalizer.
  const file = path.join(STATE_DIR, `agent-${sha(input.agent_id || Math.random()).slice(0, 16)}.json`);

  write(file, JSON.stringify({
    kind: 'agent',
    ...context(input, readJson(markerPath(input))),
    agent_id: input.agent_id || null,
    // Plugin-namespaced, e.g. "axis-human-ai-toolbox:implement-task-agent".
    agent_type: input.agent_type || null,
    ended_at: new Date().toISOString(),
    transcript_path: input.agent_transcript_path || null,
    transcript_offset: 0,
    sidechain: true,
  }));

  finalizeDetached(file);
}

function closeSession(input) {
  // cost-state is Claude Code's own rollup: real USD and per-model totals for
  // the whole session. Cheaper and more accurate than re-deriving it.
  const cost = lastCostState(input.transcript_path);

  emit({
    kind: 'session',
    ...context(input, null),
    reason: input.reason || null,
    ended_at: new Date().toISOString(),
    cost_usd: cost ? round(cost.totalCostUSD, 6) : null,
    duration_ms: cost ? cost.totalDuration : null,
    api_duration_ms: cost ? cost.totalAPIDuration : null,
    tool_duration_ms: cost ? cost.totalToolDuration : null,
    lines_added: cost ? cost.totalLinesAdded : null,
    lines_removed: cost ? cost.totalLinesRemoved : null,
    model_usage: cost ? cost.modelUsage : null,
  });

  flushDetached();
}

// ------------------------------------------------------------------- context

// The fields every record carries: who, where, and against which ticket.
function context(input, marker) {
  const cwd = input.cwd || (marker && marker.cwd) || process.cwd();

  return {
    session_id: input.session_id || null,
    prompt_id: input.prompt_id || null,
    github_login: githubLogin(),
    machine: os.hostname(),
    project: path.basename(cwd),
    cwd,
    git_branch: gitBranch(cwd),
    ticket_id: ticketId(cwd) || (marker && marker.ticket_hint) || null,
    client_version: null,   // filled from the transcript when available
  };
}

/**
 * This machine's secret, generated here and never anywhere else.
 *
 * The plugin is public, so it cannot ship a credential: anyone reading the repo
 * would read it too. 32 random bytes made on first run solve that — the
 * dashboard learns the hash, this file keeps the original, and no human ever
 * types either. Losing it costs one more approval, not any stored data.
 */
function deviceSecret() {
  const existing = readJson(DEVICE_FILE);
  if (existing && typeof existing.secret === 'string' && existing.secret.length >= 32) {
    return existing.secret;
  }

  const secret = crypto.randomBytes(32).toString('hex');
  write(DEVICE_FILE, JSON.stringify({ secret, created_at: new Date().toISOString() }));

  // Readable only by this user: it is the whole credential.
  try { fs.chmodSync(DEVICE_FILE, 0o600); } catch { /* best effort */ }

  return secret;
}

/**
 * The GitHub account this machine belongs to.
 *
 * `gh auth status` reads the local keyring and needs no network, which matters
 * in a hook that runs on every prompt. The answer is cached for a day because
 * even a local keyring read is slower than the rest of this file put together.
 */
function githubLogin() {
  const cached = readJson(IDENTITY);
  if (cached && cached.login && Date.now() - (cached.at || 0) < IDENTITY_TTL_MS) {
    return cached.login;
  }

  let login = null;

  // "✓ Logged in to github.com account cpantu (keyring)"
  const status = run('gh', ['auth', 'status'], 4000);
  const match = status && status.match(/account\s+([A-Za-z0-9-]+)/);
  if (match) login = match[1];

  // No gh on the machine, or not logged in: the git identity still tells us
  // which person this is, which is the point of the field.
  if (!login) {
    login = run('git', ['config', '--global', 'user.email'], 2000) || null;
  }

  if (login) write(IDENTITY, JSON.stringify({ login, at: Date.now() }));
  return login;
}

const branchCache = new Map();

// Asked for twice per record (the branch itself, then the ticket in it) and
// this runs on every prompt, so the subprocess happens once per process.
function gitBranch(cwd) {
  if (!branchCache.has(cwd)) {
    branchCache.set(cwd, run('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], 2000) || null);
  }
  return branchCache.get(cwd);
}

/**
 * The ClickUp task this work belongs to.
 *
 * An explicit env var wins, so a session can always be labelled by hand.
 * Otherwise it comes off the branch name, which is where the orchestrator puts
 * it: it creates branches as {task-id}-{slug}. A branch with no id — main, or
 * anything hand-made — reports null rather than guessing, and the turn is still
 * recorded: untracked work is exactly the spend that otherwise goes unseen.
 */
function ticketId(cwd) {
  const explicit = (process.env.AI_TELEMETRY_TICKET || '').trim();
  if (explicit) return explicit;

  const branch = gitBranch(cwd);
  if (!branch) return null;

  const named = ticketFromText(branch);
  if (named) return named;

  // Or a leading id segment: 86abc1234-fix-the-login.
  const leading = branch.match(/^([0-9a-z]{6,16})-(?=.)/i);
  if (leading && /\d/.test(leading[1])) return leading[1];

  return null;
}

/** A ClickUp id written out in prose or in a branch name: CU-abc123, cu_abc123. */
function ticketFromText(text) {
  const match = String(text || '').match(/\bCU[-_]([A-Za-z0-9]{4,})/i);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------- transcripts

/**
 * Token usage from a transcript, counting only what was appended past `offset`.
 *
 * Reads assistant records and sums their `usage` block.
 *
 * `sidechain` says which side of the fence this file is. In a session
 * transcript, sidechain records belong to a sub-agent that closeAgent bills
 * from its own file, so counting them here would double them. In an agent
 * transcript every record is sidechain and they are the only thing to count.
 */
function usageSince(file, offset, sidechain = false, window = null) {
  const empty = {
    model: null, models: [], input_tokens: 0, output_tokens: 0,
    cache_read_tokens: 0, cache_creation_tokens: 0, thinking_tokens: 0,
    assistant_turns: 0, tool_calls: 0, client_version: null,
  };
  if (!file || !fs.existsSync(file)) return empty;

  let text;
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const from = Math.min(offset || 0, size);
    const buf = Buffer.alloc(size - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch (err) {
    note('read transcript failed', err);
    return empty;
  }

  const out = { ...empty };
  const byModel = new Map();

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;

    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type !== 'assistant') continue;
    if (Boolean(rec.isSidechain) !== sidechain) continue;
    // By the time the finalizer looks, the next turn may already have appended
    // records of its own; the offset cannot tell them apart but the clock can.
    if (!withinWindow(rec.timestamp, window)) continue;

    const msg = rec.message || {};
    const u = msg.usage || {};

    out.assistant_turns += 1;
    out.input_tokens += num(u.input_tokens);
    out.output_tokens += num(u.output_tokens);
    out.cache_read_tokens += num(u.cache_read_input_tokens);
    out.cache_creation_tokens += num(u.cache_creation_input_tokens);
    out.thinking_tokens += num(u.output_tokens_details && u.output_tokens_details.thinking_tokens);

    if (Array.isArray(msg.content)) {
      out.tool_calls += msg.content.filter(b => b && b.type === 'tool_use').length;
    }
    if (msg.model) byModel.set(msg.model, (byModel.get(msg.model) || 0) + num(u.output_tokens) + 1);
    if (rec.version) out.client_version = rec.version;
  }

  // One turn can span models (a haiku side-trip inside an opus turn). Keep the
  // full list, and report the heaviest as *the* model so a row reads simply.
  out.models = [...byModel.keys()];
  out.model = [...byModel.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])[0] || null;
  return out;
}

/**
 * Whether a record belongs to the turn being billed.
 *
 * A record with no timestamp is kept: dropping it would lose real usage over a
 * field that is only there to disambiguate.
 */
function withinWindow(timestamp, window) {
  if (!window || !timestamp) return true;

  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) return true;

  const from = Date.parse(window.from);
  const to = Date.parse(window.to);

  // A turn's last record can be written a moment after the hook observed the
  // end, so the upper bound is generous; the lower one is exact.
  if (!Number.isNaN(from) && at < from) return false;
  if (!Number.isNaN(to) && at > to + FINALIZE_DELAY_MS) return false;

  return true;
}

/** The last cost-state record in a transcript, which is the session total. */
function lastCostState(file) {
  if (!file || !fs.existsSync(file)) return null;

  let found = null;
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('"cost-state"')) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.type === 'cost-state') found = rec;
      } catch { /* partial line */ }
    }
  } catch (err) {
    note('read cost-state failed', err);
  }
  return found;
}

// ----------------------------------------------------------------- finalizer

/**
 * Bill a closed turn or agent run, once its transcript is actually on disk.
 *
 * Runs detached and a few seconds late on purpose. The session is already over
 * as far as the user is concerned, so waiting costs nothing, and waiting is the
 * only way to read records that Claude Code had not written yet when the hook
 * fired.
 */
function finalize(file) {
  const marker = readJson(file);
  if (!marker) return process.exit(0);

  setTimeout(() => {
    const usage = usageSince(
      marker.transcript_path,
      marker.transcript_offset,
      Boolean(marker.sidechain),
      { from: marker.started_at, to: marker.ended_at },
    );

    const { transcript_path, transcript_offset, started_ms, sidechain, ticket_hint, ...record } = marker;
    emit({ ...record, ...usage });

    remove(file);
    flush();            // already detached; sending inline is the point
  }, FINALIZE_DELAY_MS);
}

function finalizeDetached(file) {
  spawnDetached(['--finalize', file]);
}

// --------------------------------------------------------------- spool & send

function emit(record) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    if (sizeOf(SPOOL) > MAX_SPOOL_BYTES) return;   // server unreachable; stop growing
    fs.appendFileSync(SPOOL, JSON.stringify(record) + '\n');
  } catch (err) {
    note('spool write failed', err);
  }
}

/**
 * Hand the spool to a detached child and return immediately.
 *
 * The turn must not wait on the network. The child outlives this process, so a
 * slow or dead endpoint costs the session nothing.
 */
function flushDetached() {
  spawnDetached(['--flush']);
}

function spawnDetached(args) {
  try {
    const child = spawn(process.execPath, [__filename, ...args], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
  } catch (err) {
    note('spawn failed', err);
  }
}

function flush() {
  if (!ENABLED) return process.exit(0);

  // Anything a previous flush could not deliver, oldest first, plus whatever
  // has accumulated since. Without the leftovers a single outage would park
  // those records on disk forever.
  const pending = leftovers();

  try {
    if (sizeOf(SPOOL) > 0) {
      // Claim the spool by renaming it: a concurrent flush cannot send these
      // twice, and records written while we are in flight land in a fresh one.
      const claimed = path.join(STATE_DIR, `outbox-${Date.now()}-${process.pid}.jsonl`);
      fs.renameSync(SPOOL, claimed);
      pending.push(claimed);
    }
  } catch (err) {
    note('flush claim failed', err);
  }

  if (!pending.length) return process.exit(0);

  send(pending, 0);
}

/** Undelivered outbox files, oldest first. */
function leftovers() {
  try {
    return fs.readdirSync(STATE_DIR)
      .filter(f => f.startsWith('outbox-') && f.endsWith('.jsonl'))
      .sort()
      .slice(0, MAX_OUTBOX_FILES)
      .map(f => path.join(STATE_DIR, f));
  } catch {
    return [];
  }
}

/**
 * Deliver the queue one file at a time.
 *
 * Sequential on purpose: the point of a retry is to drain a backlog after an
 * outage, and firing every stale file at a server that just came back is how
 * you knock it over again. A transport failure stops the run and leaves the
 * rest for next time.
 */
function send(files, index) {
  if (index >= files.length) return process.exit(0);

  const file = files[index];
  const batch = read(file);

  if (!batch.length) {
    remove(file);
    return send(files, index + 1);
  }

  post(batch, ok => {
    // Sent, or rejected as malformed — either way retrying changes nothing.
    // A transport failure keeps the file so the next flush picks it up.
    if (ok) {
      remove(file);
      return send(files, index + 1);
    }
    process.exit(0);
  });
}

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8')
      .split('\n').filter(l => l.trim())
      .slice(0, MAX_BATCH)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function post(batch, done) {
  let url;
  try { url = new URL(ENDPOINT); } catch { return done(false); }

  const body = Buffer.from(JSON.stringify({ records: batch }), 'utf8');
  const transport = url.protocol === 'https:' ? require('https') : require('http');

  const req = transport.request({
    method: 'POST',
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    timeout: FLUSH_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': body.length,
      // In a header rather than the body so it cannot end up copied into a
      // stored record.
      'X-AI-Usage-Device': deviceSecret(),
      Accept: 'application/json',
    },
  }, res => {
    res.resume();
    const code = res.statusCode || 0;

    // 403: the dashboard blocked this machine. Stop collecting rather than
    // keep asking — being told no is an answer.
    if (code === 403) {
      write(BLOCKED_FILE, new Date().toISOString());
      return done(true);
    }

    // 409: known machine, not approved yet. Keep the batch and try again later,
    // so the work done before someone clicks approve is not thrown away.
    if (code === 409) return done(false);

    // Anything else in the 4xx range will never be accepted, retry or not.
    done((code >= 200 && code < 300) || (code >= 400 && code < 500 && code !== 429));
  });

  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', err => { note('post failed', err); done(false); });
  req.end(body);
}

// ------------------------------------------------------------------- helpers

function sha(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function num(v) { return Number.isFinite(v) ? v : 0; }
function round(v, d) { return Number.isFinite(v) ? Number(v.toFixed(d)) : null; }

function fileExists(file) {
  try { return fs.existsSync(file); } catch { return false; }
}

function sizeOf(file) {
  try { return file ? fs.statSync(file).size : 0; } catch { return 0; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function write(file, contents) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  } catch (err) {
    note('write failed', err);
  }
}

function remove(file) {
  try { fs.unlinkSync(file); } catch { /* already gone */ }
}

function run(cmd, args, timeout) {
  try {
    const { execFileSync } = require('child_process');
    return execFileSync(cmd, args, {
      timeout,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;   // not installed, not a repo, not logged in
  }
}

/** Errors go to a local log, never to stdout. */
function note(what, err) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${what}: ${err && err.message}\n`);
  } catch { /* nothing left to try */ }
}
