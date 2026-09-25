export const meta = {
  name: 'bug-fix',
  description: 'Reproduce, fix, review and deliver a bug patch',
  whenToUse: 'A broken behavior, error, or regression — isolated scope, no new features',
  phases: [
    { title: 'Fix', detail: 'Reproduce with a test, isolate, and patch' },
    { title: 'Review', detail: 'Independent review, fix loop, and PR' },
  ],
}

const AGENTS = {
  bugfixer: 'axis-human-ai-toolbox:bugfixer-agent',
  implementer: 'axis-human-ai-toolbox:implement-task-agent',
  reviewer: 'axis-human-ai-toolbox:reviewer-agent',
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    root_cause: { type: 'string' },
    files_modified: { type: 'array', items: { type: 'string' } },
    reproducing_test: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        method: { type: 'string' },
      },
      required: ['file'],
    },
    test_results: {
      type: 'object',
      properties: {
        targeted_test: { type: 'string' },
        full_suite: { type: 'string' },
      },
      required: ['targeted_test'],
    },
    build_status: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['status'],
}

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['status'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string' },
          file: { type: 'string' },
          issue: { type: 'string' },
        },
        required: ['severity', 'file', 'issue'],
      },
    },
    pr_notes: { type: 'array', items: { type: 'string' } },
    blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict'],
}

// ---------------------------------------------------------------------------

var description = (args && args.description) || ''
var ticketId = (args && args.ticketId) || ''
var branch = (args && args.branch) || ''
var baseBranch = (args && args.baseBranch) || 'main'

// --- 1. Fix ---
phase('Fix')
log('Reproducing and fixing bug…')

var fix = await agent(
  [
    ticketId ? 'TICKET_ID: ' + ticketId : null,
    branch ? 'BRANCH: ' + branch : null,
    'Description: ' + description,
    '',
    'Reproduce this bug with a failing test, isolate the root cause, apply a minimal patch,',
    'and verify all tests pass. Do NOT open a PR — the review gate handles delivery.',
    'Return structured output with status and details.',
  ].filter(Boolean).join('\n'),
  { agentType: AGENTS.bugfixer, phase: 'Fix', label: 'bugfixer', schema: FIX_SCHEMA }
)

if (!fix || fix.status === 'blocked') {
  log('Bug fix blocked' + (fix && fix.blockers ? ': ' + fix.blockers.join(', ') : '') + '.')
  return { status: 'blocked', phase: 'fix', root_cause: fix ? fix.root_cause : null, blockers: fix ? fix.blockers : [] }
}
log('Fix applied — root cause: ' + (fix.root_cause || 'identified'))

// --- 2. Review (with fix-and-retry loop) ---
phase('Review')
var review = null
var retries = 0
var MAX_RETRIES = 2

while (retries <= MAX_RETRIES) {
  log(retries === 0 ? 'Running independent review…' : 'Re-reviewing (attempt ' + (retries + 1) + ')…')

  review = await agent(
    [
      branch ? 'BRANCH: ' + branch : null,
      'BASE_BRANCH: ' + baseBranch,
      ticketId ? 'TICKET_ID: ' + ticketId : null,
      '',
      'Review the current diff against ' + baseBranch + '.',
      'This is a bug fix — verify the patch is minimal and correct.',
      'Return structured output with verdict and findings.',
    ].filter(Boolean).join('\n'),
    {
      agentType: AGENTS.reviewer,
      phase: 'Review',
      label: retries === 0 ? 'reviewer' : 'reviewer-retry-' + retries,
      schema: REVIEW_SCHEMA,
      effort: 'medium',
    }
  )

  if (!review || review.verdict === 'approve_pr') break

  if (retries < MAX_RETRIES) {
    var blockerList = (review.blockers || review.findings || [])
      .map(function (b) { return typeof b === 'string' ? b : b.issue })
      .join('\n- ')
    log('Review blocked. Sending fixes…')

    await agent(
      [
        'The reviewer found blocking issues in the bug-fix patch. Fix ONLY these:',
        '- ' + blockerList,
        '',
        'Keep the fix minimal. Commit the changes.',
      ].join('\n'),
      { agentType: AGENTS.bugfixer, phase: 'Review', label: 'fix-review-' + (retries + 1), schema: IMPL_SCHEMA }
    )
  }
  retries++
}

if (!review || review.verdict !== 'approve_pr') {
  log('Review not approved after retries.')
  return { status: 'blocked', phase: 'review', findings: review ? review.findings : [] }
}

// --- 3. Create PR ---
log('Creating pull request…')
var prNotes = (review.pr_notes || []).join('\n')

var pr = await agent(
  [
    'Create a draft pull request for the current branch against ' + baseBranch + '.',
    ticketId ? 'Ticket: ' + ticketId : null,
    'Root cause: ' + (fix.root_cause || 'see diff'),
    prNotes ? 'Reviewer notes to include in the description:\n' + prNotes : null,
    '',
    'Use the create-draft-pr skill. Return the PR URL.',
  ].filter(Boolean).join('\n'),
  { agentType: AGENTS.implementer, phase: 'Review', label: 'create-pr', effort: 'low' }
)

log('Pipeline complete.')
return {
  status: 'success',
  fix: { root_cause: fix.root_cause, files: fix.files_modified || [] },
  review: { verdict: review.verdict, finding_count: (review.findings || []).length },
  pr: pr,
}
