import { api, escapeHtml, loadHeaderStats, renderProfileBar, wireProgressIO, editTextInline, activeProfileId, setActiveProfileId, iconButton, confirmModal, renderNavIcons } from './common.js';

const rowsEl = document.getElementById('rows');
const nameEl = document.getElementById('current-name');

let activeId = null;

function fmtPoints(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

function render(rows) {
  if (!rows.length) { rowsEl.innerHTML = '<tr><td colspan="8" class="empty">No player profiles yet.</td></tr>'; return; }
  const only = rows.length === 1; // the last profile cannot be deleted
  rowsEl.innerHTML = rows.map((r, i) => `
    <tr class="${r.id === activeId ? 'is-active' : ''}" data-id="${escapeHtml(r.id)}" data-name="${escapeHtml(r.name)}" data-solved="${r.solved}">
      <td class="rank">${i + 1}</td>
      <td class="title">${escapeHtml(r.name)}${r.id === activeId ? ' <span class="you">you</span>' : ''}</td>
      <td class="num points">${fmtPoints(r.points)}</td>
      <td class="num">${r.solved}</td>
      <td class="num">${r.easy}</td>
      <td class="num">${r.medium}</td>
      <td class="num">${r.hard}</td>
      <td class="right actions">${iconButton({ name: 'trash', label: only ? 'The only profile cannot be deleted' : `Delete ${r.name}`, cls: 'danger', attrs: 'data-delete="1"', disabled: only })}</td>
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

renderNavIcons();

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

rowsEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-delete]');
  if (!btn) return;
  const row = btn.closest('tr');
  const { id, name, solved } = row.dataset;
  const mine = id === activeId;
  const ok = await confirmModal({
    title: `Delete the profile "${name}"?`,
    body: [
      `This permanently removes ${mine ? 'your' : 'their'} ${solved} solved puzzle${solved === '1' ? '' : 's'}, every conversation and every score.`,
      mine ? 'You will be switched to another profile.' : '',
      'This cannot be undone.',
    ].filter(Boolean).join(' '),
    confirmLabel: 'Delete profile', danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (mine) { setActiveProfileId(''); location.reload(); return; }
    await load();
  } catch (err) { alert(err.message); }
});

wireProgressIO({
  exportEl: document.getElementById('export-progress'),
  importEl: document.getElementById('import-progress'),
  fileEl: document.getElementById('import-file'),
  onImported: load,
});

load().catch((err) => { rowsEl.innerHTML = `<tr><td colspan="8" class="empty">${escapeHtml(err.message)}</td></tr>`; });
