#!/usr/bin/env node
// UserPromptSubmit router: decides whether a prompt needs orchestrated work.
//
// The orchestrate skill + workflow pipelines exist to run multi-step engineering
// work (plan → test → implement → review → PR). Forcing every prompt through
// them — questions, one-liners, slash commands — burns a full hop for nothing.
//
// Classification tiers:
//   bypass  → emit nothing; the main loop answers directly
//   suggest → soft hint; the model decides
//   route   → invoke the orchestrate skill for full pipeline dispatch
//
// Tech-agnostic and language-aware (ES/EN), since prompts arrive in both.

const path = require('path');

const MAX_TRIVIAL_CHARS = 120;  // chatter / lookup ceiling
const MAX_ONELINER_CHARS = 60;  // "one small edit" ceiling

const ESCAPE =
  /\b(sin orquestador|sin orchestrator|no orchestrator|skip orchestrator|sin workflow|no workflow|skip workflow|sin delegar|no delegues|directo|hazlo vos|hacelo vos|do it yourself)\b/i;

const FORCE = /\b(orquestador|orchestrator|orquesta|orchestrate|workflow)\b/i;

const QUESTION_OPENER =
  /^\s*(qu[eé]|c[oó]mo|por qu[eé]|para qu[eé]|d[oó]nde|cu[aá]l(es)?|qui[eé]n|cu[aá]ndo|cu[aá]nto|hay|ten[eé]s|tienes|sab[eé]s|sabes|pod[eé]s explicar|puedes explicar|expli(ca|came|c[aá])|mostr(a|á|ame)|muestra|list(a|á|ame)|resum(i|í|e|ime)|dec(i|í|ime)|dime|what|how|why|where|which|who|when|is|are|does|do|can|could|should|explain|show|list|summar(y|ize)|tell)\b/i;

const WORK_INTENT =
  /\b(implement(a|ar|á|e|o|ing)?|desarroll(a|ar|á|e|o)|cod(ea|ear|e|ing)|program(a|ar|á|o)|constru(i|í|ye|ir)|build|crea(r|me|á)?|cre[aá]|add|agreg(a|ar|á|ame|o|ue)|a[ñn]ad(e|ir|í|o)|fix|arregl(a|ar|á)|corrig(e|ir)|solucion(a|ar|á)|repar(a|ar|á)|refactor(iza|izar|ing)?|migrat(e|ion)|migr(a|ar|á)|renombr(a|ar)|renam(e|ing)|borr(a|ar|á)|elimin(a|ar|á)|delete|remov(e|er)|plan(ifica|ificar|ear|ea)?|dise[ñn](a|ar|á)|test(ea|ear|s)?|deploy|release|integr(a|ar|á)|conect(a|ar|á)|setup|configur(a|ar|á))\b/i;

const WORK_DOMAIN =
  /\b(ticket|CU-[a-z0-9]+|pull request|\bPR\b|feature|funcionalidad|historia de usuario|user story|bug(fix)?|design system|storybook|wiki|a11y|accesibilidad|accessibility|code review|revisi[oó]n de c[oó]digo|sprint|epic|[eé]pica|subtarea|subtask)\b/i;

// Intent-specific patterns for workflow suggestion.
const BUG_INTENT =
  /\b(bug|error|broken|roto|falla|crash|regres(s|i[oó]n)|fix|arregl|corrig|solucion|repar|no funciona|doesn.t work|not working)\b/i;

const REFACTOR_INTENT =
  /\b(refactor(iza|izar|ing)?|restructur|reestructur|reorgani|clean.?up|limpiar|simplif)/i;

const IMPLEMENT_INTENT =
  /\b(implement(a|ar|á|e|o|ing)?|the plan|el plan|subtask|subtarea|already planned|ya planificado)/i;

const pluginRoot = path.resolve(__dirname, '..');

let raw = '';
process.stdin.on('data', c => (raw += c));
process.stdin.on('end', () => {
  let prompt = '';
  try {
    prompt = (JSON.parse(raw || '{}').prompt || '').trim();
  } catch {
    process.exit(0);
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: contextFor(prompt),
    },
  }));
  process.exit(0);
});

function contextFor(prompt) {
  var tier = classify(prompt);
  if (tier === 'bypass') return '';

  var intent = classifyIntent(prompt);
  var workflowFile = intent + '.js';
  var scriptPath = path.join(pluginRoot, 'workflows', workflowFile);

  if (tier === 'route') {
    return (
      'This request looks like multi-step engineering work. Invoke the ' +
      'axis-human-ai-toolbox:orchestrate skill to classify the intent, set up ' +
      'the environment, and launch the appropriate workflow pipeline.\n\n' +
      'The router hook pre-classified the intent as: ' + intent + '\n' +
      'Suggested workflow: ' + scriptPath + '\n\n' +
      'Available workflows in ' + path.join(pluginRoot, 'workflows') + ':\n' +
      '  quick-task.js — plan → test → implement → review → PR\n' +
      '  implement.js  — test → implement → review → PR (plan already exists)\n' +
      '  refactor.js   — plan → implement → review → PR (behavior unchanged)\n' +
      '  bug-fix.js    — reproduce → fix → review → PR\n\n' +
      'If on inspection this is a trivial edit or a question, answer it directly instead.'
    );
  }

  // tier === 'suggest'
  return (
    'If this turns out to need planning, implementation across several files, or a PR, ' +
    'consider invoking the axis-human-ai-toolbox:orchestrate skill. Workflow pipelines ' +
    'are at: ' + path.join(pluginRoot, 'workflows') + '/\n' +
    'For a question, a lookup, or a small local change, just answer or do it directly.'
  );
}

function classify(prompt) {
  if (!prompt) return 'bypass';

  if (ESCAPE.test(prompt)) return 'bypass';
  if (FORCE.test(prompt)) return 'route';

  if (prompt.startsWith('/')) return 'bypass';

  var domain = WORK_DOMAIN.test(prompt);
  var work = domain || WORK_INTENT.test(prompt);

  if (QUESTION_OPENER.test(prompt) && !work) return 'bypass';
  if (prompt.length <= MAX_TRIVIAL_CHARS && !work) return 'bypass';

  if (!work) return 'suggest';

  if (!domain && prompt.length <= MAX_ONELINER_CHARS) return 'suggest';

  return 'route';
}

function classifyIntent(prompt) {
  if (BUG_INTENT.test(prompt)) return 'bug-fix';
  if (REFACTOR_INTENT.test(prompt)) return 'refactor';
  if (IMPLEMENT_INTENT.test(prompt) && !WORK_DOMAIN.test(prompt)) return 'implement';
  return 'quick-task';
}
