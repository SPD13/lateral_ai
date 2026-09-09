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

export function badge(kind, text) {
  return `<span class="badge ${escapeHtml(kind)}">${escapeHtml(text || kind)}</span>`;
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
