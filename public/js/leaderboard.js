import { api, escapeHtml, loadHeaderStats, renderProfileBar, wireProgressIO, editTextInline, activeProfileId, setActiveProfileId, iconButton, confirmModal, renderNavIcons } from './common.js';

const rowsEl = document.getElementById('rows');
const nameEl = document.getElementById('current-name');
const weightsForm = document.getElementById('weights-form');
const weightsMsg = document.getElementById('weights-msg');
let defaults = null;

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

/** Show the weights in force in the explanation, the example and the form. */
function showScoring(scoring) {
  const values = { ...scoring.difficulty, ...scoring.costs };
  for (const [key, value] of Object.entries(values)) {
    for (const el of document.querySelectorAll(`[data-w="${key}"]`)) el.textContent = fmtPoints(value);
    const input = weightsForm.elements[key];
    if (input && document.activeElement !== input) input.value = value;
  }
  const total = Math.max(0, scoring.difficulty.hard - 6 * scoring.costs.question - scoring.costs.hint - 2 * scoring.costs.try);
  document.getElementById('score-example').innerHTML =
    `Example: a hard puzzle solved with 6 questions, 1 hint and 2 tries scores ${fmtPoints(scoring.difficulty.hard)} − ${fmtPoints(6 * scoring.costs.question)} − ${fmtPoints(scoring.costs.hint)} − ${fmtPoints(2 * scoring.costs.try)} = <b>${fmtPoints(Math.round(total * 100) / 100)}</b> points.`;
}

async function load() {
  const data = await api('/api/leaderboard');
  showScoring(data.scoring);
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

// ---- scoring weights ----
function formWeights() {
  const value = (name) => Number(weightsForm.elements[name].value);
  return { difficulty: { easy: value('easy'), medium: value('medium'), hard: value('hard') },
           costs: { question: value('question'), hint: value('hint'), try: value('try') } };
}

weightsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  weightsMsg.textContent = '';
  const btn = weightsForm.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    await api('/api/scoring', { method: 'PUT', body: { scoring: formWeights() } });
    location.reload(); // recalculate every score from the games already played
  } catch (err) {
    weightsMsg.textContent = err.message;
    btn.disabled = false;
  }
});

document.getElementById('weights-reset').addEventListener('click', async () => {
  if (!defaults) return;
  showScoring(defaults);
  weightsMsg.textContent = 'Defaults filled in — press Save to apply them.';
});

api('/api/scoring').then((d) => { defaults = d.defaults; showScoring(d.scoring); }).catch(() => {});

wireProgressIO({
  exportEl: document.getElementById('export-progress'),
  importEl: document.getElementById('import-progress'),
  fileEl: document.getElementById('import-file'),
  onImported: load,
});

load().catch((err) => { rowsEl.innerHTML = `<tr><td colspan="8" class="empty">${escapeHtml(err.message)}</td></tr>`; });
