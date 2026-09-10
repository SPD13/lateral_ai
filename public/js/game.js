import { api, escapeHtml, badge, difficultyBadge, editDifficulty, confirmModal, STATUS_LABEL, loadHeaderStats, renderProfileBar, icon, renderNavIcons } from './common.js';

const $ = (id) => document.getElementById(id);
const els = {
  title: $('puzzle-title'), difficulty: $('puzzle-difficulty'), status: $('puzzle-status'), situation: $('situation'), source: $('puzzle-source'), questionCount: $('question-count'), tries: $('try-count'),
  banner: $('solved-banner'), bannerText: $('solved-text'), next: $('next-puzzle'), newPuzzle: $('new-puzzle'),
  log: $('chat-log'), composer: $('composer'), input: $('input'), send: $('send'), hintLine: $('hint-line'),
  grid: document.querySelector('.play-grid'), help: $('help-panel'), helpToggle: $('help-toggle'), helpClose: $('help-close'),
  gmHelp: $('gm-help'), resetPuzzle: $('reset-puzzle'), rating: $('rating'), rateUp: $('rate-up'), rateDown: $('rate-down'),
  count: $('filter-count'),
  filters: { status: $('filter-status'), added: $('filter-added'), rating: $('filter-rating'), model: $('filter-model'), difficulty: $('difficulty-filter') },
};
const modeButtons = [...document.querySelectorAll('.mode')];

const state = { puzzle: null, progress: null, mode: 'question', busy: false, rating: null, list: [] };

// ---------------------------------------------------------------------------
// Which puzzles "Next puzzle" may pick from. The choice is kept on this device.
// ---------------------------------------------------------------------------
const FILTER_KEY = 'lg_play_filters';

function readFilters() {
  const values = {};
  for (const [key, el] of Object.entries(els.filters)) values[key] = el.value;
  return values;
}

function saveFilters() {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(readFilters())); } catch { /* storage unavailable */ }
}

/** What was stored on this device; the model list only exists after the puzzles load, so it is kept here. */
let storedFilters = null;

