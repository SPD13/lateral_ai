/* Shared helpers for the game, bank, generate and leaderboard pages. */

/** The player profile chosen on this device. Kept in local storage so it survives a reload. */
export const PROFILE_KEY = 'lg_profile';
export function activeProfileId() { try { return localStorage.getItem(PROFILE_KEY) || ''; } catch { return ''; } }
export function setActiveProfileId(id) { try { id ? localStorage.setItem(PROFILE_KEY, id) : localStorage.removeItem(PROFILE_KEY); } catch { /* storage unavailable */ } }
/** Add the active profile to a URL, for plain links that cannot send a header. */
export function withProfile(url) {
  const id = activeProfileId();
  return id ? `${url}${url.includes('?') ? '&' : '?'}profile=${encodeURIComponent(id)}` : url;
}

export async function api(path, opts = {}) {
  const profile = activeProfileId();
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(profile ? { 'X-Profile-Id': profile } : {}), ...(opts.headers || {}) },
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
    if (el) el.innerHTML = `<span>Solved <b>${me.counts.solved}</b> / ${me.counts.total}</span><span>In progress <b>${me.counts.tried}</b></span><span>Revealed <b>${me.counts.revealed}</b></span><span>Game master: <b>Claude</b> (${escapeHtml(me.model)})</span>`;
    return me;
  } catch { return null; }
}

/**
 * The profile control in the header: the active profile's name, a dropdown when there is more than
 * one profile, and a "+" button that creates another one. Switching profile reloads the page, since
 * everything on it belongs to the profile.
 */
export async function renderProfileBar() {
  const el = document.getElementById('profile-bar');
  if (!el) return null;
  let data;
  try { data = await api('/api/profiles'); } catch { return null; }
  const { profiles } = data;
  // a stored id that no longer exists (another device, a wiped file) falls back to the server's choice
  if (activeProfileId() && !profiles.some((p) => p.id === activeProfileId())) setActiveProfileId('');
  const activeId = activeProfileId() || data.activeId;
  const active = profiles.find((p) => p.id === activeId) || profiles[0];

  const label = profiles.length > 1
    ? `<select id="profile-select" class="btn small" aria-label="Active player profile" title="Switch player profile">${profiles.map((p) => `<option value="${escapeHtml(p.id)}"${p.id === active?.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select>`
    : `<b class="profile-name">${escapeHtml(active ? active.name : 'Player')}</b>`;
  el.innerHTML = `<span class="profile-label">Player</span> ${label} <button type="button" class="btn icon-btn small" id="profile-add" title="Add a player profile" aria-label="Add a player profile">${icon('plus')}</button>`;

  el.querySelector('#profile-select')?.addEventListener('change', (e) => {
    setActiveProfileId(e.target.value);
    location.reload();
  });
  el.querySelector('#profile-add').addEventListener('click', async () => {
    const name = await promptModal({ title: 'Add a player profile', label: 'Profile name', placeholder: 'e.g. Alex', confirmLabel: 'Create profile' });
    if (name === null) return;
    try {
      const { profile } = await api('/api/profiles', { method: 'POST', body: { name } });
      setActiveProfileId(profile.id);
      location.reload();
    } catch (err) { alert(err.message); }
  });
  return { profiles, active };
}

/** Put an icon in front of each header link, and let small screens show only the icon. */
const NAV_ICONS = { '/': 'play', '/bank': 'bank', '/generate': 'sparkle', '/leaderboard': 'trophy' };

export function renderNavIcons() {
  for (const link of document.querySelectorAll('.site-nav a')) {
    if (link.querySelector('svg')) continue;
    const name = NAV_ICONS[new URL(link.href, location.origin).pathname];
    if (!name) continue;
    const text = link.textContent.trim();
    link.title = text;
    link.setAttribute('aria-label', text);
    link.innerHTML = `${icon(name)}<span class="label">${escapeHtml(text)}</span>`;
  }
}

/** Modal with a single text field. Resolves with the trimmed text, or null when cancelled. */
export function promptModal({ title, label = '', value = '', placeholder = '', confirmLabel = 'Save' }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
        <h3 id="prompt-title">${escapeHtml(title)}</h3>
        ${label ? `<label class="prompt-label" for="prompt-input">${escapeHtml(label)}</label>` : ''}
        <input id="prompt-input" class="prompt-input" type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" maxlength="40" autocomplete="off">
        <div class="modal-actions">
          <button type="button" class="btn" data-act="cancel">Cancel</button>
          <button type="submit" class="btn primary">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>`;
    const input = backdrop.querySelector('input');
    const done = (v) => { backdrop.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) done(null);
      if (e.target.closest('[data-act="cancel"]')) done(null);
    });
    backdrop.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (v) done(v);
      else input.focus();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    input.focus();
    input.select();
  });
}

