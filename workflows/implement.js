export const meta = {
  name: 'implement',
  description: 'Test, implement, review and deliver a task whose plan already exists',
  whenToUse: 'A task that already has a plan or detailed spec — skip straight to TDD and coding',
  phases: [
    { title: 'Test', detail: 'Write failing tests — TDD red phase' },
    { title: 'Implement', detail: 'Write production code and commit' },
    { title: 'Review', detail: 'Independent review, fix loop, and PR' },
  ],
}

const AGENTS = {
  qa: 'axis-human-ai-toolbox:quality-assurance-agent',
  implementer: 'axis-human-ai-toolbox:implement-task-agent',
  reviewer: 'axis-human-ai-toolbox:reviewer-agent',
}

const QA_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    tests_created: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string' } },
        required: ['file'],
      },
    },
    all_tests_red: { type: 'boolean' },
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
var subtaskSummary = (args && args.subtasks) || description

// --- 1. Test (TDD red phase) ---
phase('Test')
log('Writing failing tests…')

var qa = await agent(
  [
    ticketId ? 'TICKET_ID: ' + ticketId : null,
    'SUBTASK_LIST / SPEC:',
    subtaskSummary,
    '',
    'Write failing tests (TDD red phase) for these subtasks.',
    'Return structured output with the test manifest.',
  ].filter(Boolean).join('\n'),
  { agentType: AGENTS.qa, phase: 'Test', label: 'quality-assurance', schema: QA_SCHEMA, effort: 'medium' }
)

if (qa && qa.status === 'blocked') {
  log('QA agent blocked — aborting.')
  return { status: 'failed', phase: 'test' }
}
log(qa && qa.status === 'skipped' ? 'Tests skipped — no test suite detected' : 'Tests written (red phase)')

// --- 2. Implement ---
phase('Implement')
log('Implementing…')

var impl = await agent(
  [
    'Intent: implementation',
    ticketId ? 'TICKET_ID: ' + ticketId : null,
    branch ? 'Branch: ' + branch : null,
    'Base branch: ' + baseBranch,
    '',
    'SUBTASK_LIST / SPEC:',
    subtaskSummary,
    '',
    'Implement all items. Run code-review and a11y-auditor.',
    'Commit your changes but do NOT open a PR — the review gate handles delivery.',
    'Return structured output with status and changed files.',
  ].filter(Boolean).join('\n'),
  { agentType: AGENTS.implementer, phase: 'Implement', label: 'implement-task', schema: IMPL_SCHEMA }
)

if (!impl || impl.status === 'blocked') {
  log('Implementation blocked.')
  return { status: 'failed', phase: 'implement', blockers: impl ? impl.blockers : [] }
}
log('Implementation complete: ' + (impl.files_changed || []).length + ' files changed')

// --- 3. Review (with fix-and-retry loop) ---
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
        'The reviewer found blocking issues. Fix ONLY these:',
        '- ' + blockerList,
        '',
        'Do not expand scope. Commit the fixes.',
      ].join('\n'),
      { agentType: AGENTS.implementer, phase: 'Review', label: 'fix-review-' + (retries + 1), schema: IMPL_SCHEMA }
    )
  }
  retries++
}

if (!review || review.verdict !== 'approve_pr') {
  log('Review not approved after retries.')
  return { status: 'blocked', phase: 'review', findings: review ? review.findings : [] }
}

// --- 4. Create PR ---
log('Creating pull request…')
var prNotes = (review.pr_notes || []).join('\n')

var pr = await agent(
  [
    'Create a draft pull request for the current branch against ' + baseBranch + '.',
    ticketId ? 'Ticket: ' + ticketId : null,
    prNotes ? 'Reviewer notes to include in the description:\n' + prNotes : null,
    '',
    'Use the create-draft-pr skill. Return the PR URL.',
  ].filter(Boolean).join('\n'),
  { agentType: AGENTS.implementer, phase: 'Review', label: 'create-pr', effort: 'low' }
)

log('Pipeline complete.')
return {
  status: 'success',
  tests: qa ? { status: qa.status, count: (qa.tests_created || []).length } : null,
  implementation: { files_changed: impl.files_changed || [] },
  review: { verdict: review.verdict, finding_count: (review.findings || []).length },
  pr: pr,
}
