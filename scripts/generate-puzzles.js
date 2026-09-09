#!/usr/bin/env node
/**
 * Offline puzzle generator. Asks the Claude CLI for new lateral thinking puzzles and appends
 * them to data/puzzles.json (skipping duplicate ids and titles).
 *
 *   node scripts/generate-puzzles.js --count 5 --difficulty hard [--model opus] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude } from '../server/claude.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'puzzles.json');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const count = Number(args.count || 5);
const difficulty = args.difficulty || 'medium';
const dryRun = Boolean(args['dry-run']);
if (args.model) process.env.CLAUDE_MODEL = args.model;

const existing = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const known = existing.map((p) => `- ${p.title}: ${p.situation.slice(0, 80)}`).join('\n');

const system = 'You write original lateral thinking puzzles ("situation puzzles") for a yes/no question game. You reply with JSON only.';
const user = `Write ${count} NEW lateral thinking puzzles of difficulty "${difficulty}".

Requirements:
- Each puzzle is a short, intriguing situation with a surprising but fair, unambiguous explanation.
- The explanation must be reachable through yes/no questions; no trick wording, no puns that only work in one language unless clearly fair.
- Difficulty guide: easy = 1 twist, familiar setting; medium = 2 linked twists; hard = 3+ steps of reasoning or a very unexpected reframing.
- Avoid these existing puzzles and anything closely resembling them:
${known}

Return a JSON array only, no prose, with objects of this exact shape:
{
  "id": "kebab-case-unique-id",
  "title": "Short title",
  "difficulty": "${difficulty}",
  "situation": "What the player sees (2-4 sentences, ends with a question such as 'What happened?' or 'Why?')",
  "solution": "The full explanation (2-5 sentences)",
  "keyFacts": ["fact a correct answer must include", "..."],
  "hints": ["gentle hint", "stronger hint", "almost gives it away"]
}`;

console.error(`Generating ${count} ${difficulty} puzzles with model ${process.env.CLAUDE_MODEL || 'sonnet'}…`);
const { text } = await runClaude({ system, user });
let arr;
try {
  const s = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '');
  arr = JSON.parse(s.slice(s.indexOf('['), s.lastIndexOf(']') + 1));
} catch (e) {
  console.error('Could not parse model output:\n', text);
  process.exit(1);
}

const ids = new Set(existing.map((p) => p.id));
const titles = new Set(existing.map((p) => p.title.toLowerCase()));
const added = [];
for (const p of arr) {
  if (!p.id || !p.situation || !p.solution) continue;
  if (ids.has(p.id) || titles.has(String(p.title).toLowerCase())) { console.error(`skip duplicate: ${p.id}`); continue; }
  p.difficulty = difficulty;
  p.keyFacts = Array.isArray(p.keyFacts) ? p.keyFacts : [];
  p.hints = Array.isArray(p.hints) ? p.hints : [];
  added.push(p); ids.add(p.id);
}
if (dryRun) { console.log(JSON.stringify(added, null, 2)); process.exit(0); }
fs.writeFileSync(FILE, JSON.stringify([...existing, ...added], null, 2) + '\n');
console.error(`Added ${added.length} puzzles to ${path.relative(process.cwd(), FILE)} (${existing.length + added.length} total).`);
