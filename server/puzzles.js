import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PUZZLES_FILE = process.env.PUZZLES_FILE || path.join(__dirname, '..', 'data', 'puzzles.json');

const DIFFICULTIES = ['easy', 'medium', 'hard'];

let cache = { mtime: 0, list: [], byId: new Map() };

/** Load the puzzle bank, re-reading the file when it changes on disk. */
export function loadPuzzles() {
  const stat = fs.statSync(PUZZLES_FILE);
  if (stat.mtimeMs !== cache.mtime) {
    const raw = JSON.parse(fs.readFileSync(PUZZLES_FILE, 'utf8'));
    const list = raw.map(validate);
    cache = { mtime: stat.mtimeMs, list, byId: new Map(list.map((p) => [p.id, p])) };
  }
  return cache.list;
}

export function getPuzzle(id) {
  loadPuzzles();
  return cache.byId.get(id) || null;
}

/** Public view of a puzzle: never includes the solution, key facts or hints. */
export function publicPuzzle(p) {
  return { id: p.id, title: p.title, difficulty: p.difficulty, situation: p.situation, hintCount: p.hints.length };
}

function validate(p, i) {
  for (const k of ['id', 'title', 'difficulty', 'situation', 'solution']) {
    if (typeof p[k] !== 'string' || !p[k].trim()) throw new Error(`puzzles.json entry #${i} is missing "${k}"`);
  }
  if (!DIFFICULTIES.includes(p.difficulty)) throw new Error(`puzzle "${p.id}" has unknown difficulty "${p.difficulty}"`);
  return { ...p, keyFacts: Array.isArray(p.keyFacts) ? p.keyFacts : [], hints: Array.isArray(p.hints) ? p.hints : [] };
}
