#!/usr/bin/env node
// UserPromptSubmit router: decides whether a prompt is worth orchestrating.
//
// The orchestrator exists to route multi-step engineering work. Forcing every
// prompt through it — questions, one-liners, slash commands — burns a full agent
// hop for nothing. This classifies the prompt into three tiers:
//
//   bypass  → emit nothing; the main loop answers directly
//   suggest → soft hint; the model decides
//   route   → mandatory orchestrator delegation
//
// Tech-agnostic and language-aware (ES/EN), since prompts arrive in both.

const MAX_TRIVIAL_CHARS = 120;  // chatter / lookup ceiling
const MAX_ONELINER_CHARS = 60;  // "one small edit" ceiling

// Explicit opt-out, written by the user in either language.
const ESCAPE =
  /\b(sin orquestador|sin orchestrator|no orchestrator|skip orchestrator|sin delegar|no delegues|directo|hazlo vos|hacelo vos|do it yourself)\b/i;

// Explicit opt-in, for when the heuristics would otherwise under-trigger.
const FORCE = /\b(orquestador|orchestrator|orquesta|orchestrate)\b/i;

// Read-only / conversational openers. A prompt that starts like this is asking,
// not commissioning work.
const QUESTION_OPENER =
  /^\s*(qu[eé]|c[oó]mo|por qu[eé]|para qu[eé]|d[oó]nde|cu[aá]l(es)?|qui[eé]n|cu[aá]ndo|cu[aá]nto|hay|ten[eé]s|tienes|sab[eé]s|sabes|pod[eé]s explicar|puedes explicar|expli(ca|came|c[aá])|mostr(a|á|ame)|muestra|list(a|á|ame)|resum(i|í|e|ime)|dec(i|í|ime)|dime|what|how|why|where|which|who|when|is|are|does|do|can|could|should|explain|show|list|summar(y|ize)|tell)\b/i;

// Verbs that commission actual engineering work.
const WORK_INTENT =
  /\b(implement(a|ar|á|e|o|ing)?|desarroll(a|ar|á|e|o)|cod(ea|ear|e|ing)|program(a|ar|á|o)|constru(i|í|ye|ir)|build|crea(r|me|á)?|cre[aá]|add|agreg(a|ar|á|ame|o|ue)|a[ñn]ad(e|ir|í|o)|fix|arregl(a|ar|á)|corrig(e|ir)|solucion(a|ar|á)|repar(a|ar|á)|refactor(iza|izar|ing)?|migrat(e|ion)|migr(a|ar|á)|renombr(a|ar)|renam(e|ing)|borr(a|ar|á)|elimin(a|ar|á)|delete|remov(e|er)|plan(ifica|ificar|ear|ea)?|dise[ñn](a|ar|á)|test(ea|ear|s)?|deploy|release|integr(a|ar|á)|conect(a|ar|á)|setup|configur(a|ar|á))\b/i;

// Domain nouns that mark a prompt as toolbox territory even without a verb.
const WORK_DOMAIN =
  /\b(ticket|CU-[a-z0-9]+|pull request|\bPR\b|feature|funcionalidad|historia de usuario|user story|bug(fix)?|design system|storybook|wiki|a11y|accesibilidad|accessibility|code review|revisi[oó]n de c[oó]digo|sprint|epic|[eé]pica|subtarea|subtask)\b/i;

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
  switch (classify(prompt)) {
    case 'route':
      return (
        'This request looks like multi-step engineering work. Handle it through the ' +
        'axis-human-ai-toolbox:orchestrator-agent so it gets planned, implemented, reviewed ' +
        'and delivered through the toolbox pipeline. If on inspection it turns out to be a ' +
        'single trivial edit or a question, answer it directly instead — do not delegate for ' +
        'its own sake.'
      );
    case 'suggest':
      return (
        'If this turns out to need planning, implementation across several files, or a PR, ' +
        'consider routing it through axis-human-ai-toolbox:orchestrator-agent. For a question, ' +
        'a lookup or a small local change, just answer or do it directly.'
      );
    default:
      return '';
  }
}

function classify(prompt) {
  if (!prompt) return 'bypass';

  // The user asked to be left alone, or asked for the orchestrator by name.
  if (ESCAPE.test(prompt)) return 'bypass';
  if (FORCE.test(prompt)) return 'route';

  // Slash commands and skills are already an explicit routing decision.
  if (prompt.startsWith('/')) return 'bypass';

  const domain = WORK_DOMAIN.test(prompt);
  const work = domain || WORK_INTENT.test(prompt);

  // A question stays a question unless it also commissions work
  // ("how do I add X?" is a question; "add X and open a PR" is not).
  if (QUESTION_OPENER.test(prompt) && !work) return 'bypass';

  // Short, verb-less prompts are chatter, acknowledgements or lookups.
  if (prompt.length <= MAX_TRIVIAL_CHARS && !work) return 'bypass';

  if (!work) return 'suggest';

  // A work verb in a one-line prompt with no toolbox vocabulary is usually a
  // small local edit ("add .idea to gitignore"). Full delegation costs more
  // than the edit; leave the call to the model.
  if (!domain && prompt.length <= MAX_ONELINER_CHARS) return 'suggest';

  return 'route';
}
