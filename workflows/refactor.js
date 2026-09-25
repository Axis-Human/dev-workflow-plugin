export const meta = {
  name: 'refactor',
  description: 'Plan, implement, review and deliver a refactor without changing behavior',
  whenToUse: 'Improving existing code structure, renaming, extracting, or reorganizing without changing behavior',
  phases: [
    { title: 'Plan', detail: 'Decompose into ordered subtasks' },
    { title: 'Implement', detail: 'Apply refactoring and commit' },
    { title: 'Review', detail: 'Independent review, fix loop, and PR' },
  ],
}

const AGENTS = {
  planner: 'axis-human-ai-toolbox:plan-expert-agent',
  implementer: 'axis-human-ai-toolbox:implement-task-agent',
  reviewer: 'axis-human-ai-toolbox:reviewer-agent',
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    subtasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          depends_on: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title'],
      },
    },
    ticket_id: { type: 'string' },
  },
  required: ['subtasks'],
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

// --- 1. Plan ---
phase('Plan')
log('Planning refactor…')

var plan = await agent(
  [
    'Intent: refactor',
    ticketId ? 'TICKET_ID: ' + ticketId : null,
    'Description: ' + description,
    '',
    'This is a refactor — behavior must not change.',
    'Decompose into ordered subtasks using the 8-section template.',
    'Return structured output with the subtask list.',
  ].filter(Boolean).join('\n'),
  { agentType: AGENTS.planner, phase: 'Plan', label: 'plan-expert', schema: PLAN_SCHEMA }
)

if (!plan || !plan.subtasks || plan.subtasks.length === 0) {
  log('Planning produced no subtasks — aborting.')
  return { status: 'failed', phase: 'plan' }
}
log('Plan ready: ' + plan.subtasks.length + ' subtasks')

var subtaskSummary = plan.subtasks.map(function (s) { return '- ' + s.id + ': ' + s.title }).join('\n')

// --- 2. Implement ---
phase('Implement')
log('Applying refactoring…')

var impl = await agent(
  [
    'Intent: refactor',
    ticketId ? 'TICKET_ID: ' + ticketId : null,
    branch ? 'Branch: ' + branch : null,
    'Base branch: ' + baseBranch,
    '',
    'SUBTASK_LIST:',
    subtaskSummary,
    '',
    'This is a refactor — do not change behavior.',
    'Implement all subtasks. Run code-review. Commit your changes.',
    'Do NOT open a PR — the review gate handles delivery.',
    'Return structured output with status and changed files.',
  ].filter(Boolean).join('\n'),
  { agentType: AGENTS.implementer, phase: 'Implement', label: 'implement-task', schema: IMPL_SCHEMA }
)

if (!impl || impl.status === 'blocked') {
  log('Implementation blocked.')
  return { status: 'failed', phase: 'implement', blockers: impl ? impl.blockers : [] }
}
log('Refactoring complete: ' + (impl.files_changed || []).length + ' files changed')

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
      'This is a refactor — verify behavior is preserved.',
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
  plan: { subtask_count: plan.subtasks.length },
  implementation: { files_changed: impl.files_changed || [] },
  review: { verdict: review.verdict, finding_count: (review.findings || []).length },
  pr: pr,
}
