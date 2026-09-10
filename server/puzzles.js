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
  return { id: p.id, title: p.title, difficulty: p.difficulty, situation: p.situation, hintCount: p.hints.length, addedAt: p.addedAt, model: p.model || '' };
}

function validate(p, i) {
  try { return validatePuzzle(p); } catch (e) { throw new Error(`puzzles.json entry #${i}: ${e.message}`); }
}

/** Check a puzzle object's shape and return a normalised copy. Throws with a readable message. */
export function validatePuzzle(p) {
  if (!p || typeof p !== 'object') throw new Error('not an object');
  for (const k of ['title', 'situation', 'solution']) {
    if (typeof p[k] !== 'string' || !p[k].trim()) throw new Error(`missing "${k}"`);
  }
  const id = typeof p.id === 'string' && p.id.trim() ? slugify(p.id) : slugify(p.title);
  if (!id) throw new Error('cannot derive an id');
  if (!DIFFICULTIES.includes(p.difficulty)) throw new Error(`unknown difficulty "${p.difficulty}"`);
  const strings = (arr) => (Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
  const addedAt = typeof p.addedAt === 'string' && !Number.isNaN(Date.parse(p.addedAt)) ? p.addedAt : null;
  return {
    id, title: p.title.trim(), difficulty: p.difficulty, situation: p.situation.trim(), solution: p.solution.trim(),
    keyFacts: strings(p.keyFacts), hints: strings(p.hints), addedAt, model: modelFamily(p.model),
  };
}

/** Change fields of a puzzle in the bank file. Returns the updated puzzle, or null when the id is unknown. */
export function updatePuzzle(id, patch) {
  const raw = JSON.parse(fs.readFileSync(PUZZLES_FILE, 'utf8'));
  const i = raw.findIndex((p) => p.id === id);
  if (i < 0) return null;
  const next = { ...raw[i] };
  if (patch.difficulty !== undefined) {
    if (!DIFFICULTIES.includes(patch.difficulty)) throw new Error(`unknown difficulty "${patch.difficulty}"`);
    next.difficulty = patch.difficulty;
  }
  raw[i] = next;
  const tmp = PUZZLES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n');
  fs.renameSync(tmp, PUZZLES_FILE);
  loadPuzzles(); // refresh the cache from the new mtime
  return validatePuzzle(next);
}

/** Remove a puzzle from the bank file. Returns the removed puzzle, or null when the id is unknown. */
export function deletePuzzle(id) {
  const raw = JSON.parse(fs.readFileSync(PUZZLES_FILE, 'utf8'));
  const i = raw.findIndex((p) => p.id === id);
  if (i < 0) return null;
  const [removed] = raw.splice(i, 1);
  const tmp = PUZZLES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n');
  fs.renameSync(tmp, PUZZLES_FILE);
  loadPuzzles(); // refresh the cache from the new mtime
  return removed;
}

/** The model family that wrote a puzzle: fable, opus, sonnet, haiku, or the raw name when unknown. */
export function modelFamily(name) {
  const n = String(name ?? '').toLowerCase();
  const known = ['fable', 'opus', 'sonnet', 'haiku'].find((f) => n.includes(f));
  return known || n.replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || '';
}

export function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Append a puzzle to the bank file, making its id unique. Returns the stored puzzle. */
export function addPuzzle(puzzle) {
  const p = validatePuzzle(puzzle);
  p.addedAt = p.addedAt || new Date().toISOString();
  const list = loadPuzzles();
  const ids = new Set(list.map((x) => x.id));
  let id = p.id, n = 2;
  while (ids.has(id)) id = `${p.id}-${n++}`;
  p.id = id;
  const raw = JSON.parse(fs.readFileSync(PUZZLES_FILE, 'utf8'));
  raw.push(p);
  const tmp = PUZZLES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n');
  fs.renameSync(tmp, PUZZLES_FILE);
  loadPuzzles(); // refresh the cache from the new mtime
  return p;
}
