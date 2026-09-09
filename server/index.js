import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPuzzles, getPuzzle, publicPuzzle } from './puzzles.js';
import { STATUS, getProgress, getAllProgress, updateProgress, resetProgress, questionsAsked } from './store.js';
import { buildPrompt, INTENTS } from './prompt.js';
import { runClaude, parseReply, CLAUDE_MODEL } from './claude.js';
import { GENERATOR_MODEL, GENERATOR_TOOLS, DIFFICULTIES as GEN_DIFFICULTIES, startGeneration, getJob, listJobs, runningJob, listCandidates, approveCandidate, rejectCandidate } from './generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const DEBUG = process.env.LG_DEBUG === '1';
const USER_COOKIE = 'lg_uid';

const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Anonymous per-browser identity. Progress is keyed by this cookie.
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  let uid = req.cookies[USER_COOKIE];
  if (!uid || !/^[a-f0-9]{32}$/.test(uid)) {
    uid = crypto.randomBytes(16).toString('hex');
    res.cookie(USER_COOKIE, uid, { maxAge: 10 * 365 * 24 * 3600 * 1000, sameSite: 'lax', httpOnly: true });
  }
  req.userId = uid;
  next();
});

function summary(entry) {
  return { status: entry.status, hintsGiven: entry.hintsGiven, questionsAsked: questionsAsked(entry), updatedAt: entry.updatedAt, solvedAt: entry.solvedAt, messageCount: entry.history.length };
}

function withStatus(p, all) {
  const e = all[p.id];
  return { ...publicPuzzle(p), status: e ? e.status : STATUS.NEW, hintsGiven: e ? e.hintsGiven : 0, questionsAsked: e ? questionsAsked(e) : 0, updatedAt: e ? e.updatedAt : null };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
/** Liveness check used by the launcher (and anything else) to recognise this server. */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'lateral-game', pid: process.pid, port: PORT, model: CLAUDE_MODEL, generatorModel: GENERATOR_MODEL, puzzles: loadPuzzles().length, candidates: listCandidates().length, uptime: Math.round(process.uptime()) });
});

app.get('/api/me', (req, res) => {
  const all = getAllProgress(req.userId);
  const puzzles = loadPuzzles();
  const counts = { total: puzzles.length, solved: 0, tried: 0, revealed: 0 };
  for (const p of puzzles) {
    const s = all[p.id]?.status;
    if (s === STATUS.SOLVED) counts.solved++;
    else if (s === STATUS.TRIED) counts.tried++;
    else if (s === STATUS.REVEALED) counts.revealed++;
  }
  res.json({ userId: req.userId.slice(0, 8), model: CLAUDE_MODEL, counts });
});

app.get('/api/puzzles', (req, res) => {
  const all = getAllProgress(req.userId);
  res.json(loadPuzzles().map((p) => withStatus(p, all)));
});

/** Random puzzle, preferring ones not yet solved or revealed; `exclude` avoids repeating the current one. */
app.get('/api/puzzles/random', (req, res) => {
  const all = getAllProgress(req.userId);
  const exclude = String(req.query.exclude || '');
  const difficulty = String(req.query.difficulty || '');
  let pool = loadPuzzles().filter((p) => p.id !== exclude);
  if (difficulty) pool = pool.filter((p) => p.difficulty === difficulty);
  const fresh = pool.filter((p) => ![STATUS.SOLVED, STATUS.REVEALED].includes(all[p.id]?.status));
  const pick = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length ? fresh : pool).length)];
  if (!pick) return res.status(404).json({ error: 'No puzzles available' });
  res.json({ ...withStatus(pick, all), allDone: fresh.length === 0 });
});

app.get('/api/puzzles/:id', (req, res) => {
  const p = getPuzzle(req.params.id);
  if (!p) return res.status(404).json({ error: 'Unknown puzzle' });
  const e = getProgress(req.userId, p.id);
  res.json({ puzzle: publicPuzzle(p), progress: { ...summary(e), history: e.history } });
});

if (DEBUG) {
  // Inspect the rendered prompt for template tuning: /api/puzzles/<id>/prompt?intent=question&text=...
  app.get('/api/puzzles/:id/prompt', (req, res) => {
    const p = getPuzzle(req.params.id);
    if (!p) return res.status(404).json({ error: 'Unknown puzzle' });
    const e = getProgress(req.userId, p.id);
    const { system, user } = buildPrompt({ puzzle: p, progress: e, intent: String(req.query.intent || 'question'), text: String(req.query.text || '') });
    res.type('text/plain').send(`### SYSTEM\n${system}\n\n### USER\n${user}`);
  });
}

const inflight = new Set();

