import { api, escapeHtml, badge, confirmModal, STATUS_LABEL, loadHeaderStats } from './common.js';

const rowsEl = document.getElementById('rows');
const searchEl = document.getElementById('search');
const statusEl = document.getElementById('filter-status');
const diffEl = document.getElementById('filter-difficulty');
const countEl = document.getElementById('count');

let puzzles = [];

function fmtDate(iso) {
  if (!iso) return '<span class="excerpt">never</span>';
  const d = new Date(iso);
  return escapeHtml(d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
}

function render() {
  const q = searchEl.value.trim().toLowerCase();
  const st = statusEl.value;
  const df = diffEl.value;
  const list = puzzles.filter((p) =>
    (!st || p.status === st) && (!df || p.difficulty === df) &&
    (!q || p.title.toLowerCase().includes(q) || p.situation.toLowerCase().includes(q)));
  countEl.textContent = `${list.length} of ${puzzles.length} puzzles`;
  if (!list.length) { rowsEl.innerHTML = '<tr><td colspan="6" class="empty">No puzzles match these filters.</td></tr>'; return; }
  rowsEl.innerHTML = list.map((p) => `
    <tr data-id="${escapeHtml(p.id)}">
      <td class="title"><a href="/?id=${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a>
        <div class="excerpt">${escapeHtml(p.situation.length > 140 ? p.situation.slice(0, 140) + '…' : p.situation)}</div></td>
      <td>${badge(p.difficulty)}</td>
      <td>${badge(p.status, STATUS_LABEL[p.status])}</td>
      <td>${p.hintsGiven}/${p.hintCount}</td>
      <td>${fmtDate(p.updatedAt)}</td>
      <td class="right">
        <a class="btn small" href="/?id=${encodeURIComponent(p.id)}">${p.status === 'new' ? 'Play' : p.status === 'solved' || p.status === 'revealed' ? 'Review' : 'Continue'}</a>
        <button class="btn small danger" data-reset="${escapeHtml(p.id)}" ${p.status === 'new' ? 'disabled' : ''}>Reset</button>
      </td>
    </tr>`).join('');
}

async function load() {
  puzzles = await api('/api/puzzles');
  render();
  loadHeaderStats();
}

for (const el of [searchEl, statusEl, diffEl]) el.addEventListener('input', render);

rowsEl.addEventListener('click', async (e) => {
  const id = e.target.closest('[data-reset]')?.dataset.reset;
  if (!id) return;
  const p = puzzles.find((x) => x.id === id);
  const ok = await confirmModal({
    title: `Reset "${p.title}"?`,
    body: 'This clears the solved status and the chat history for this puzzle. You can play it again from scratch.',
    confirmLabel: 'Reset puzzle', danger: true,
  });
  if (!ok) return;
  await api('/api/progress/reset', { method: 'POST', body: { puzzleId: id } });
  await load();
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

load().catch((err) => { rowsEl.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(err.message)}</td></tr>`; });
