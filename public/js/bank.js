import { api, escapeHtml, badge, difficultyBadge, editDifficulty, confirmModal, STATUS_LABEL, loadHeaderStats, iconButton, renderProfileBar, wireProgressIO, renderNavIcons, renderThemeControl, icon } from './common.js';

const rowsEl = document.getElementById('rows');
const searchEl = document.getElementById('search');
const statusEl = document.getElementById('filter-status');
const diffEl = document.getElementById('filter-difficulty');
const countEl = document.getElementById('count');
const addedEl = document.getElementById('filter-added');
const modelEl = document.getElementById('filter-model');
const ratingEl = document.getElementById('filter-rating');

let puzzles = [];
// Newest additions first by default; clicking a header sorts ascending, clicking again descending.
const sort = { key: 'added', dir: 'desc' };
const DIFFICULTY_RANK = { easy: 0, medium: 1, hard: 2 };
const STATUS_RANK = { new: 0, tried: 1, revealed: 2, solved: 3 };

/** Sort value for a puzzle under a column; null means "no value", which always sorts last. */
function sortValue(p, key) {
  switch (key) {
    case 'title': return p.title.toLowerCase();
    case 'difficulty': return DIFFICULTY_RANK[p.difficulty] ?? 9;
    case 'model': return p.model || null;
    case 'status': return STATUS_RANK[p.status] ?? 9;
    case 'score': return p.status === 'solved' ? p.points : null;
    case 'hints': return p.hintsGiven;
    case 'played': return p.updatedAt ? Date.parse(p.updatedAt) : null;
    case 'added': return p.addedAt ? Date.parse(p.addedAt) : null;
    default: return null;
  }
}

function sortPuzzles(list) {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = sortValue(a, sort.key), vb = sortValue(b, sort.key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return c * dir || a.title.localeCompare(b.title);
  });
}

function renderSortIndicators() {
  for (const b of document.querySelectorAll('th .sort')) {
    const active = b.dataset.sort === sort.key;
    b.classList.toggle('active', active);
    b.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    b.querySelector('.arrow')?.remove();
    if (active) b.insertAdjacentHTML('beforeend', `<span class="arrow">${sort.dir === 'asc' ? '▲' : '▼'}</span>`);
  }
}

