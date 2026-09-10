import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
  if (!d.users[userId]) {
    d.users[userId] = { name: `Player ${Object.keys(d.users).length + 1}`, puzzles: {}, createdAt: new Date().toISOString() };
    save();
  }
  return d.users[userId];
}

// ---------------------------------------------------------------------------
// Player profiles. Several people can share one server (and one device): each
// profile has its own progress, settings and name.
// ---------------------------------------------------------------------------
function displayName(id, rec) {
  return typeof rec?.name === 'string' && rec.name.trim() ? rec.name.trim() : `Player ${id.slice(0, 4)}`;
}

export function listProfiles() {
  const d = load();
  return Object.entries(d.users)
    .map(([id, rec]) => ({ id, name: displayName(id, rec), createdAt: rec.createdAt || null }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function profileExists(id) {
  return Boolean(id) && Object.prototype.hasOwnProperty.call(load().users, id);
}

export function getProfile(id) {
  const d = load();
  return d.users[id] ? { id, name: displayName(id, d.users[id]), createdAt: d.users[id].createdAt || null } : null;
}

const MAX_NAME = 40;

function cleanName(name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
  if (!n) throw new Error('A profile name is required');
  return n;
}

export function createProfile(name) {
  const d = load();
  const id = crypto.randomBytes(16).toString('hex');
  d.users[id] = { name: cleanName(name), puzzles: {}, createdAt: new Date().toISOString() };
  save();
  return { id, name: d.users[id].name, createdAt: d.users[id].createdAt };
}

/** Remove a profile and everything it holds. Refuses to remove the last one. */
export function deleteProfile(id) {
  const d = load();
  if (!d.users[id]) return null;
  if (Object.keys(d.users).length <= 1) throw new Error('This is the only profile, so it cannot be deleted');
  const removed = { id, name: displayName(id, d.users[id]), puzzles: Object.keys(d.users[id].puzzles || {}).length };
  delete d.users[id];
  save();
  return removed;
}

export function renameProfile(id, name) {
  const d = load();
  if (!d.users[id]) return null;
  d.users[id].name = cleanName(name);
  save();
  return { id, name: d.users[id].name, createdAt: d.users[id].createdAt || null };
}

function emptyEntry() {
  return { status: STATUS.NEW, history: [], hintsGiven: 0, questionsAsked: 0, guesses: 0, updatedAt: null, solvedAt: null };
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

/** Submitted solutions the game master judged (correct, close or incorrect). Derived from history for older entries. */
export function guessesMade(entry) {
  if (typeof entry.guesses === 'number') return entry.guesses;
  return entry.history.filter((m) => m.role === 'agent' && m.kind === 'verdict').length;
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

const ALL_STATUSES = Object.values(STATUS);

/** The player's whole record, shaped as a portable progress file. */
export function exportProgress(userId) {
  const rec = userRecord(userId);
  return {
    app: 'lateral-game', kind: 'progress', version: 1,
    exportedAt: new Date().toISOString(),
    profile: displayName(userId, rec),
    settings: rec.settings || {},
    ratings: rec.ratings || {},
    puzzles: rec.puzzles || {},
  };
}

function cleanMessage(m) {
  if (!m || typeof m !== 'object' || typeof m.text !== 'string') return null;
  return {
    role: m.role === 'agent' ? 'agent' : 'user',
    ...(m.intent ? { intent: String(m.intent) } : {}),
    ...(m.kind ? { kind: String(m.kind) } : {}),
    ...(m.answer ? { answer: String(m.answer) } : {}),
    ...(m.verdict ? { verdict: String(m.verdict) } : {}),
    text: m.text,
    at: typeof m.at === 'string' ? m.at : new Date().toISOString(),
  };
}

/** Replace the player's progress with the contents of a progress file. Throws on anything unusable. */
export function importProgress(userId, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('That file does not look like a progress export');
  if (data.app && data.app !== 'lateral-game') throw new Error('That file was exported by another application');
  const puzzles = data.puzzles;
  if (!puzzles || typeof puzzles !== 'object' || Array.isArray(puzzles)) throw new Error('No progress found in the file');
  const clean = {};
  for (const [id, e] of Object.entries(puzzles)) {
    if (!e || typeof e !== 'object') continue;
    const history = Array.isArray(e.history) ? e.history.map(cleanMessage).filter(Boolean) : [];
    clean[id] = {
      status: ALL_STATUSES.includes(e.status) ? e.status : STATUS.TRIED,
      history,
      hintsGiven: Math.max(0, Number(e.hintsGiven) || 0),
      questionsAsked: Math.max(0, Number(e.questionsAsked) || 0),
      guesses: Math.max(0, Number(e.guesses) || 0),
      updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : null,
      solvedAt: typeof e.solvedAt === 'string' ? e.solvedAt : null,
    };
  }
  if (!Object.keys(clean).length) throw new Error('The file contains no puzzle progress');
  const rec = userRecord(userId);
  rec.puzzles = clean;
  if (data.settings && typeof data.settings === 'object' && 'gmHelp' in data.settings) {
    rec.settings = { ...(rec.settings || {}), gmHelp: !!data.settings.gmHelp };
  }
  if (data.ratings && typeof data.ratings === 'object' && !Array.isArray(data.ratings)) {
    rec.ratings = Object.fromEntries(Object.entries(data.ratings).filter(([, v]) => RATINGS.includes(v)));
  }
  save();
  return { puzzles: Object.keys(clean).length, messages: Object.values(clean).reduce((n, e) => n + e.history.length, 0) };
}

// ---------------------------------------------------------------------------
// Puzzle ratings: a thumb up or down per player and puzzle. Kept outside the
// progress entries so resetting a puzzle does not throw the opinion away.
// ---------------------------------------------------------------------------
export const RATINGS = ['up', 'down'];

export function getRatings(userId) {
  return { ...(userRecord(userId).ratings || {}) };
}

export function setRating(userId, puzzleId, rating) {
  const rec = userRecord(userId);
  rec.ratings = rec.ratings || {};
  if (RATINGS.includes(rating)) rec.ratings[puzzleId] = rating;
  else delete rec.ratings[puzzleId];
  save();
  return rec.ratings[puzzleId] || null;
}

/** Per-player settings (not touched by a progress reset). */
export function getSettings(userId) {
  return { ...(userRecord(userId).settings || {}) };
}

export function updateSettings(userId, patch) {
  const rec = userRecord(userId);
  rec.settings = { ...(rec.settings || {}), ...patch };
  save();
  return { ...rec.settings };
}

/** Reset one puzzle (when puzzleId is given) or every puzzle for the user. */
export function resetProgress(userId, puzzleId) {
  const rec = userRecord(userId);
  if (puzzleId) delete rec.puzzles[puzzleId];
  else rec.puzzles = {};
  save();
}
