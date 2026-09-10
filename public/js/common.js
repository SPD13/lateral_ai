/* Shared helpers for the game and the bank pages. */
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const STATUS_LABEL = { new: 'New', tried: 'Tried', solved: 'Solved', revealed: 'Revealed' };
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const EDIT_DIFFICULTY_HINT = 'Double-click to change the difficulty';

export function badge(kind, text, title) {
  return `<span class="badge ${escapeHtml(kind)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(text || kind)}</span>`;
}

/** The difficulty badge, marked as editable by a double click. */
export function difficultyBadge(difficulty) {
  return badge(difficulty, difficulty, EDIT_DIFFICULTY_HINT);
}

/**
 * Turn a difficulty badge into a dropdown with Save and Cancel. `container` holds only the badge;
 * its markup is restored on cancel, and `onSaved(difficulty)` runs once the bank has been updated.
 */
export function editDifficulty(container, { id, current, onSaved }) {
  if (container.dataset.editing === '1') return;
  container.dataset.editing = '1';
  const original = container.innerHTML;
  const editor = document.createElement('span');
  editor.className = 'difficulty-editor';
  editor.innerHTML = `
    <select class="btn small" aria-label="Difficulty">${DIFFICULTIES.map((d) => `<option value="${d}"${d === current ? ' selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`).join('')}</select>
    <button type="button" class="btn small primary" data-act="save">Save</button>
    <button type="button" class="btn small" data-act="cancel">Cancel</button>
    <span class="edit-msg" data-msg></span>`;
  container.innerHTML = '';
  container.appendChild(editor);
  const select = editor.querySelector('select');
  select.focus();

  const close = () => { container.innerHTML = original; delete container.dataset.editing; };
  const save = async () => {
    const value = select.value;
    if (value === current) return close();
    for (const el of editor.querySelectorAll('select, button')) el.disabled = true;
    try {
      await api(`/api/puzzles/${encodeURIComponent(id)}`, { method: 'PATCH', body: { difficulty: value } });
      delete container.dataset.editing;
      await onSaved?.(value);
    } catch (err) {
      editor.querySelector('[data-msg]').textContent = err.message;
      for (const el of editor.querySelectorAll('select, button')) el.disabled = false;
    }
  };

  editor.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    e.stopPropagation();
    if (act === 'cancel') close(); else save();
  });
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Enter') { e.preventDefault(); save(); }
  });
  editor.addEventListener('dblclick', (e) => e.stopPropagation());
}

/** Simple confirmation modal. Resolves true when confirmed. */
export function confirmModal({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title">${escapeHtml(title)}</h3>
        <p>${escapeHtml(body)}</p>
        <div class="modal-actions">
          <button class="btn" data-act="cancel">Cancel</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    const done = (v) => { backdrop.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) return done(false);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) done(act === 'ok');
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-act="ok"]').focus();
  });
}

export async function loadHeaderStats() {
  try {
    const me = await api('/api/me');
    const el = document.getElementById('header-stats');
    if (el) el.innerHTML = `<span>Solved <b>${me.counts.solved}</b> / ${me.counts.total}</span><span>In progress <b>${me.counts.tried}</b></span><span>Revealed <b>${me.counts.revealed}</b></span><span>Game master: <b>Claude</b> (${escapeHtml(me.model)})</span><span>Player <b>#${escapeHtml(me.userId)}</b></span>`;
    return me;
  } catch { return null; }
}

/** Inline SVG icons (16px, stroke = currentColor). Keys: play, resume, review, reset, trash, plus. */
const ICON_PATHS = {
  play: '<path d="M6 4.5v11a.6.6 0 0 0 .9.5l8.6-5.5a.6.6 0 0 0 0-1L6.9 4a.6.6 0 0 0-.9.5z" fill="currentColor" stroke="none"/>',
  resume: '<path d="M4 10h9"/><path d="M9 6l4 4-4 4"/><path d="M16 4v12"/>',
  review: '<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="10" cy="10" r="2.5"/>',
  reset: '<path d="M4 10a6 6 0 1 0 1.8-4.3"/><path d="M4 3v3.5h3.5"/>',
  trash: '<path d="M4 6h12"/><path d="M8 6V4h4v2"/><path d="M6 6l.8 10h6.4L14 6"/><path d="M8.5 9v4.5M11.5 9v4.5"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  help: '<circle cx="10" cy="10" r="7.5"/><path d="M7.7 8.2a2.3 2.3 0 1 1 3.3 2.1c-.7.4-1 .8-1 1.6"/><circle cx="10" cy="14.4" r=".7" fill="currentColor" stroke="none"/>',
  close: '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke-width="2.4"/>',
  download: '<path d="M10 3v9"/><path d="M6.5 8.5L10 12l3.5-3.5"/><path d="M4 14.5v1.5h12v-1.5"/>',
  upload: '<path d="M10 12V3"/><path d="M6.5 6.5L10 3l3.5 3.5"/><path d="M4 14.5v1.5h12v-1.5"/>',
};

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}

/** An icon-only button (or link when `href` is given) with an accessible label and tooltip. */
export function iconButton({ name, label, href, cls = '', attrs = '', disabled = false }) {
  const a = `class="btn icon-btn ${cls}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" ${attrs}`;
  if (href) return `<a ${a} href="${escapeHtml(href)}">${icon(name)}</a>`;
  return `<button type="button" ${a} ${disabled ? 'disabled' : ''}>${icon(name)}</button>`;
}
