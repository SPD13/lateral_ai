import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runClaude, CLAUDE_MODEL } from './claude.js';
import { loadPuzzles, addPuzzle, validatePuzzle, modelFamily, httpUrl } from './puzzles.js';
import { render, TEMPLATE_DIR, LANGUAGE } from './prompt.js';
import { listSources, addSource, knowsSource, sourceKey } from './sources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CANDIDATES_FILE = process.env.CANDIDATES_FILE || path.join(__dirname, '..', 'data', 'candidates.json');
/** Model used to write new puzzles; may differ from the game master's. */
export const GENERATOR_MODEL = process.env.GENERATOR_MODEL || CLAUDE_MODEL;
/** Built-in CLI tools the writer may use (web search for inspiration). Set GENERATOR_TOOLS="" to disable. */
export const GENERATOR_TOOLS = (process.env.GENERATOR_TOOLS ?? 'WebSearch,WebFetch').split(',').map((s) => s.trim()).filter(Boolean);
export const GENERATOR_TIMEOUT_MS = Number(process.env.GENERATOR_TIMEOUT_MS || 6 * 60_000);
/** Collecting means searching, fetching and reading a page, so it gets longer. */
export const COLLECT_TIMEOUT_MS = Number(process.env.COLLECT_TIMEOUT_MS || 10 * 60_000);
export const COLLECT_COUNT = Number(process.env.COLLECT_COUNT || 10);
/** Collecting is cheap per puzzle once the page is fetched, so it may take more in one go than the writer. */
export const COLLECT_MAX = Number(process.env.COLLECT_MAX || 20);
export const WEB_SOURCE_MODEL = 'web-search';
export const DIFFICULTIES = ['mixed', 'easy', 'medium', 'hard'];
const MAX_COUNT = 6;

// ---------------------------------------------------------------------------
// Candidates: generated puzzles awaiting review, persisted so a reload keeps them
// ---------------------------------------------------------------------------
let candidates = null;

function loadCandidates() {
  if (candidates) return candidates;
  try { candidates = JSON.parse(fs.readFileSync(CANDIDATES_FILE, 'utf8')); } catch { candidates = []; }
  if (!Array.isArray(candidates)) candidates = [];
  return candidates;
}

function saveCandidates() {
  fs.mkdirSync(path.dirname(CANDIDATES_FILE), { recursive: true });
  const tmp = CANDIDATES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(candidates, null, 2));
  fs.renameSync(tmp, CANDIDATES_FILE);
}

export function listCandidates() {
  return loadCandidates();
}

/** Approve: move the candidate into the puzzle bank. Returns the stored puzzle. */
export function approveCandidate(candidateId) {
  const list = loadCandidates();
  const i = list.findIndex((c) => c.candidateId === candidateId);
  if (i < 0) return null;
  const { candidateId: _id, createdAt, jobId, inspiration, ...puzzle } = list[i];
  const stored = addPuzzle(puzzle);
  list.splice(i, 1);
  saveCandidates();
  return stored;
}

/** Approve every candidate, keeping going if one of them is rejected by the bank. */
export function approveAllCandidates() {
  const added = [];
  const failed = [];
  for (const candidate of [...loadCandidates()]) {
    try {
      const puzzle = approveCandidate(candidate.candidateId);
      if (puzzle) added.push(puzzle.id);
    } catch (e) {
      failed.push({ title: candidate.title, reason: e.message });
    }
  }
  return { added, failed };
}

/** Drop every candidate. Returns how many were dropped. */
export function rejectAllCandidates() {
  const list = loadCandidates();
  const count = list.length;
  list.length = 0;
  saveCandidates();
  return count;
}

export function rejectCandidate(candidateId) {
  const list = loadCandidates();
  const i = list.findIndex((c) => c.candidateId === candidateId);
  if (i < 0) return false;
  list.splice(i, 1);
  saveCandidates();
  return true;
}