app.post('/api/puzzles/:id/chat', async (req, res) => {
  const p = getPuzzle(req.params.id);
  if (!p) return res.status(404).json({ error: 'Unknown puzzle' });
  const intent = String(req.body?.intent || '');
  const text = String(req.body?.text || '').trim().slice(0, 1000);
  if (!INTENTS.includes(intent)) return res.status(400).json({ error: `intent must be one of ${INTENTS.join(', ')}` });
  if ((intent === 'question' || intent === 'guess') && !text) return res.status(400).json({ error: 'Message text is required' });

  const key = `${req.userId}:${p.id}`;
  if (inflight.has(key)) return res.status(409).json({ error: 'Still answering your previous message' });
  inflight.add(key);
  try {
    // Opening a puzzle and talking to the game master marks it as "tried" until it is solved.
    let progress = updateProgress(req.userId, p.id, (e) => { if (e.status === STATUS.NEW) e.status = STATUS.TRIED; });

    const { system, user } = buildPrompt({ puzzle: p, progress, intent, text });
    let reply;
    try {
      const t0 = Date.now();
      const raw = await runClaude({ system, user });
      reply = parseReply(raw.text);
      console.log(`[chat] ${p.id} ${intent} -> ${reply.kind}${reply.answer ? '/' + reply.answer : ''}${reply.verdict ? '/' + reply.verdict : ''} in ${Date.now() - t0} ms, $${(raw.cost ?? 0).toFixed(4)}`);
    } catch (err) {
      console.error(`[chat] claude failed for ${p.id}/${intent}:`, err.message);
      if (intent !== 'reveal') return res.status(502).json({ error: 'The game master is unavailable right now. Please try again.', detail: err.message });
      // Revealing does not strictly need the model: fall back to the stored solution.
      reply = { kind: 'solution', answer: null, verdict: null, message: p.solution };
    }
    if (intent === 'reveal' && reply.kind !== 'solution') reply = { kind: 'solution', answer: null, verdict: null, message: p.solution };

    const now = new Date().toISOString();
    progress = updateProgress(req.userId, p.id, (e) => {
      e.history.push({ role: 'user', intent, text: text || (intent === 'hint' ? 'Can I have a hint?' : 'I give up. What is the solution?'), at: now });
      e.history.push({ role: 'agent', kind: reply.kind, answer: reply.answer, verdict: reply.verdict, text: reply.message, at: now });
      if (reply.kind === 'hint') e.hintsGiven += 1;
      // score: only questions the game master actually answered count, not ones dismissed for not being yes/no
      if (intent === 'question' && reply.kind === 'answer') e.questionsAsked = questionsAsked(e) + 1;
      if (reply.kind === 'verdict' && reply.verdict === 'correct' && e.status !== STATUS.SOLVED) { e.status = STATUS.SOLVED; e.solvedAt = now; }
      if (reply.kind === 'solution' && e.status !== STATUS.SOLVED) e.status = STATUS.REVEALED;
    });
    res.json({ reply, progress: summary(progress) });
  } finally {
    inflight.delete(key);
  }
});

// ---------------------------------------------------------------------------
// Puzzle generation and review
// ---------------------------------------------------------------------------
app.get('/api/generate/config', (req, res) => {
  res.json({ model: GENERATOR_MODEL, gameMasterModel: CLAUDE_MODEL, tools: GENERATOR_TOOLS, difficulties: GEN_DIFFICULTIES, maxCount: 10, running: runningJob(), jobs: listJobs() });
});

app.post('/api/generate', (req, res) => {
  try {
    const job = startGeneration({ count: req.body?.count, difficulty: String(req.body?.difficulty || 'mixed') });
    res.status(202).json({ job });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/generate/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown job' });
  res.json({ job });
});

app.get('/api/candidates', (req, res) => res.json(listCandidates()));

app.post('/api/candidates/:id/approve', (req, res) => {
  try {
    const puzzle = approveCandidate(req.params.id);
    if (!puzzle) return res.status(404).json({ error: 'Unknown candidate' });
    console.log(`[generate] approved "${puzzle.title}" as ${puzzle.id}`);
    res.json({ puzzle: publicPuzzle(puzzle) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/candidates/:id/reject', (req, res) => {
  if (!rejectCandidate(req.params.id)) return res.status(404).json({ error: 'Unknown candidate' });
  res.json({ ok: true });
});

app.post('/api/progress/reset', (req, res) => {
  const puzzleId = req.body?.puzzleId ? String(req.body.puzzleId) : null;
  if (puzzleId && !getPuzzle(puzzleId)) return res.status(404).json({ error: 'Unknown puzzle' });
  resetProgress(req.userId, puzzleId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Static front end
// ---------------------------------------------------------------------------
app.get('/bank', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'bank.html')));
app.get('/generate', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'generate.html')));
app.use(express.static(PUBLIC_DIR));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

loadPuzzles(); // fail fast on a broken bank
app.listen(PORT, () => {
  console.log(`Lateral game on http://localhost:${PORT}  (game master: ${CLAUDE_MODEL}, puzzle writer: ${GENERATOR_MODEL}, ${loadPuzzles().length} puzzles${DEBUG ? ', debug on' : ''})`);
});