function restoreFilters() {
  try { storedFilters = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null'); } catch { storedFilters = null; }
  if (!storedFilters) return;
  for (const [key, el] of Object.entries(els.filters)) applyStored(key, el);
}

function applyStored(key, el) {
  const value = storedFilters?.[key];
  if (typeof value === 'string' && [...el.options].some((o) => o.value === value)) el.value = value;
}

function matchesFilters(p) {
  const f = readFilters();
  const days = Number(f.added) || 0;
  if (f.status && p.status !== f.status) return false;
  if (f.difficulty && p.difficulty !== f.difficulty) return false;
  if (f.model && p.model !== f.model) return false;
  if (f.rating && (f.rating === 'none' ? !!p.rating : p.rating !== f.rating)) return false;
  if (days && !(p.addedAt && Date.parse(p.addedAt) >= Date.now() - days * 86400000)) return false;
  return true;
}

function matching() { return state.list.filter(matchesFilters); }

/** The count at the end of the filter line, and the state of the buttons that need a puzzle to go to. */
function renderCount() {
  const n = matching().length;
  els.count.textContent = n ? plural(n, 'puzzle') : 'No puzzles';
  els.count.classList.toggle('empty', n === 0);
  els.newPuzzle.disabled = n === 0;
  els.next.disabled = n === 0;
}

/** Refresh the list of puzzles with this player's status and ratings. */
async function loadList() {
  try {
    state.list = await api('/api/puzzles');
    const models = [...new Set(state.list.map((p) => p.model).filter(Boolean))].sort();
    const chosen = els.filters.model.value;
    els.filters.model.innerHTML = `<option value="">Any model</option>${models.map((m) => `<option value="${escapeHtml(m)}"${m === chosen ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('')}`;
    if (!chosen) applyStored('model', els.filters.model); // the stored model becomes selectable only now
    renderCount();
  } catch { /* keep whatever we had */ }
}

const PLACEHOLDERS = {
  question: 'Ask a yes/no question',
  guess: 'Describe what you think happened…',
  hint: 'Press Send to get the next hint',
  reveal: 'Press Send to give up and see the solution',
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function setMode(mode) {
  state.mode = mode;
  for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  els.input.placeholder = PLACEHOLDERS[mode];
  els.send.textContent = mode === 'hint' ? 'Get hint' : mode === 'reveal' ? 'Show solution' : mode === 'guess' ? 'Submit' : 'Send';
  els.input.focus();
}

function renderPuzzle() {
  const p = state.puzzle, pr = state.progress;
  els.title.textContent = p.title;
  if (els.difficulty.dataset.editing !== '1') els.difficulty.innerHTML = difficultyBadge(p.difficulty);
  els.status.innerHTML = badge(pr.status, STATUS_LABEL[pr.status]);
  els.situation.textContent = p.situation;
  els.situation.classList.remove('loading');
  els.source.hidden = !p.sourceUrl;
  if (p.sourceUrl) els.source.innerHTML = `Source: <a href="${escapeHtml(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.sourceUrl)}</a>`;
  const n = pr.questionsAsked || 0, t = pr.guesses || 0;
  els.questionCount.textContent = plural(n, 'question');
  els.tries.textContent = plural(t, 'try', 'tries');
  const done = pr.status === 'solved' || pr.status === 'revealed';
  els.banner.hidden = !done;
  els.bannerText.textContent = pr.status === 'solved'
    ? `Solved in ${plural(n, 'question')} and ${plural(t, 'try', 'tries')}${pr.hintsGiven ? `, with ${plural(pr.hintsGiven, 'hint')}` : ''}. Nicely done.`
    : 'Solution revealed. Better luck on the next one.';
  els.resetPuzzle.disabled = !(pr.history || []).length;
  renderRating();
  document.title = `LateralAI · ${p.title}`;
  history.replaceState(null, '', `/?id=${encodeURIComponent(p.id)}`);
}

function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

function tagFor(m) {
  if (m.role === 'user') return { question: 'Question', guess: 'Your solution', hint: 'Hint request', reveal: 'Giving up' }[m.intent] || 'You';
  if (m.kind === 'answer') return { yes: 'Yes', no: 'No', irrelevant: 'Irrelevant', cannot_say: "Can't say" }[m.answer] || 'Answer';
  if (m.kind === 'verdict') return { correct: 'Correct!', close: 'Close…', incorrect: 'Not quite' }[m.verdict] || 'Verdict';
  return { hint: 'Hint', solution: 'Solution', note: 'Game master' }[m.kind] || 'Game master';
}

/** Same rules as the server's score: an answered question counts as a question, a judged solution as a try. */
function countsAsQuestion(userMsg, agentMsg) {
  return !!userMsg && userMsg.role === 'user' && userMsg.intent === 'question' && agentMsg.role === 'agent' && agentMsg.kind === 'answer';
}
function countsAsTry(agentMsg) {
  return agentMsg.role === 'agent' && agentMsg.kind === 'verdict';
}

function messageEl(m, { withActions = false, counted = false } = {}) {
  const div = document.createElement('div');
  const cls = ['msg', m.role];
  if (m.kind) cls.push(`kind-${m.kind}`);
  if (m.answer) cls.push(`answer-${m.answer}`);
  if (m.verdict) cls.push(`verdict-${m.verdict}`);
  const isTry = countsAsTry(m);
  if (counted || isTry) cls.push('counted');
  div.className = cls.join(' ');
  const marker = counted ? '<span class="plus-one" title="Counted as a question">+1 question</span>'
    : isTry ? '<span class="plus-one try" title="Counted as a try">+1 try</span>' : '';
  div.innerHTML = `<span class="tag">${escapeHtml(tagFor(m))}${marker}</span>${escapeHtml(m.text)}`;
  if (withActions && m.verdict === 'close') {
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.innerHTML = `<button class="btn small primary" data-act="retry">Try again</button><button class="btn small" data-act="reveal">Show me the solution</button>`;
    div.appendChild(actions);
  }
  return div;
}

function renderHistory() {
  els.log.innerHTML = '';
  const h = state.progress.history || [];
  if (!h.length) { els.log.innerHTML = '<div class="chat-empty">Ask your first yes/no question to get started.</div>'; return; }
  h.forEach((m, i) => els.log.appendChild(messageEl(m, { withActions: i === h.length - 1, counted: countsAsQuestion(h[i - 1], m) })));
  scrollLog();
}

function scrollLog() { els.log.scrollTop = els.log.scrollHeight; }

function setBusy(b) {
  state.busy = b;
  els.send.disabled = b; els.input.disabled = b; els.newPuzzle.disabled = b;
  for (const btn of modeButtons) btn.disabled = b;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
async function openPuzzle(id) {
  const data = await api(`/api/puzzles/${encodeURIComponent(id)}`);
  state.puzzle = data.puzzle; state.progress = data.progress; state.rating = data.progress.rating || null;
  renderPuzzle(); renderHistory();
  setMode('question');
  loadHeaderStats();
}

/** A random puzzle among those the filters allow, avoiding the one on screen when there is a choice. */
async function openRandom() {
  if (!state.list.length) await loadList();
  const pool = matching();
  const others = pool.filter((p) => !state.puzzle || p.id !== state.puzzle.id);
  const from = others.length ? others : pool;
  if (!from.length) { renderCount(); return; }
  await openPuzzle(from[Math.floor(Math.random() * from.length)].id);
}

/** Interpret slash shortcuts typed in the box. Returns { intent, text }. */
function interpret(raw) {
  const t = raw.trim();
  const m = t.match(/^\/(hint|guess|answer|solve|solution|giveup|reveal)\b\s*(.*)$/is);
  if (m) {
    const cmd = m[1].toLowerCase();
    if (cmd === 'hint') return { intent: 'hint', text: m[2] };
    if (cmd === 'guess' || cmd === 'answer' || cmd === 'solve') return { intent: 'guess', text: m[2] };
    return { intent: 'reveal', text: '' };
  }
  return { intent: state.mode, text: t };
}

async function send(intent, text) {
  if (state.busy || !state.puzzle) return;
  if ((intent === 'question' || intent === 'guess') && !text) { els.input.focus(); return; }
  if (intent === 'reveal') {
    const ok = await confirmModal({ title: 'Give up on this puzzle?', body: 'The game master will tell you the full solution and the puzzle will be marked as revealed.', confirmLabel: 'Show the solution', danger: true });
    if (!ok) { setMode('question'); return; }
  }
  els.log.querySelector('.chat-empty')?.remove();
  els.log.querySelectorAll('.actions').forEach((a) => a.remove());
  const shown = text || (intent === 'hint' ? 'Can I have a hint?' : 'I give up. What is the solution?');
  els.log.appendChild(messageEl({ role: 'user', intent, text: shown }));
  const typing = document.createElement('div');
  typing.className = 'msg agent typing'; typing.textContent = 'The game master is thinking…';
  els.log.appendChild(typing); scrollLog();
  els.input.value = ''; autosize();
  setBusy(true);
  try {
    const res = await api(`/api/puzzles/${encodeURIComponent(state.puzzle.id)}/chat`, { method: 'POST', body: { intent, text } });
    typing.remove();
    const m = { role: 'agent', ...res.reply, text: res.reply.message };
    els.log.appendChild(messageEl(m, { withActions: true, counted: countsAsQuestion({ role: 'user', intent }, m) }));
    state.progress = { ...state.progress, ...res.progress, history: [...(state.progress.history || []), { role: 'user', intent, text: shown }, m] };
    renderPuzzle();
    loadHeaderStats();
    loadList();
    setMode(res.reply.verdict === 'close' ? 'guess' : 'question');
  } catch (err) {
    typing.remove();
    const e = document.createElement('div'); e.className = 'msg agent error'; e.textContent = err.message;
    els.log.appendChild(e);
    els.input.value = shown === text ? text : '';
  } finally {
    setBusy(false); scrollLog(); els.input.focus();
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function autosize() { els.input.style.height = 'auto'; els.input.style.height = Math.min(els.input.scrollHeight, 140) + 'px'; }
els.input.addEventListener('input', autosize);
els.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); els.composer.requestSubmit(); } });
els.composer.addEventListener('submit', (e) => { e.preventDefault(); const { intent, text } = interpret(els.input.value); send(intent, text); });
for (const b of modeButtons) b.addEventListener('click', () => { setMode(b.dataset.mode); if (b.dataset.mode === 'hint' || b.dataset.mode === 'reveal') els.composer.requestSubmit(); });
els.log.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'retry') { setMode('guess'); }
  if (act === 'reveal') { send('reveal', ''); }
});
// ---------------------------------------------------------------------------
// Rating: a thumb up or down per puzzle, clicking the active one clears it
// ---------------------------------------------------------------------------
els.rateUp.innerHTML = icon('thumbUp');
els.rateDown.innerHTML = icon('thumbDown');

