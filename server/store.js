import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROGRESS_FILE = process.env.PROGRESS_FILE || path.join(__dirname, '..', 'data', 'progress.json');

export const STATUS = { NEW: 'new', TRIED: 'tried', SOLVED: 'solved', REVEALED: 'revealed' };

let db = null;
let loadedMtime = 0;

function fileMtime() {
  try { return fs.statSync(PROGRESS_FILE).mtimeMs; } catch { return 0; }
}

/** Load the progress file, re-reading it when another process (a second server instance) changed it. */
function load() {
  const mtime = fileMtime();
  if (db && mtime === loadedMtime) return db;
  try {
    db = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    db = { users: {} };
  }
  if (!db.users) db.users = {};
  loadedMtime = mtime;
  return db;
}

function save() {
  fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
  const tmp = PROGRESS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, PROGRESS_FILE);
  loadedMtime = fileMtime();
}

function userRecord(userId) {
  const d = load();
  if (!d.users[userId]) d.users[userId] = { puzzles: {}, createdAt: new Date().toISOString() };
  return d.users[userId];
}

function emptyEntry() {
  return { status: STATUS.NEW, history: [], hintsGiven: 0, questionsAsked: 0, updatedAt: null, solvedAt: null };
}

/**
 * Questions that were actually answered (yes/no/irrelevant/cannot say). A message the game master
 * dismissed because it was not a yes/no question is not counted. Older entries without the counter
 * get it derived from their history.
 */
export function questionsAsked(entry) {
  if (typeof entry.questionsAsked === 'number') return entry.questionsAsked;
  let n = 0;
  for (let i = 1; i < entry.history.length; i++) {
    const prev = entry.history[i - 1], m = entry.history[i];
    if (prev.role === 'user' && prev.intent === 'question' && m.role === 'agent' && m.kind === 'answer') n++;
  }
  return n;
}

/** Progress entry for one user/puzzle pair (never null). */
export function getProgress(userId, puzzleId) {
  return userRecord(userId).puzzles[puzzleId] || emptyEntry();
}

/** All progress entries for a user, keyed by puzzle id. */
export function getAllProgress(userId) {
  return userRecord(userId).puzzles;
}

/** Apply a mutation to the entry and persist. */
export function updateProgress(userId, puzzleId, mutate) {
  const rec = userRecord(userId);
  const entry = rec.puzzles[puzzleId] || emptyEntry();
  mutate(entry);
  entry.updatedAt = new Date().toISOString();
  rec.puzzles[puzzleId] = entry;
  save();
  return entry;
}

/** Reset one puzzle (when puzzleId is given) or every puzzle for the user. */
export function resetProgress(userId, puzzleId) {
  const rec = userRecord(userId);
  if (puzzleId) delete rec.puzzles[puzzleId];
  else rec.puzzles = {};
  save();
}