/** Turn a label into a text box with Save and Cancel. `onSaved(text)` runs after a successful save. */
export function editTextInline(container, { value, onSave, maxLength = 40 }) {
  if (container.dataset.editing === '1') return;
  container.dataset.editing = '1';
  const original = container.innerHTML;
  const editor = document.createElement('span');
  editor.className = 'inline-editor';
  editor.innerHTML = `
    <input type="text" class="prompt-input" value="${escapeHtml(value)}" maxlength="${maxLength}" aria-label="New name" autocomplete="off">
    <button type="button" class="btn small primary" data-act="save">Save</button>
    <button type="button" class="btn small" data-act="cancel">Cancel</button>
    <span class="edit-msg" data-msg></span>`;
  container.innerHTML = '';
  container.appendChild(editor);
  const input = editor.querySelector('input');
  input.focus();
  input.select();

  const close = () => { container.innerHTML = original; delete container.dataset.editing; };
  const save = async () => {
    const next = input.value.trim();
    if (!next) return input.focus();
    if (next === value) return close();
    for (const el of editor.querySelectorAll('input, button')) el.disabled = true;
    try { delete container.dataset.editing; await onSave(next); }
    catch (err) {
      container.dataset.editing = '1';
      editor.querySelector('[data-msg]').textContent = err.message;
      for (const el of editor.querySelectorAll('input, button')) el.disabled = false;
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

/**
 * Wire the Export link and the Import button of a page. Export downloads the active profile's
 * progress; Import replaces it after a confirmation, then calls `onImported`.
 */
export function wireProgressIO({ exportEl, importEl, fileEl, onImported }) {
  if (!exportEl || !importEl || !fileEl) return;
  exportEl.href = withProfile('/api/progress/export');
  exportEl.insertAdjacentHTML('afterbegin', icon('download'));
  importEl.insertAdjacentHTML('afterbegin', icon('upload'));

  importEl.addEventListener('click', () => { fileEl.value = ''; fileEl.click(); });
  fileEl.addEventListener('change', async () => {
    const file = fileEl.files[0];
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { alert(`${file.name} is not valid JSON.`); return; }
    const count = data && data.puzzles ? Object.keys(data.puzzles).length : 0;
    const ok = await confirmModal({
      title: `Import progress from "${file.name}"?`,
      body: `This replaces all of the active profile's progress with the ${count} puzzle${count === 1 ? '' : 's'} in the file, including their conversations. Export first if you want to keep what you have.`,
      confirmLabel: 'Replace my progress', danger: true,
    });
    if (!ok) return;
    try {
      const res = await api('/api/progress/import', { method: 'POST', body: data });
      await onImported?.(res);
      alert(`Imported ${res.puzzles} puzzle${res.puzzles === 1 ? '' : 's'} and ${res.messages} message${res.messages === 1 ? '' : 's'}.`);
    } catch (err) { alert(err.message); }
  });
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
  bank: '<circle cx="4.8" cy="5.5" r="1" fill="currentColor" stroke="none"/><circle cx="4.8" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="4.8" cy="14.5" r="1" fill="currentColor" stroke="none"/><path d="M8.3 5.5H16M8.3 10H16M8.3 14.5H16"/>',
  sparkle: '<path d="M8.4 2.8l1.3 3.5 3.5 1.3-3.5 1.3-1.3 3.5-1.3-3.5L3.6 7.6l3.5-1.3z"/><path d="M14.4 11.6l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  next: '<path d="M4.5 5.5L9 10l-4.5 4.5"/><path d="M10.5 5.5L15 10l-4.5 4.5"/>',
  trophy: '<path d="M6.5 3.5h7v4.2a3.5 3.5 0 0 1-7 0z"/><path d="M6.5 4.8H4.1a2.2 2.2 0 0 0 2.4 3.1"/><path d="M13.5 4.8h2.4a2.2 2.2 0 0 1-2.4 3.1"/><path d="M10 11.2v2.4"/><path d="M6.8 16.5h6.4"/><path d="M8.2 13.6h3.6v2.9H8.2z"/>',
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