function renderRating() {
  for (const btn of [els.rateUp, els.rateDown]) {
    const on = state.rating === btn.dataset.rating;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
}

els.rating.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-rating]');
  if (!btn || !state.puzzle) return;
  const next = state.rating === btn.dataset.rating ? null : btn.dataset.rating;
  const previous = state.rating;
  state.rating = next;
  renderRating();
  try {
    const res = await api(`/api/puzzles/${encodeURIComponent(state.puzzle.id)}/rating`, { method: 'PUT', body: { rating: next } });
    state.rating = res.rating;
    loadList();
  } catch (err) {
    state.rating = previous;
    alert(err.message);
  }
  renderRating();
});

els.resetPuzzle.innerHTML = icon('reset');
els.resetPuzzle.addEventListener('click', async () => {
  if (!state.puzzle || state.busy) return;
  const ok = await confirmModal({
    title: `Restart "${state.puzzle.title}"?`,
    body: 'This discards the conversation, the score and the status for this puzzle so you can start it from scratch. The puzzle itself stays in the bank.',
    confirmLabel: 'Restart puzzle', danger: true,
  });
  if (!ok) return;
  els.resetPuzzle.disabled = true;
  try { await api('/api/progress/reset', { method: 'POST', body: { puzzleId: state.puzzle.id } }); await openPuzzle(state.puzzle.id); await loadList(); }
  catch (err) { showError(err); }
});

