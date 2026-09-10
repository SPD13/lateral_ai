import { api, escapeHtml, badge, loadHeaderStats, renderProfileBar, renderNavIcons } from './common.js';

const $ = (id) => document.getElementById(id);
const els = { form: $('gen-form'), count: $('count'), difficulty: $('difficulty'), generate: $('generate'), model: $('gen-model'), status: $('gen-status'), list: $('candidates'), pending: $('pending-count') };

let config = null;
let pollTimer = null;
let ticker = null;

function setStatus(html, kind = '') {
  els.status.hidden = !html;
  els.status.className = `gen-status ${kind}`;
  els.status.innerHTML = html;
}

function elapsed(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function showJob(job) {
  if (job.status === 'running') {
    els.generate.disabled = true;
    const line = () => setStatus(`<span class="spinner"></span> Writing ${job.count} ${job.difficulty === 'mixed' ? '' : job.difficulty + ' '}puzzle${job.count === 1 ? '' : 's'} with claude ${escapeHtml(job.model)}… ${elapsed(job.startedAt)}. This can take a few minutes.`, 'running');
    line();
    clearInterval(ticker); ticker = setInterval(line, 1000);
    return;
  }
  clearInterval(ticker);
  els.generate.disabled = false;
  if (job.status === 'error') { setStatus(`Generation failed: ${escapeHtml(job.error)}`, 'error'); return; }
  const dropped = job.dropped.length ? `<ul class="dropped">${job.dropped.map((d) => `<li><b>${escapeHtml(d.title)}</b>: ${escapeHtml(d.reason)}</li>`).join('')}</ul>` : '';
  const tokens = job.tokens ? ` · ${job.tokens.total.toLocaleString()} tokens <span class="excerpt">(${job.tokens.input.toLocaleString()} in, ${job.tokens.output.toLocaleString()} out)</span>` : '';
  setStatus(`Done in ${elapsed(job.startedAt)}: <b>${job.added.length}</b> new puzzle${job.added.length === 1 ? '' : 's'} to review${job.dropped.length ? `, ${job.dropped.length} dropped` : ''}${tokens}.${dropped}`, 'done');
}

async function poll(jobId) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const { job } = await api(`/api/generate/jobs/${jobId}`);
      showJob(job);
      if (job.status !== 'running') { clearInterval(pollTimer); await loadCandidates(); loadHeaderStats(); }
    } catch (err) { clearInterval(pollTimer); setStatus(escapeHtml(err.message), 'error'); els.generate.disabled = false; }
  }, 2000);
}

function candidateEl(c) {
  const div = document.createElement('article');
  div.className = 'card candidate';
  div.dataset.id = c.candidateId;
  div.innerHTML = `
    <div class="puzzle-head">
      <h3>${escapeHtml(c.title)}</h3>
      ${badge(c.difficulty)}
      <span class="spacer"></span>
      <span class="excerpt">${escapeHtml(new Date(c.createdAt).toLocaleString())}</span>
    </div>
    <p class="situation">${escapeHtml(c.situation)}</p>
    ${c.inspiration ? `<p class="inspiration">Inspiration: ${escapeHtml(c.inspiration)}</p>` : ''}
    <button class="btn small reveal-btn" type="button" data-act="toggle" aria-expanded="false">Show solution</button>
    <div class="solution" hidden>
      <p><b>Solution.</b> ${escapeHtml(c.solution)}</p>
      ${c.keyFacts.length ? `<p><b>Key facts</b></p><ul>${c.keyFacts.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : ''}
      ${c.hints.length ? `<p><b>Hints</b></p><ol>${c.hints.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ol>` : ''}
    </div>
    <div class="candidate-actions">
      <button class="btn primary" type="button" data-act="approve">Approve and add to the bank</button>
      <button class="btn danger" type="button" data-act="reject">Reject</button>
      <span class="excerpt" data-msg></span>
    </div>`;
  return div;
}

async function loadCandidates() {
  const list = await api('/api/candidates');
  els.pending.textContent = list.length ? `(${list.length})` : '';
  els.list.innerHTML = '';
  if (!list.length) { els.list.innerHTML = '<div class="card empty">No puzzles waiting for review. Generate some above.</div>'; return; }
  for (const c of list) els.list.appendChild(candidateEl(c));
}

els.list.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const card = btn.closest('.candidate');
  const id = card.dataset.id;
  if (btn.dataset.act === 'toggle') {
    const sol = card.querySelector('.solution');
    sol.hidden = !sol.hidden;
    btn.textContent = sol.hidden ? 'Show solution' : 'Hide solution';
    btn.setAttribute('aria-expanded', String(!sol.hidden));
    return;
  }
  const msg = card.querySelector('[data-msg]');
  for (const b of card.querySelectorAll('button')) b.disabled = true;
  try {
    if (btn.dataset.act === 'approve') {
      const { puzzle } = await api(`/api/candidates/${id}/approve`, { method: 'POST' });
      msg.textContent = `Added to the bank as "${puzzle.id}".`;
    } else {
      await api(`/api/candidates/${id}/reject`, { method: 'POST' });
      msg.textContent = 'Rejected.';
    }
    card.classList.add('leaving');
    setTimeout(async () => { await loadCandidates(); loadHeaderStats(); }, 400);
  } catch (err) {
    msg.textContent = err.message;
    for (const b of card.querySelectorAll('button')) b.disabled = false;
  }
});

renderNavIcons();

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.generate.disabled = true;
  try {
    const { job } = await api('/api/generate', { method: 'POST', body: { count: Number(els.count.value), difficulty: els.difficulty.value } });
    showJob(job);
    poll(job.id);
  } catch (err) { setStatus(escapeHtml(err.message), 'error'); els.generate.disabled = false; }
});

async function init() {
  config = await api('/api/generate/config');
  els.count.max = config.maxCount;
  els.model.innerHTML = `Puzzle writer: <b>claude ${escapeHtml(config.model)}</b>${config.tools.length ? ' with web search' : ''}`;
  els.model.title = 'Set in the launcher (Setup tab) or with the GENERATOR_MODEL environment variable';
  if (config.running) { showJob(config.running); poll(config.running.id); }
  else if (config.jobs[0]) showJob(config.jobs[0]);
  await loadCandidates();
  loadHeaderStats();
  renderProfileBar();
}
init().catch((err) => setStatus(escapeHtml(err.message), 'error'));
