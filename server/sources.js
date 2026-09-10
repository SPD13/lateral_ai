import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SOURCES_FILE = process.env.SOURCES_FILE || path.join(__dirname, '..', 'data', 'sources.json');

/**
 * Web pages the collector has already visited. Kept so a later search knows not to go back to the
 * same place, whether or not anything usable came out of it.
 */
let cache = null;

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')); } catch { cache = []; }
  if (!Array.isArray(cache)) cache = [];
  return cache;
}

function save() {
  fs.mkdirSync(path.dirname(SOURCES_FILE), { recursive: true });
  const tmp = SOURCES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n');
  fs.renameSync(tmp, SOURCES_FILE);
}

export function listSources() {
  return load().map((s) => ({ ...s }));
}

/** Normalised form used to tell two links to the same page apart from two different pages. */
export function sourceKey(url) {
  try {
    const u = new URL(String(url));
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return String(url).trim().toLowerCase();
  }
}

export function knowsSource(url) {
  const key = sourceKey(url);
  return load().some((s) => sourceKey(s.url) === key);
}

/** Record a visit, whether it yielded puzzles or not. Returns the stored entry. */
export function addSource({ url, title, puzzles = 0, kept = 0 }) {
  const list = load();
  const key = sourceKey(url);
  const existing = list.find((s) => sourceKey(s.url) === key);
  if (existing) {
    existing.visits = (existing.visits || 1) + 1;
    existing.lastVisitedAt = new Date().toISOString();
    existing.kept += kept;
    save();
    return existing;
  }
  const entry = { url: String(url), title: String(title || '').slice(0, 120), found: puzzles, kept, visits: 1, firstVisitedAt: new Date().toISOString(), lastVisitedAt: new Date().toISOString() };
  list.push(entry);
  save();
  return entry;
}