for (const btn of [els.newPuzzle, els.next]) btn.insertAdjacentHTML('afterbegin', icon('next'));

els.difficulty.addEventListener('dblclick', () => {
  if (!state.puzzle) return;
  editDifficulty(els.difficulty, {
    id: state.puzzle.id,
    current: state.puzzle.difficulty,
    onSaved: (difficulty) => { state.puzzle.difficulty = difficulty; renderPuzzle(); loadHeaderStats(); },
  });
});

for (const el of Object.values(els.filters)) el.addEventListener('change', () => { saveFilters(); renderCount(); });

els.newPuzzle.addEventListener('click', () => openRandom().catch(showError));
els.next.addEventListener('click', () => openRandom().catch(showError));

function showError(err) { els.situation.textContent = err.message; els.situation.classList.add('loading'); }

// ---------------------------------------------------------------------------
// Help panel: open by default on wide screens, collapsed on small ones; the player's choice is remembered.
// ---------------------------------------------------------------------------
const HELP_KEY = 'lg_help';
els.helpToggle.innerHTML = icon('help');
els.helpClose.innerHTML = icon('close');

function setHelp(open, { persist = true, scroll = false } = {}) {
  els.grid.classList.toggle('help-hidden', !open);
  els.helpToggle.setAttribute('aria-expanded', String(open));
  els.helpToggle.classList.toggle('active', open);
  if (persist) { try { localStorage.setItem(HELP_KEY, open ? 'open' : 'closed'); } catch { /* storage unavailable */ } }
  if (open && scroll) els.help.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

(function initHelp() {
  let stored = null;
  try { stored = localStorage.getItem(HELP_KEY); } catch { /* storage unavailable */ }
  const wide = window.matchMedia('(min-width: 861px)').matches;
  setHelp(stored ? stored === 'open' : wide, { persist: false });
})();
els.helpToggle.addEventListener('click', () => setHelp(els.grid.classList.contains('help-hidden'), { scroll: !window.matchMedia('(min-width: 861px)').matches }));
els.helpClose.addEventListener('click', () => setHelp(false));

// ---------------------------------------------------------------------------
// Game master help setting (per player, stored on the server)
// ---------------------------------------------------------------------------
api('/api/settings').then((s) => { els.gmHelp.checked = !!s.gmHelp; }).catch(() => {});
els.gmHelp.addEventListener('change', async () => {
  els.gmHelp.disabled = true;
  try { const s = await api('/api/settings', { method: 'PUT', body: { gmHelp: els.gmHelp.checked } }); els.gmHelp.checked = !!s.gmHelp; }
  catch (err) { els.gmHelp.checked = !els.gmHelp.checked; alert(err.message); }
  finally { els.gmHelp.disabled = false; }
});

renderNavIcons();

renderProfileBar();

restoreFilters();
const initialId = new URLSearchParams(location.search).get('id');
loadList()
  .then(() => (initialId ? openPuzzle(initialId).catch(() => openRandom()) : openRandom()))
  .catch(showError);
