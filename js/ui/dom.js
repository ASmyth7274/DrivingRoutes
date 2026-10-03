// Small DOM helpers, UI icons, toasts and bottom-sheet dialogs.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const P = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  chev: '<path d="M9 18l6-6-6-6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  play: '<path d="M6 4l14 8-14 8z" fill="currentColor"/>',
  pause: '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>',
  sim: '<path d="M5 17h14M7 17l1.5-5h7L17 17"/><circle cx="8" cy="18.5" r="1.5"/><circle cx="16" cy="18.5" r="1.5"/><path d="M12 3v5M9.5 5.5L12 8l2.5-2.5"/>',
  volume: '<path d="M11 5L6 9H2v6h4l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5L6 9H2v6h4l5 4z" fill="currentColor"/><path d="M23 9l-6 6M17 9l6 6"/>',
  overview: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4" fill="currentColor"/>',
  shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.9 17.9A10 10 0 0 1 12 20c-7 0-11-8-11-8a18 18 0 0 1 5.1-5.9M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2M1 1l22 22"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  wrong: '<path d="M4 20V10a4 4 0 0 1 4-4h12"/><path d="M16 2l4 4-4 4"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  test: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
};

export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

let toastTimer = null;
export function toast(msg, { ms = 3200, top = false } = {}) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('top', top);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/**
 * Bottom-sheet dialog. buttons: [{ label, value, kind }]. Resolves to the
 * chosen value (or null if dismissed by tapping outside).
 */
export function choose({ title, message = '', buttons = [], html = '' }) {
  return new Promise((resolve) => {
    const root = $('#overlay');
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h3>${esc(title)}</h3>
        ${message ? `<p>${esc(message)}</p>` : ''}
        ${html}
        <div class="btns">
          ${buttons.map((b, i) => `<button class="btn block ${b.kind || 'secondary'}" data-i="${i}">${esc(b.label)}</button>`).join('')}
        </div>
      </div>`;
    const done = (v) => {
      back.remove();
      resolve(v);
    };
    back.addEventListener('click', (e) => {
      if (e.target === back) done(null);
      const b = e.target.closest('[data-i]');
      if (b) done(buttons[Number(b.dataset.i)].value);
    });
    root.appendChild(back);
  });
}

export async function confirmDialog(title, message, okLabel = 'OK', kind = 'primary') {
  const v = await choose({ title, message, buttons: [{ label: okLabel, value: true, kind }, { label: 'Cancel', value: false }] });
  return v === true;
}

export function promptDialog(title, { value = '', placeholder = '', okLabel = 'Save', message = '' } = {}) {
  return new Promise((resolve) => {
    const root = $('#overlay');
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <form class="modal">
        <h3>${esc(title)}</h3>
        ${message ? `<p>${esc(message)}</p>` : ''}
        <div class="field" style="margin:0 0 14px"><input name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"></div>
        <div class="btns">
          <button class="btn primary block" type="submit">${esc(okLabel)}</button>
          <button class="btn secondary block" type="button" data-cancel>Cancel</button>
        </div>
      </form>`;
    const form = back.querySelector('form');
    const input = back.querySelector('input');
    const done = (v) => { back.remove(); resolve(v); };
    form.addEventListener('submit', (e) => { e.preventDefault(); done(input.value.trim() || null); });
    back.querySelector('[data-cancel]').addEventListener('click', () => done(null));
    back.addEventListener('click', (e) => { if (e.target === back) done(null); });
    root.appendChild(back);
    setTimeout(() => input.focus(), 50);
  });
}

/** Save a text file (shares on iOS where downloads are awkward). */
export async function saveTextFile(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  try {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function pickTextFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      resolve(f ? await f.text() : null);
    });
    input.click();
  });
}

export const ROUTE_COLOURS = ['#1a6ff0', '#e8453c', '#13a36b', '#9b51e0', '#f08c00', '#0f9fb5', '#d6336c', '#5c7cfa', '#2b8a3e', '#c2255c'];
