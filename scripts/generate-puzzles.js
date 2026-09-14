#!/usr/bin/env node
/**
 * Offline puzzle generator (no review step): asks the puzzle writer model for new lateral thinking
 * puzzles and appends them straight to data/puzzles.json, skipping duplicates.
 * The web UI at /generate does the same with a review step.
 *
 *   node scripts/generate-puzzles.js --count 5 --difficulty hard [--model opus] [--no-web] [--dry-run]
 */
import { runClaude } from '../server/claude.js';
import { addPuzzle, loadPuzzles, validatePuzzle, modelFamily } from '../server/puzzles.js';
import { buildGeneratePrompt, parsePuzzleArray, duplicateReason, GENERATOR_MODEL, GENERATOR_TOOLS, GENERATOR_TIMEOUT_MS } from '../server/generator.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const count = Number(args.count || 5);
const difficulty = args.difficulty || 'mixed';
const model = args.model || GENERATOR_MODEL;
const dryRun = Boolean(args['dry-run']);
const webSearch = !args['no-web'] && GENERATOR_TOOLS.length > 0;
const tools = webSearch ? GENERATOR_TOOLS : [];

console.error(`Generating ${count} ${difficulty} puzzles with ${model} (web search ${webSearch ? 'on' : 'off'})…`);
const { system, user } = buildGeneratePrompt({ count, difficulty, webSearch });
const { text, cost } = await runClaude({ system, user, model, tools, timeoutMs: GENERATOR_TIMEOUT_MS });
let arr;
try { arr = parsePuzzleArray(text); } catch (e) {
  if (e.declined) { console.error('The puzzle writer did not write anything:', e.message); process.exit(2); }
  console.error('Could not parse model output:', e.message, '\n', text);
  process.exit(1);
}

let added = 0;
for (const item of arr) {
  let p;
  try { p = validatePuzzle({ ...item, difficulty: difficulty === 'mixed' ? item.difficulty : difficulty, model: modelFamily(model) }); } catch (e) { console.error(`skip "${item?.title}": ${e.message}`); continue; }
  const dup = duplicateReason(p, loadPuzzles());
  if (dup) { console.error(`skip "${p.title}": ${dup}`); continue; }
  if (dryRun) { console.log(JSON.stringify(p, null, 2)); added++; continue; }
  const stored = addPuzzle(p);
  console.error(`added "${stored.title}" as ${stored.id}`);
  added++;
}
console.error(`${dryRun ? 'Would add' : 'Added'} ${added} puzzle(s)${cost != null ? ` · $${cost.toFixed(3)}` : ''}; bank now has ${loadPuzzles().length}.`);
