import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runClaude, CLAUDE_MODEL } from './claude.js';
import { loadPuzzles, addPuzzle, validatePuzzle } from './puzzles.js';
import { render, TEMPLATE_DIR } from './prompt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CANDIDATES_FILE = process.env.CANDIDATES_FILE || path.join(__dirname, '..', 'data', 'candidates.json');
/** Model used to write new puzzles; may differ from the game master's. */
export const GENERATOR_MODEL = process.env.GENERATOR_MODEL || CLAUDE_MODEL;
/** Built-in CLI tools the writer may use (web search for inspiration). Set GENERATOR_TOOLS="" to disable. */
export const GENERATOR_TOOLS = (process.env.GENERATOR_TOOLS ?? 'WebSearch,WebFetch').split(',').map((s) => s.trim()).filter(Boolean);
export const GENERATOR_TIMEOUT_MS = Number(process.env.GENERATOR_TIMEOUT_MS || 6 * 60_000);
export const DIFFICULTIES = ['mixed', 'easy', 'medium', 'hard'];
const MAX_COUNT = 10;

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

export function buildGeneratePrompt({ count, difficulty }) {
  const existing = [...loadPuzzles(), ...loadCandidates()];
  const system = fs.readFileSync(path.join(TEMPLATE_DIR, 'generate-system.md'), 'utf8').trim();
  const user = render(fs.readFileSync(path.join(TEMPLATE_DIR, 'generate.md'), 'utf8'), {
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

export function startGeneration({ count, difficulty, model = GENERATOR_MODEL }) {
  count = Math.max(1, Math.min(MAX_COUNT, Number(count) || 5));
  if (!DIFFICULTIES.includes(difficulty)) difficulty = 'mixed';
  if (running) throw Object.assign(new Error('A generation is already running'), { status: 409 });
  const job = {
    id: crypto.randomUUID(), status: 'running', count, difficulty, model, tools: GENERATOR_TOOLS,
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
          puzzle = validatePuzzle({ ...item, difficulty: difficulty === 'mixed' ? item.difficulty : difficulty });
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
