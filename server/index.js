import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPuzzles, getPuzzle, publicPuzzle, deletePuzzle, updatePuzzle } from './puzzles.js';
import { STATUS, getProgress, getAllProgress, updateProgress, resetProgress, questionsAsked, guessesMade, getSettings, updateSettings, exportProgress, importProgress, listProfiles, profileExists, getProfile, createProfile, renameProfile, deleteProfile } from './store.js';
import { buildPrompt, INTENTS, GM_HELP_DEFAULT } from './prompt.js';
import { getScoring, saveScoring, DEFAULT_SCORING } from './scoring.js';
import { runClaude, parseReply, CLAUDE_MODEL } from './claude.js';
import { GENERATOR_MODEL, GENERATOR_TOOLS, DIFFICULTIES as GEN_DIFFICULTIES, startGeneration, getJob, listJobs, runningJob, listCandidates, approveCandidate, rejectCandidate } from './generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const DEBUG = process.env.LG_DEBUG === '1';
const USER_COOKIE = 'lg_uid';

const app = express();
app.use(express.json({ limit: '8mb' })); // large enough for a progress import
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Identity. The cookie is this device's own profile; the browser can point at
// another profile with the X-Profile-Id header (or ?profile= for plain links).
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  let uid = req.cookies[USER_COOKIE];
  if (!uid || !/^[a-f0-9]{32}$/.test(uid)) {
    uid = crypto.randomBytes(16).toString('hex');
    res.cookie(USER_COOKIE, uid, { maxAge: 10 * 365 * 24 * 3600 * 1000, sameSite: 'lax', httpOnly: true });
  }
  req.deviceId = uid;
  const asked = String(req.get('X-Profile-Id') || req.query.profile || '');
  req.userId = asked && profileExists(asked) ? asked : uid;
  next();
});

/** A solved puzzle's contribution: its difficulty value minus the penalties, never below zero. */
function puzzleScore(entry, puzzle, scoring = getScoring()) {
  const base = scoring.difficulty[puzzle.difficulty] ?? 0;
  const penalty = scoring.costs.hint * (entry.hintsGiven || 0)
    + scoring.costs.question * questionsAsked(entry)
    + scoring.costs.try * guessesMade(entry);
  return Math.max(0, base - penalty);
}

function summary(entry) {
  return { status: entry.status, hintsGiven: entry.hintsGiven, questionsAsked: questionsAsked(entry), guesses: guessesMade(entry), updatedAt: entry.updatedAt, solvedAt: entry.solvedAt, messageCount: entry.history.length };
}

function withStatus(p, all) {
  const e = all[p.id];
  const solved = e && e.status === STATUS.SOLVED;
  return {
    ...publicPuzzle(p),
    status: e ? e.status : STATUS.NEW,
    hintsGiven: e ? e.hintsGiven : 0,
    questionsAsked: e ? questionsAsked(e) : 0,
    guesses: e ? guessesMade(e) : 0,
    messageCount: e ? e.history.length : 0,
    updatedAt: e ? e.updatedAt : null,
    // leaderboard points this puzzle contributes, with the parts so the page can explain them
    points: solved ? Math.round(puzzleScore(e, p) * 100) / 100 : null,
    scoreParts: solved ? { base: getScoring().difficulty[p.difficulty] ?? 0, costs: getScoring().costs } : null,
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
/** Liveness check used by the launcher (and anything else) to recognise this server. */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'lateral-game', pid: process.pid, port: PORT, model: CLAUDE_MODEL, generatorModel: GENERATOR_MODEL, puzzles: loadPuzzles().length, candidates: listCandidates().length, uptime: Math.round(process.uptime()) });
});

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
app.get('/api/profiles', (req, res) => {
  getAllProgress(req.deviceId); // make sure this device has a profile to show
  res.json({ profiles: listProfiles(), activeId: req.userId });
});

