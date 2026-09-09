import { api, escapeHtml, badge, confirmModal, STATUS_LABEL, loadHeaderStats } from './common.js';

const $ = (id) => document.getElementById(id);
const els = {
  title: $('puzzle-title'), difficulty: $('puzzle-difficulty'), status: $('puzzle-status'), situation: $('situation'), count: $('question-count'),
  banner: $('solved-banner'), bannerText: $('solved-text'), next: $('next-puzzle'), newPuzzle: $('new-puzzle'), diffFilter: $('difficulty-filter'),
  log: $('chat-log'), composer: $('composer'), input: $('input'), send: $('send'), hintLine: $('hint-line'),
};
const modeButtons = [...document.querySelectorAll('.mode')];

const state = { puzzle: null, progress: null, mode: 'question', busy: false };

const PLACEHOLDERS = {
  question: 'Is the man alone?',
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
  els.difficulty.innerHTML = badge(p.difficulty);
  els.status.innerHTML = badge(pr.status, STATUS_LABEL[pr.status]);
  els.situation.textContent = p.situation;
  els.situation.classList.remove('loading');
  const n = pr.questionsAsked || 0;
  els.count.textContent = `${n} question${n === 1 ? '' : 's'}`;
  const done = pr.status === 'solved' || pr.status === 'revealed';
  els.banner.hidden = !done;
  els.bannerText.textContent = pr.status === 'solved'
    ? `Solved in ${n} question${n === 1 ? '' : 's'}${pr.hintsGiven ? ` and ${pr.hintsGiven} hint${pr.hintsGiven === 1 ? '' : 's'}` : ''}. Nicely done.`
    : 'Solution revealed. Better luck on the next one.';
  document.title = `Lateral · ${p.title}`;
  history.replaceState(null, '', `/?id=${encodeURIComponent(p.id)}`);
}

function tagFor(m) {
  if (m.role === 'user') return { question: 'Question', guess: 'Your solution', hint: 'Hint request', reveal: 'Giving up' }[m.intent] || 'You';
  if (m.kind === 'answer') return { yes: 'Yes', no: 'No', irrelevant: 'Irrelevant', cannot_say: "Can't say" }[m.answer] || 'Answer';
  if (m.kind === 'verdict') return { correct: 'Correct!', close: 'Close…', incorrect: 'Not quite' }[m.verdict] || 'Verdict';
  return { hint: 'Hint', solution: 'Solution', note: 'Game master' }[m.kind] || 'Game master';
}

/** Same rule as the server's score: a message sent as a question that the game master actually answered. */
function countsAsQuestion(userMsg, agentMsg) {
  return !!userMsg && userMsg.role === 'user' && userMsg.intent === 'question' && agentMsg.role === 'agent' && agentMsg.kind === 'answer';
}

function messageEl(m, { withActions = false, counted = false } = {}) {
  const div = document.createElement('div');
  const cls = ['msg', m.role];
  if (m.kind) cls.push(`kind-${m.kind}`);
  if (m.answer) cls.push(`answer-${m.answer}`);
  if (m.verdict) cls.push(`verdict-${m.verdict}`);
  if (counted) cls.push('counted');
  div.className = cls.join(' ');
  const marker = counted ? '<span class="plus-one" title="Counted as a question">+1</span>' : '';
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
  state.puzzle = data.puzzle; state.progress = data.progress;
  renderPuzzle(); renderHistory();
  setMode('question');
  loadHeaderStats();
}

async function openRandom() {
  const params = new URLSearchParams();
  if (state.puzzle) params.set('exclude', state.puzzle.id);
  if (els.diffFilter.value) params.set('difficulty', els.diffFilter.value);
  const p = await api(`/api/puzzles/random?${params}`);
  if (p.allDone) {
    const goBank = await confirmModal({ title: 'All puzzles done', body: 'You have solved or revealed every puzzle in this difficulty. Reset some from the question bank to play them again, or keep replaying.', confirmLabel: 'Open question bank' });
    if (goBank) { location.href = '/bank'; return; }
  }
  await openPuzzle(p.id);
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
els.newPuzzle.addEventListener('click', () => openRandom().catch(showError));
els.next.addEventListener('click', () => openRandom().catch(showError));

function showError(err) { els.situation.textContent = err.message; els.situation.classList.add('loading'); }

const initialId = new URLSearchParams(location.search).get('id');
(initialId ? openPuzzle(initialId).catch(() => openRandom()) : openRandom()).catch(showError);
