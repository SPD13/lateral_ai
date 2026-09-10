import { api, escapeHtml, badge, confirmModal, loadHeaderStats, renderProfileBar, renderNavIcons } from './common.js';

const $ = (id) => document.getElementById(id);
const els = { form: $('gen-form'), count: $('count'), difficulty: $('difficulty'), generate: $('generate'), model: $('gen-model'), status: $('gen-status'), list: $('candidates'), pending: $('pending-count'),
  collect: $('collect'), collectCount: $('collect-count'), collectStatus: $('collect-status'), collectSources: $('collect-sources'),
  sources: $('sources'), sourceList: $('source-list'), sourcesCount: $('sources-count'),
  approveAll: $('approve-all'), rejectAll: $('reject-all') };

let config = null;
let pollTimer = null;
let ticker = null;

/** Both cards share this: a running job writes into the card it belongs to. */
function statusEl(job) { return job?.kind === 'collect' ? els.collectStatus : els.status; }

function setStatus(html, kind = '', el = els.status) {
  el.hidden = !html;
  el.className = `gen-status ${kind}`;
  el.innerHTML = html;
}

function setBusy(busy) {
  els.generate.disabled = busy;
  els.collect.disabled = busy;
  for (const b of els.sourceList.querySelectorAll('button')) b.disabled = busy;
}

/** The pages already used, each with a way to go back for the puzzles it has not given yet. */
async function loadSources() {
  let sources = [];
  try { sources = await api('/api/sources'); } catch { return; }
  els.sources.hidden = sources.length === 0;
  els.sourcesCount.textContent = sources.length ? `(${sources.length})` : '';
  els.collectSources.textContent = sources.length ? `${sources.length} source${sources.length === 1 ? '' : 's'} used so far` : 'No sources used yet';
  els.sourceList.innerHTML = sources.map((s) => `
    <li${s.exhausted ? ' class="spent"' : ''}>
      <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title || s.url)}</a>
      <span class="excerpt">${s.taken} puzzle${s.taken === 1 ? '' : 's'} taken · ${s.visits} visit${s.visits === 1 ? '' : 's'}</span>
      ${s.exhausted
        ? `<span class="spent-label" title="The last visit brought back nothing new${s.exhaustedAt ? `, on ${escapeHtml(new Date(s.exhaustedAt).toLocaleString())}` : ''}">exhausted</span>`
        : `<button type="button" class="btn small" data-more="${escapeHtml(s.url)}">Take more</button>`}
    </li>`).join('');
}

els.sourceList.addEventListener('click', async (e) => {
  const url = e.target.closest('[data-more]')?.dataset.more;
  if (!url) return;
  setBusy(true);
  try {
    const { job } = await api('/api/collect', { method: 'POST', body: { sourceUrl: url, count: Number(els.collectCount.value) } });
    showJob(job);
    poll(job.id);
  } catch (err) { setStatus(escapeHtml(err.message), 'error', els.collectStatus); setBusy(false); }
});

function elapsed(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function showJob(job) {
  const el = statusEl(job);
  const collecting = job.kind === 'collect';
  if (job.status === 'running') {
    setBusy(true);
    const line = () => setStatus(collecting
      ? (job.mode === 'more'
        ? `<span class="spinner"></span> Going back to ${escapeHtml(job.source?.url || 'the page')} for puzzles it has not given yet… ${elapsed(job.startedAt)}.`
        : `<span class="spinner"></span> Searching the web for a new source, reading it and formatting what it holds… ${elapsed(job.startedAt)}. This can take several minutes.`)
      : `<span class="spinner"></span> Writing ${job.count} ${job.difficulty === 'mixed' ? '' : job.difficulty + ' '}puzzle${job.count === 1 ? '' : 's'} with claude ${escapeHtml(job.model)}… ${elapsed(job.startedAt)}. This can take a few minutes.`, 'running', el);
    line();
    clearInterval(ticker); ticker = setInterval(line, 1000);
    return;
  }
  clearInterval(ticker);
  setBusy(false);
  if (job.status === 'error') { setStatus(`${collecting ? 'Search' : 'Generation'} failed: ${escapeHtml(job.error)}`, 'error', el); return; }
  const dropped = job.dropped.length ? `<ul class="dropped">${job.dropped.map((d) => `<li><b>${escapeHtml(d.title)}</b>: ${escapeHtml(d.reason)}</li>`).join('')}</ul>` : '';
  const tokens = job.tokens ? ` · ${job.tokens.total.toLocaleString()} tokens <span class="excerpt">(${job.tokens.input.toLocaleString()} in, ${job.tokens.output.toLocaleString()} out)</span>` : '';
  const source = collecting && job.source
    ? ` from <a href="${escapeHtml(job.source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(job.source.title || job.source.url)}</a>`
    : '';
  setStatus(`Done in ${elapsed(job.startedAt)}: <b>${job.added.length}</b> new puzzle${job.added.length === 1 ? '' : 's'} to review${source}${job.dropped.length ? `, ${job.dropped.length} dropped` : ''}${tokens}.${dropped}`, 'done', el);
}

async function poll(jobId) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const { job } = await api(`/api/generate/jobs/${jobId}`);
      showJob(job);
      if (job.status !== 'running') { clearInterval(pollTimer); await loadCandidates(); loadSources(); loadHeaderStats(); }
    } catch (err) { clearInterval(pollTimer); setStatus(escapeHtml(err.message), 'error'); setBusy(false); }
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
    ${c.sourceUrl ? `<p class="source-line">Source: <a href="${escapeHtml(c.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.sourceUrl)}</a></p>` : ''}
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
  els.approveAll.disabled = !list.length;
  els.rejectAll.disabled = !list.length;
  els.list.innerHTML = '';
  if (!list.length) { els.list.innerHTML = '<div class="card empty">No puzzles waiting for review. Generate some above.</div>'; return; }
  for (const c of list) els.list.appendChild(candidateEl(c));
}