// ---------------------------------------------------------------------------
// Duplicate detection: the prompt lists existing puzzles, and the server checks again.
// ---------------------------------------------------------------------------
const STOP = new Set('a an the and or of to in on at is are was were be been he she it they his her its their this that with for from by as not no man woman two one found dead why how what happened who'.split(' '));

function stem(w) {
  return w.replace(/(ies)$/, 'y').replace(/(sses|shes|ches|xes)$/, (m) => m.slice(0, -2)).replace(/(ing|ed|es|s)$/, '');
}

function tokens(text) {
  return new Set(String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem));
}

/** Overlap coefficient: shared tokens over the smaller set, so a short paraphrase of a long story still scores high. */
function overlap(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const min = Math.min(a.size, b.size);
  return min ? inter / min : 0;
}

/** Reason the candidate duplicates something in `pool` (bank + pending candidates), or null. */
export function duplicateReason(candidate, pool) {
  const title = candidate.title.trim().toLowerCase();
  const sit = tokens(candidate.situation);
  const sol = tokens(candidate.solution);
  for (const p of pool) {
    if (p.id === candidate.id) return `same id as "${p.title}"`;
    if (p.title.trim().toLowerCase() === title) return `same title as "${p.title}"`;
    const s1 = overlap(sit, tokens(p.situation));
    const s2 = overlap(sol, tokens(p.solution));
    if (s1 >= 0.6 || s2 >= 0.6 || (s1 >= 0.4 && s2 >= 0.4)) return `too close to "${p.title}"`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
function formatExisting(list) {
  if (!list.length) return '(none yet)';
  return list.map((p) => `- ${p.title} (${p.difficulty}): ${p.situation.replace(/\s+/g, ' ')}\n  Solution: ${p.solution.replace(/\s+/g, ' ')}`).join('\n');
}

function formatSources(list) {
  if (!list.length) return '(none yet — any page is new)';
  return list.map((s) => `- ${s.url}${s.title ? ` — ${s.title}` : ''} (${s.kept} puzzle${s.kept === 1 ? '' : 's'} taken)`).join('\n');
}

/** Titles and situations only: the collector needs to recognise a duplicate, not to copy solutions. */
function formatExistingBrief(list) {
  if (!list.length) return '(none yet)';
  return list.map((p) => `- ${p.title}: ${p.situation.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');
}

/** Titles already taken from a page, so a second visit can skip them. */
export function takenFrom(url) {
  const key = sourceKey(url);
  return [...loadPuzzles(), ...loadCandidates()]
    .filter((p) => p.sourceUrl && sourceKey(p.sourceUrl) === key)
    .map((p) => p.title);
}

export function buildCollectMorePrompt({ count, sourceUrl }) {
  const existing = [...loadPuzzles(), ...loadCandidates()];
  const taken = takenFrom(sourceUrl);
  const system = render(fs.readFileSync(path.join(TEMPLATE_DIR, 'collect-system.md'), 'utf8'), { LANGUAGE }).trim();
  const user = render(fs.readFileSync(path.join(TEMPLATE_DIR, 'collect-more.md'), 'utf8'), {
    LANGUAGE,
    COUNT: count,
    SOURCE_URL: sourceUrl,
    TAKEN_TITLES: taken.length ? taken.map((t) => `- ${t}`).join('\n') : '(nothing yet)',
    EXISTING_PUZZLES: formatExistingBrief(existing),
  });
  return { system, user };
}

export function buildCollectPrompt({ count }) {
  const existing = [...loadPuzzles(), ...loadCandidates()];
  const system = render(fs.readFileSync(path.join(TEMPLATE_DIR, 'collect-system.md'), 'utf8'), { LANGUAGE }).trim();
  const user = render(fs.readFileSync(path.join(TEMPLATE_DIR, 'collect.md'), 'utf8'), {
    LANGUAGE,
    COUNT: count,
    EXISTING_SOURCES: formatSources(listSources()),
    EXISTING_PUZZLES: formatExistingBrief(existing),
  });
  return { system, user };
}

/** Pull the JSON object out of a collector reply. */
export function parseCollection(text) {
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in the reply');
  const obj = JSON.parse(s.slice(start, end + 1));
  if (!obj || typeof obj !== 'object') throw new Error('reply is not a JSON object');
  return { source: obj.source || {}, puzzles: Array.isArray(obj.puzzles) ? obj.puzzles : [] };
}

export function buildGeneratePrompt({ count, difficulty }) {
  const existing = [...loadPuzzles(), ...loadCandidates()];
  const system = render(fs.readFileSync(path.join(TEMPLATE_DIR, 'generate-system.md'), 'utf8'), { LANGUAGE }).trim();
  const user = render(fs.readFileSync(path.join(TEMPLATE_DIR, 'generate.md'), 'utf8'), {
    LANGUAGE,
    COUNT: count,
    DIFFICULTY: difficulty,
    EXISTING_COUNT: existing.length,
    EXISTING_PUZZLES: formatExisting(existing),
  });
  return { system, user };
}

/** Pull the JSON array out of the model reply, tolerating fences and surrounding prose. */
export function parsePuzzleArray(text) {
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('no JSON array in the reply');
  const arr = JSON.parse(s.slice(start, end + 1));
  if (!Array.isArray(arr)) throw new Error('reply is not a JSON array');
  return arr;
}

// ---------------------------------------------------------------------------
// Generation jobs (one at a time; the client polls)
// ---------------------------------------------------------------------------
const jobs = new Map();
let running = null;

export function getJob(id) { return jobs.get(id) || null; }
export function listJobs() { return [...jobs.values()].slice(-10).reverse(); }
export function runningJob() { return running; }

/** One collection run: search for a page nobody has used yet, read it, and take its puzzles. */
export function startCollection({ count = COLLECT_COUNT, model = GENERATOR_MODEL, sourceUrl = null } = {}) {
  count = Math.max(1, Math.min(COLLECT_MAX, Number(count) || COLLECT_COUNT));
  const revisit = httpUrl(sourceUrl);
  if (sourceUrl && !revisit) throw Object.assign(new Error('That is not a usable source URL'), { status: 400 });
  if (revisit && !knowsSource(revisit)) throw Object.assign(new Error('That source has not been used yet'), { status: 404 });
  if (running) throw Object.assign(new Error('A generation is already running'), { status: 409 });
  const job = {
    id: crypto.randomUUID(), kind: 'collect', mode: revisit ? 'more' : 'search', status: 'running', count, model, tools: GENERATOR_TOOLS,
    startedAt: new Date().toISOString(), finishedAt: null, added: [], dropped: [], error: null,
    cost: null, tokens: null, webSearches: 0, source: revisit ? { url: revisit, title: '' } : null,
  };
  jobs.set(job.id, job);
  running = job;
  (async () => {
    try {
      if (!GENERATOR_TOOLS.length) throw new Error('Web search is disabled (GENERATOR_TOOLS is empty)');
      const { system, user } = revisit ? buildCollectMorePrompt({ count, sourceUrl: revisit }) : buildCollectPrompt({ count });
      const raw = await runClaude({ system, user, model, tools: GENERATOR_TOOLS, timeoutMs: COLLECT_TIMEOUT_MS });
      job.cost = raw.cost ?? null;
      job.tokens = raw.tokens ?? null;
      job.webSearches = raw.webSearches ?? 0;
      const { source, puzzles } = parseCollection(raw.text);
      const url = revisit || httpUrl(source.url);
      if (!url) throw new Error('the reply did not name a usable source page');
      if (revisit && httpUrl(source.url) && sourceKey(source.url) !== sourceKey(revisit)) {
        throw new Error('the reply came from a different page than the one asked for');
      }
      job.source = { url, title: String(source.title || job.source?.title || '').slice(0, 120) };
      if (!revisit && knowsSource(url)) job.dropped.push({ title: job.source.title || url, reason: 'this source has been used before' });

      const list = loadCandidates();
      let kept = 0;
      for (const item of puzzles) {
        let puzzle;
        try {
          puzzle = validatePuzzle({ ...item, model: WEB_SOURCE_MODEL, sourceUrl: url });
        } catch (e) {
          job.dropped.push({ title: item?.title || '(untitled)', reason: e.message });
          continue;
        }
        const reason = duplicateReason(puzzle, [...loadPuzzles(), ...list]);
        if (reason) { job.dropped.push({ title: puzzle.title, reason }); continue; }
        list.push({ ...puzzle, inspiration: '', candidateId: crypto.randomUUID(), createdAt: new Date().toISOString(), jobId: job.id });
        job.added.push(list[list.length - 1].candidateId);
        kept++;
      }
      saveCandidates();
      addSource({ url, title: job.source.title, puzzles: puzzles.length, kept });
      job.status = 'done';
    } catch (e) {
      job.status = 'error';
      job.error = e.message;
    } finally {
      job.finishedAt = new Date().toISOString();
      running = null;
      console.log(`[collect] ${job.status}: ${job.added.length} kept, ${job.dropped.length} dropped, source ${job.source?.url || '(none)'}${job.error ? `, error: ${job.error}` : ''}`);
    }
  })();
  return job;
}

export function startGeneration({ count, difficulty, model = GENERATOR_MODEL }) {
  count = Math.max(1, Math.min(MAX_COUNT, Number(count) || 5));
  if (!DIFFICULTIES.includes(difficulty)) difficulty = 'mixed';
  if (running) throw Object.assign(new Error('A generation is already running'), { status: 409 });
  const job = {
    id: crypto.randomUUID(), kind: 'generate', status: 'running', count, difficulty, model, tools: GENERATOR_TOOLS,
    startedAt: new Date().toISOString(), finishedAt: null, added: [], dropped: [], error: null, cost: null, tokens: null, webSearches: 0,
  };
  jobs.set(job.id, job);
  running = job;
  (async () => {
    try {
      const { system, user } = buildGeneratePrompt({ count, difficulty });
      const raw = await runClaude({ system, user, model, tools: GENERATOR_TOOLS, timeoutMs: GENERATOR_TIMEOUT_MS });
      job.cost = raw.cost ?? null;
      job.tokens = raw.tokens ?? null;
      job.webSearches = raw.webSearches ?? 0;
      const arr = parsePuzzleArray(raw.text);
      const list = loadCandidates();
      for (const item of arr) {
        let puzzle;
        try {
          puzzle = validatePuzzle({ ...item, difficulty: difficulty === 'mixed' ? item.difficulty : difficulty, model: modelFamily(model) });
        } catch (e) {
          job.dropped.push({ title: item?.title || '(untitled)', reason: e.message });
          continue;
        }
        const reason = duplicateReason(puzzle, [...loadPuzzles(), ...list]);
        if (reason) { job.dropped.push({ title: puzzle.title, reason }); continue; }
        const candidate = { ...puzzle, inspiration: typeof item.inspiration === 'string' ? item.inspiration : '', candidateId: crypto.randomUUID(), createdAt: new Date().toISOString(), jobId: job.id };
        list.push(candidate);
        job.added.push(candidate.candidateId);
      }
      saveCandidates();
      job.status = 'done';
    } catch (e) {
      job.status = 'error';
      job.error = e.message;
    } finally {
      job.finishedAt = new Date().toISOString();
      running = null;
      console.log(`[generate] ${job.status}: ${job.added.length} added, ${job.dropped.length} dropped, model ${model}${job.tokens ? `, ${job.tokens.total} tokens (${job.tokens.input} in / ${job.tokens.output} out)` : ''}${job.cost != null ? `, $${job.cost.toFixed(4)}` : ''}${job.error ? `, error: ${job.error}` : ''}`);
    }
  })();
  return job;
}
