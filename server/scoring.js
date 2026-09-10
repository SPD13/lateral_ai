import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCORING_FILE = process.env.SCORING_FILE || path.join(__dirname, '..', 'data', 'scoring.json');

/** What a solved puzzle is worth, and what each step toward it costs. */
export const DEFAULT_SCORING = {
  difficulty: { easy: 2, medium: 3, hard: 4 },
  costs: { question: 0.1, hint: 0.5, try: 0.2 },
};

const LIMITS = { difficulty: 100, costs: 10 };

let cache = null;
let cachedMtime = -1;

function mtime() {
  try { return fs.statSync(SCORING_FILE).mtimeMs; } catch { return 0; }
}

/** The weights in force, re-read when the file changes so an edit needs no restart. */
export function getScoring() {
  const m = mtime();
  if (cache && m === cachedMtime) return cache;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(SCORING_FILE, 'utf8')); } catch { /* defaults */ }
  cache = merge(raw);
  cachedMtime = m;
  return cache;
}

function number(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) return fallback;
  return Math.round(n * 100) / 100;
}

function merge(raw) {
  const out = { difficulty: {}, costs: {} };
  for (const key of Object.keys(DEFAULT_SCORING.difficulty)) {
    out.difficulty[key] = number(raw?.difficulty?.[key], DEFAULT_SCORING.difficulty[key], LIMITS.difficulty);
  }
  for (const key of Object.keys(DEFAULT_SCORING.costs)) {
    out.costs[key] = number(raw?.costs?.[key], DEFAULT_SCORING.costs[key], LIMITS.costs);
  }
  return out;
}

/** Replace the weights. Every value must be a number between 0 and its limit. Throws otherwise. */
export function saveScoring(next) {
  if (!next || typeof next !== 'object') throw new Error('Scoring weights are required');
  const checked = { difficulty: {}, costs: {} };
  for (const [group, limit] of [['difficulty', LIMITS.difficulty], ['costs', LIMITS.costs]]) {
    for (const key of Object.keys(DEFAULT_SCORING[group])) {
      const value = Number(next?.[group]?.[key]);
      if (!Number.isFinite(value) || value < 0 || value > limit) {
        throw new Error(`"${key}" must be a number between 0 and ${limit}`);
      }
      checked[group][key] = Math.round(value * 100) / 100;
    }
  }
  fs.mkdirSync(path.dirname(SCORING_FILE), { recursive: true });
  const tmp = SCORING_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(checked, null, 2) + '\n');
  fs.renameSync(tmp, SCORING_FILE);
  cache = checked;
  cachedMtime = mtime();
  return checked;
}