/** Approve or reject the whole list at once, after saying how many that is. */
async function reviewAll(action) {
  const pending = els.list.querySelectorAll('.candidate').length;
  if (!pending) return;
  const approving = action === 'approve';
  const ok = await confirmModal({
    title: approving ? `Approve all ${pending} puzzles?` : `Reject all ${pending} puzzles?`,
    body: approving
      ? `All ${pending} puzzle${pending === 1 ? '' : 's'} waiting for review go into the question bank, without reading them one by one.`
      : `All ${pending} puzzle${pending === 1 ? '' : 's'} waiting for review are discarded. This cannot be undone, and a later search may not find them again.`,
    confirmLabel: approving ? 'Approve all' : 'Reject all', danger: !approving,
  });
  if (!ok) return;
  els.approveAll.disabled = true;
  els.rejectAll.disabled = true;
  try {
    const res = await api(`/api/candidates/${approving ? 'approve-all' : 'reject-all'}`, { method: 'POST' });
    await loadCandidates();
    loadSources();
    loadHeaderStats();
    if (approving && res.failed?.length) alert(`Added ${res.approved}. ${res.failed.length} could not be added:\n${res.failed.map((f) => `${f.title}: ${f.reason}`).join('\n')}`);
  } catch (err) {
    alert(err.message);
    await loadCandidates();
  }
}

els.approveAll.addEventListener('click', () => reviewAll('approve'));
els.rejectAll.addEventListener('click', () => reviewAll('reject'));

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
      loadSources();
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

els.collect.addEventListener('click', async () => {
  setBusy(true);
  try {
    const { job } = await api('/api/collect', { method: 'POST', body: { count: Number(els.collectCount.value) } });
    showJob(job);
    poll(job.id);
  } catch (err) { setStatus(escapeHtml(err.message), 'error', els.collectStatus); setBusy(false); }
});

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setBusy(true);
  try {
    const { job } = await api('/api/generate', { method: 'POST', body: { count: Number(els.count.value), difficulty: els.difficulty.value } });
    showJob(job);
    poll(job.id);
  } catch (err) { setStatus(escapeHtml(err.message), 'error'); setBusy(false); }
});

async function init() {
  config = await api('/api/generate/config');
  els.count.max = config.maxCount;
  els.model.innerHTML = `Puzzle writer: <b>claude ${escapeHtml(config.model)}</b>${config.tools.length ? ' with web search' : ''}`;
  els.model.title = 'Set in the launcher (Setup tab) or with the GENERATOR_MODEL environment variable';
  els.collectCount.max = config.collectMax;
  els.collectCount.value = config.collectCount;
  await loadSources();
  els.collect.disabled = !config.tools.length;
  if (!config.tools.length) setStatus('Web search is disabled on this server (GENERATOR_TOOLS is empty).', 'error', els.collectStatus);
  if (config.running) { showJob(config.running); poll(config.running.id); }
  else if (config.jobs[0]) showJob(config.jobs[0]);
  await loadCandidates();
  loadHeaderStats();
  renderProfileBar();
}
init().catch((err) => setStatus(escapeHtml(err.message), 'error'));