app.post('/api/profiles', (req, res) => {
  try {
    const profile = createProfile(req.body?.name);
    console.log(`[profiles] created "${profile.name}"`);
    res.status(201).json({ profile });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch('/api/profiles/:id', (req, res) => {
  try {
    const profile = renameProfile(req.params.id, req.body?.name);
    if (!profile) return res.status(404).json({ error: 'Unknown profile' });
    res.json({ profile });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/profiles/:id', (req, res) => {
  const id = req.params.id;
  if (!profileExists(id)) return res.status(404).json({ error: 'Unknown profile' });
  let removed;
  try {
    removed = deleteProfile(id);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  // if this browser's own cookie pointed at it, adopt another profile rather than making a fresh empty one
  if (req.deviceId === id) {
    const next = listProfiles()[0];
    if (next) res.cookie(USER_COOKIE, next.id, { maxAge: 10 * 365 * 24 * 3600 * 1000, sameSite: 'lax', httpOnly: true });
  }
  console.log(`[profiles] deleted "${removed.name}" (${removed.puzzles} puzzles)`);
  res.json({ ok: true, removed, remaining: listProfiles().length });
});

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------
app.get('/api/leaderboard', (req, res) => {
  const scoring = getScoring();
  const puzzles = new Map(loadPuzzles().map((p) => [p.id, p]));
  const rows = listProfiles().map((profile) => {
    const progress = getAllProgress(profile.id);
    const counts = { easy: 0, medium: 0, hard: 0 };
    let points = 0;
    for (const [puzzleId, entry] of Object.entries(progress)) {
      if (entry.status !== STATUS.SOLVED) continue;
      const puzzle = puzzles.get(puzzleId);
      if (!puzzle) continue; // the puzzle was deleted from the bank
      counts[puzzle.difficulty] = (counts[puzzle.difficulty] || 0) + 1;
      points += puzzleScore(entry, puzzle, scoring);
    }
    const solved = counts.easy + counts.medium + counts.hard;
    return { ...profile, points: Math.round(points * 100) / 100, solved, ...counts };
  }).sort((a, b) => b.points - a.points || b.solved - a.solved || a.name.localeCompare(b.name));
  res.json({ rows, activeId: req.userId, scoring });
});

/** The scoring weights, shared by every profile. */
app.get('/api/scoring', (req, res) => res.json({ scoring: getScoring(), defaults: DEFAULT_SCORING }));

app.put('/api/scoring', (req, res) => {
  try {
    const scoring = saveScoring(req.body?.scoring ?? req.body);
    console.log(`[scoring] updated: ${JSON.stringify(scoring)}`);
    res.json({ scoring });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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
  res.json({ userId: req.userId.slice(0, 8), profile: getProfile(req.userId), model: CLAUDE_MODEL, counts, settings: effectiveSettings(req.userId) });
});

function effectiveSettings(userId) {
  const s = getSettings(userId);
  return { gmHelp: typeof s.gmHelp === 'boolean' ? s.gmHelp : GM_HELP_DEFAULT };
}

app.get('/api/settings', (req, res) => res.json(effectiveSettings(req.userId)));

/** Player settings: `gmHelp` (Game master help) lets the game master add short clarifications and pointers. */
app.put('/api/settings', (req, res) => {
  const patch = {};
  if (req.body?.gmHelp !== undefined) patch.gmHelp = !!req.body.gmHelp;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  updateSettings(req.userId, patch);
  res.json(effectiveSettings(req.userId));
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
    const { system, user } = buildPrompt({ puzzle: p, progress: e, intent: String(req.query.intent || 'question'), text: String(req.query.text || ''), settings: effectiveSettings(req.userId) });
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

    const { system, user } = buildPrompt({ puzzle: p, progress, intent, text, settings: effectiveSettings(req.userId) });
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
      // score: every judged solution is a try, whatever the verdict
      if (reply.kind === 'verdict') e.guesses = guessesMade(e) + 1;
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
  res.json({ model: GENERATOR_MODEL, gameMasterModel: CLAUDE_MODEL, tools: GENERATOR_TOOLS, difficulties: GEN_DIFFICULTIES, maxCount: 6, running: runningJob(), jobs: listJobs() });
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

/** Change a puzzle in the bank (currently its difficulty); the change is visible to every player. */
app.patch('/api/puzzles/:id', (req, res) => {
  const patch = {};
  if (req.body?.difficulty !== undefined) patch.difficulty = String(req.body.difficulty);
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  try {
    const puzzle = updatePuzzle(req.params.id, patch);
    if (!puzzle) return res.status(404).json({ error: 'Unknown puzzle' });
    console.log(`[bank] "${puzzle.title}" difficulty -> ${puzzle.difficulty}`);
    res.json({ puzzle: publicPuzzle(puzzle) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Remove a puzzle from the bank for everyone; this player's progress on it is dropped too. */
app.delete('/api/puzzles/:id', (req, res) => {
  const removed = deletePuzzle(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Unknown puzzle' });
  resetProgress(req.userId, removed.id);
  console.log(`[bank] deleted "${removed.title}" (${removed.id})`);
  res.json({ ok: true, remaining: loadPuzzles().length });
});

/** Download this player's progress as a JSON file. */
app.get('/api/progress/export', (req, res) => {
  const data = exportProgress(req.userId);
  const stamp = new Date().toISOString().slice(0, 10);
  const who = (data.profile || 'player').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'player';
  res.setHeader('Content-Disposition', `attachment; filename="lateralai-${who}-${stamp}.json"`);
  res.type('application/json').send(JSON.stringify(data, null, 2));
});

/** Replace this player's progress with an exported file. */
app.post('/api/progress/import', (req, res) => {
  try {
    const result = importProgress(req.userId, req.body);
    console.log(`[progress] imported ${result.puzzles} puzzles, ${result.messages} messages`);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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
app.get('/leaderboard', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'leaderboard.html')));
app.use(express.static(PUBLIC_DIR));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'That file is not valid JSON' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That file is too large' });
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

loadPuzzles(); // fail fast on a broken bank
app.listen(PORT, () => {
  console.log(`Lateral game on http://localhost:${PORT}  (game master: ${CLAUDE_MODEL}, puzzle writer: ${GENERATOR_MODEL}, ${loadPuzzles().length} puzzles${DEBUG ? ', debug on' : ''})`);
});