function fmtDate(iso) {
  if (!iso) return '<span class="excerpt">—</span>';
  const d = new Date(iso);
  return escapeHtml(d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
}

/** Play / Continue / Review, depending on the puzzle's status. Continue and Review reopen the stored conversation. */
function playButton(p) {
  const href = `/?id=${encodeURIComponent(p.id)}`;
  const msgs = p.messageCount ? ` (${p.messageCount} message${p.messageCount === 1 ? '' : 's'})` : '';
  if (p.status === 'tried') return iconButton({ name: 'resume', label: `Continue the conversation${msgs}`, href, cls: 'primary' });
  if (p.status === 'solved' || p.status === 'revealed') return iconButton({ name: 'review', label: `Review the conversation${msgs}`, href });
  return iconButton({ name: 'play', label: 'Play', href, cls: 'primary' });
}

function fmtPoints(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

/** Long form of how a solved puzzle earned its points, shown as the score's tooltip. */
function scoreTooltip(p) {
  const { base, costs } = p.scoreParts;
  const parts = [`${p.difficulty[0].toUpperCase()}${p.difficulty.slice(1)} puzzle solved: ${base} points`];
  if (p.questionsAsked) parts.push(`${plural(p.questionsAsked, 'question')} × ${costs.question} = −${fmtPoints(p.questionsAsked * costs.question)}`);
  if (p.hintsGiven) parts.push(`${plural(p.hintsGiven, 'hint')} × ${costs.hint} = −${fmtPoints(p.hintsGiven * costs.hint)}`);
  if (p.guesses) parts.push(`${plural(p.guesses, 'try', 'tries')} × ${costs.try} = −${fmtPoints(p.guesses * costs.try)}`);
  parts.push(`total ${fmtPoints(p.points)} point${p.points === 1 ? '' : 's'}${p.points === 0 ? ' (never below zero)' : ''}`);
  return parts.join('\n');
}

/** Score column: the leaderboard points for a solved puzzle, then what it took to get there. */
function score(p) {
  const tries = `<span class="tries">${plural(p.guesses, 'try', 'tries')}</span>`;
  if (p.status === 'solved') {
    return `<span class="score" title="${escapeHtml(scoreTooltip(p))}">
      <span class="points">${fmtPoints(p.points)} <small>pts</small></span>
      <span class="tries">${plural(p.questionsAsked, 'question')}</span>${tries}</span>`;
  }
  if (p.status === 'tried' && (p.questionsAsked || p.guesses)) return `<span class="score"><span class="excerpt">${plural(p.questionsAsked, 'question')} so far</span>${tries}</span>`;
  return '<span class="excerpt">—</span>';
}

function render() {
  const q = searchEl.value.trim().toLowerCase();
  const st = statusEl.value;
  const df = diffEl.value;
  const days = Number(addedEl.value) || 0;
  const since = days ? Date.now() - days * 86400000 : 0;
  const md = modelEl.value;
  const rt = ratingEl.value;
  const list = sortPuzzles(puzzles.filter((p) =>
    (!st || p.status === st) && (!df || p.difficulty === df) && (!md || p.model === md) &&
    (!rt || (rt === 'none' ? !p.rating : p.rating === rt)) &&
    (!since || (p.addedAt && Date.parse(p.addedAt) >= since)) &&
    (!q || p.title.toLowerCase().includes(q) || p.situation.toLowerCase().includes(q))));
  renderSortIndicators();
  countEl.textContent = `${list.length} of ${puzzles.length} puzzles`;
  if (!list.length) { rowsEl.innerHTML = '<tr><td colspan="9" class="empty">No puzzles match these filters.</td></tr>'; return; }
  rowsEl.innerHTML = list.map((p) => `
    <tr data-id="${escapeHtml(p.id)}">
      <td class="title">${p.rating ? `<span class="row-rating ${p.rating}" title="${p.rating === 'up' ? 'You liked this puzzle' : 'You did not like this puzzle'}">${icon(p.rating === 'up' ? 'thumbUp' : 'thumbDown')}</span>` : ''}<a href="/?id=${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a>
        <div class="excerpt">${escapeHtml(p.situation.length > 140 ? p.situation.slice(0, 140) + '…' : p.situation)}</div></td>
      <td class="difficulty-cell" data-difficulty="${escapeHtml(p.difficulty)}">${difficultyBadge(p.difficulty)}</td>
      <td class="model-cell">${p.model ? `<span class="model" title="${p.model === 'web-search' ? `Collected from the web${p.sourceUrl ? `: ${escapeHtml(p.sourceUrl)}` : ''}` : `Written by Claude ${escapeHtml(p.model)}`}">${escapeHtml(p.model.replace(/-/g, ' '))}</span>` : '<span class="excerpt">—</span>'}</td>
      <td>${badge(p.status, STATUS_LABEL[p.status])}</td>
      <td>${score(p)}</td>
      <td>${p.hintsGiven}/${p.hintCount}</td>
      <td>${fmtDate(p.updatedAt)}${p.messageCount ? `<div class="excerpt">${p.messageCount} message${p.messageCount === 1 ? '' : 's'}</div>` : ''}</td>
      <td>${fmtDate(p.addedAt)}</td>
      <td class="right actions">
        ${playButton(p)}
        ${iconButton({ name: 'reset', label: 'Reset progress', cls: 'danger', attrs: `data-reset="${escapeHtml(p.id)}"`, disabled: p.status === 'new' })}
        ${iconButton({ name: 'trash', label: 'Delete puzzle', cls: 'danger', attrs: `data-delete="${escapeHtml(p.id)}"` })}
      </td>
    </tr>`).join('');
}

async function load() {
  puzzles = await api('/api/puzzles');
  fillModelFilter();
  render();
  loadHeaderStats();
  renderProfileBar();
}

renderNavIcons();
renderThemeControl();

for (const el of [searchEl, statusEl, diffEl, addedEl, modelEl, ratingEl]) el.addEventListener('input', render);

/** The filter lists the models actually present in the bank. */
function fillModelFilter() {
  const models = [...new Set(puzzles.map((p) => p.model).filter(Boolean))].sort();
  const chosen = modelEl.value;
  modelEl.innerHTML = `<option value="">Any model</option>${models.map((m) => `<option value="${escapeHtml(m)}"${m === chosen ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('')}`;
}

document.querySelector('.bank-table thead').addEventListener('click', (e) => {
  const key = e.target.closest('[data-sort]')?.dataset.sort;
  if (!key) return;
  if (sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
  else { sort.key = key; sort.dir = 'asc'; }
  render();
});

rowsEl.addEventListener('dblclick', (e) => {
  const cell = e.target.closest('.difficulty-cell');
  if (!cell) return;
  const id = cell.closest('tr').dataset.id;
  editDifficulty(cell, { id, current: cell.dataset.difficulty, onSaved: load });
});

rowsEl.addEventListener('click', async (e) => {
  const resetId = e.target.closest('[data-reset]')?.dataset.reset;
  const deleteId = e.target.closest('[data-delete]')?.dataset.delete;
  if (resetId) {
    const p = puzzles.find((x) => x.id === resetId);
    const ok = await confirmModal({
      title: `Reset "${p.title}"?`,
      body: 'This clears the solved status and the chat history for this puzzle. You can play it again from scratch.',
      confirmLabel: 'Reset puzzle', danger: true,
    });
    if (!ok) return;
    await api('/api/progress/reset', { method: 'POST', body: { puzzleId: resetId } });
    await load();
  } else if (deleteId) {
    const p = puzzles.find((x) => x.id === deleteId);
    const ok = await confirmModal({
      title: `Delete "${p.title}"?`,
      body: 'This removes the puzzle from the question bank for every player. It cannot be undone from the app.',
      confirmLabel: 'Delete puzzle', danger: true,
    });
    if (!ok) return;
    await api(`/api/puzzles/${encodeURIComponent(deleteId)}`, { method: 'DELETE' });
    await load();
  }
});

wireProgressIO({
  exportEl: document.getElementById('export-progress'),
  importEl: document.getElementById('import-progress'),
  fileEl: document.getElementById('import-file'),
  onImported: load,
});

document.getElementById('reset-all').addEventListener('click', async () => {
  const ok = await confirmModal({
    title: 'Reset all progress?',
    body: 'Every puzzle goes back to "new" and all chat histories are deleted. This cannot be undone.',
    confirmLabel: 'Reset everything', danger: true,
  });
  if (!ok) return;
  await api('/api/progress/reset', { method: 'POST', body: {} });
  await load();
});

load().catch((err) => { rowsEl.innerHTML = `<tr><td colspan="9" class="empty">${escapeHtml(err.message)}</td></tr>`; });
