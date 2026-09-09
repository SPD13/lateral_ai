import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_DIR = process.env.TEMPLATE_DIR || path.join(__dirname, 'templates');

export const INTENTS = ['question', 'hint', 'guess', 'reveal'];

function readTemplate(rel) {
  return fs.readFileSync(path.join(TEMPLATE_DIR, rel), 'utf8');
}

/** Replace every {{PLACEHOLDER}} in the template; unknown placeholders are left as-is. */
export function render(template, vars) {
  return template.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}

function formatHistory(history) {
  if (!history.length) return '(no messages yet)';
  return history
    .map((m) => {
      if (m.role === 'user') return `Player (${m.intent}): ${m.text}`;
      const tag = m.kind === 'answer' ? `answer=${m.answer}` : m.kind === 'verdict' ? `verdict=${m.verdict}` : m.kind;
      return `Game master [${tag}]: ${m.text}`;
    })
    .join('\n');
}

function formatHints(hints, given) {
  if (!hints.length) return '(no prepared hints; craft your own if asked)';
  return hints.map((h, i) => `${i + 1}. ${h}${i < given ? '  [already given]' : ''}`).join('\n');
}

function formatKeyFacts(facts) {
  return facts.length ? facts.map((f) => `- ${f}`).join('\n') : '(none listed; use the solution as the reference)';
}

/** Build the system prompt and the user prompt for one turn. */
export function buildPrompt({ puzzle, progress, intent, text }) {
  if (!INTENTS.includes(intent)) throw new Error(`unknown intent "${intent}"`);
  const system = readTemplate('system.md').trim();
  const intentInstructions = readTemplate(path.join('intents', `${intent}.md`)).trim();
  const user = render(readTemplate('context.md'), {
    PUZZLE_TITLE: puzzle.title,
    PUZZLE_ID: puzzle.id,
    DIFFICULTY: puzzle.difficulty,
    SITUATION: puzzle.situation,
    SOLUTION: puzzle.solution,
    KEY_FACTS: formatKeyFacts(puzzle.keyFacts),
    HINTS: formatHints(puzzle.hints, progress.hintsGiven),
    HINTS_GIVEN_COUNT: progress.hintsGiven,
    HISTORY: formatHistory(progress.history),
    INTENT: intent,
    USER_MESSAGE: text || '(no text)',
    INTENT_INSTRUCTIONS: intentInstructions,
  });
  return { system, user };
}
