import { api, escapeHtml, loadHeaderStats, renderProfileBar, wireProgressIO, editTextInline, activeProfileId } from './common.js';

const rowsEl = document.getElementById('rows');
const nameEl = document.getElementById('current-name');

let activeId = null;

function fmtPoints(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

function render(rows) {
  if (!rows.length) { rowsEl.innerHTML = '<tr><td colspan="7" class="empty">No player profiles yet.</td></tr>'; return; }
  rowsEl.innerHTML = rows.map((r, i) => `
    <tr class="${r.id === activeId ? 'is-active' : ''}">
      <td class="rank">${i + 1}</td>
      <td class="title">${escapeHtml(r.name)}${r.id === activeId ? ' <span class="you">you</span>' : ''}</td>
      <td class="num points">${fmtPoints(r.points)}</td>
      <td class="num">${r.solved}</td>
      <td class="num">${r.easy}</td>
      <td class="num">${r.medium}</td>
      <td class="num">${r.hard}</td>
    </tr>`).join('');
}

async function load() {
  const data = await api('/api/leaderboard');
  activeId = activeProfileId() || data.activeId;
  render(data.rows);
  const me = data.rows.find((r) => r.id === activeId);
  nameEl.textContent = me ? me.name : 'Player';
  nameEl.dataset.name = me ? me.name : '';
  loadHeaderStats();
  renderProfileBar();
}

// rename the active profile in place
nameEl.addEventListener('dblclick', () => {
  editTextInline(nameEl, {
    value: nameEl.dataset.name || nameEl.textContent.trim(),
    onSave: async (name) => {
      await api(`/api/profiles/${encodeURIComponent(activeId)}`, { method: 'PATCH', body: { name } });
      await load();
    },
  });
});

wireProgressIO({
  exportEl: document.getElementById('export-progress'),
  importEl: document.getElementById('import-progress'),
  fileEl: document.getElementById('import-file'),
  onImported: load,
});

load().catch((err) => { rowsEl.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(err.message)}</td></tr>`; });
