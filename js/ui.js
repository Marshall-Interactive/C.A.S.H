// Shared UI bits: icons, bottom sheets, toasts, chart tooltips.
import { $, esc } from './util.js';
import { currentPeriodKey } from './util.js';

// Screen state that is not saved (which month you're looking at, filters).
export const view = {
  period: null,
  planTab: 'budget',
  pieMode: (() => { try { return localStorage.getItem('cash.pieMode') || 'income'; } catch { return 'income'; } })(),
  pieGroup: null,
  filters: { type: 'all', q: '', categoryId: '', member: '' },
};
export const resetPeriod = () => { view.period = currentPeriodKey(); };

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  plan: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15.5 3.7A9 9 0 0 1 20.3 8.5h-4.8z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  pen: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
  coins: '<circle cx="9" cy="9" r="6"/><path d="M15.5 9.2A6 6 0 1 1 9.2 15.5"/>',
  bill: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 9M22 21a7 7 0 0 0-4-6.3"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M21 4v5h-5M3 20v-5h5"/>',
};
export const icon = (name, size = 22) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

// ---- bottom sheet (full-screen-ish on phones, dialog on laptops) ----
// Android's back button closes an open sheet instead of leaving the screen.
let cleanup = null;
let ignorePop = false, repushAfterPop = false;

export function sheetHead(title, sub = '') {
  return `<div class="sheet-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
    <button type="button" class="icon-btn" data-action="closeSheet" aria-label="Close">${icon('x')}</button></div>`;
}

export function openSheet(html, { onMount, wide = false } = {}) {
  cleanup?.(); cleanup = null;
  const wrap = $('#sheet-wrap'), sheet = $('#sheet');
  sheet.className = 'sheet' + (wide ? ' wide' : '');
  sheet.innerHTML = html;
  sheet.scrollTop = 0;
  const wasHidden = wrap.hidden;
  wrap.hidden = false;
  requestAnimationFrame(() => wrap.classList.add('open'));
  document.body.classList.add('no-scroll');
  if (ignorePop) repushAfterPop = true;
  else if (wasHidden && !history.state?.sheet) history.pushState({ sheet: true }, '');
  const r = onMount?.(sheet);
  if (typeof r === 'function') cleanup = r;
  const af = sheet.querySelector('[autofocus]');
  if (af && matchMedia('(min-width: 700px)').matches) af.focus();
}

export function closeSheet({ fromPop = false } = {}) {
  const wrap = $('#sheet-wrap');
  if (wrap.hidden) return;
  cleanup?.(); cleanup = null;
  wrap.classList.remove('open');
  document.body.classList.remove('no-scroll');
  setTimeout(() => { if (!wrap.classList.contains('open')) { wrap.hidden = true; $('#sheet').innerHTML = ''; } }, 220);
  if (!fromPop && history.state?.sheet) { ignorePop = true; history.back(); }
}

window.addEventListener('popstate', () => {
  if (ignorePop) {
    ignorePop = false;
    if (repushAfterPop) { repushAfterPop = false; history.pushState({ sheet: true }, ''); }
    return;
  }
  if (!$('#sheet-wrap').hidden) closeSheet({ fromPop: true });
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

// ---- toast ----
let toastTimer;
export function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { t.classList.remove('show'); action.fn(); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2600);
}

// ---------- celebrations ----------
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const buzz = pattern => { try { if (!calm()) navigator.vibrate?.(pattern); } catch {} };

export function confetti({ count = 80, colors = ['#1baf7a', '#f2b33d'] } = {}) {
  if (calm()) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  const dpr = devicePixelRatio || 1, w = innerWidth, h = innerHeight;
  c.width = w * dpr; c.height = h * dpr;
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const bits = Array.from({ length: count }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.3, y: h * 0.42,
    vx: (Math.random() - 0.5) * 13, vy: -6 - Math.random() * 10,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
    s: 6 + Math.random() * 7, color: colors[Math.floor(Math.random() * colors.length)], coin: Math.random() < 0.18,
  }));
  const t0 = performance.now(), life = 2300;
  (function frame(t) {
    const k = (t - t0) / life;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1;
    for (const b of bits) {
      b.vy += 0.32; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.color;
      if (b.coin) { ctx.beginPath(); ctx.ellipse(0, 0, b.s * 0.6, b.s * 0.6 * Math.abs(Math.cos(b.r * 2)) + 1, 0, 0, Math.PI * 2); ctx.fillStyle = '#f2b33d'; ctx.fill(); }
      else ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
      ctx.restore();
    }
    if (k < 1) requestAnimationFrame(frame); else c.remove();
  })(t0);
}

// Numbers marked data-count="1234.5" count up from where they were last time.
const shown = {};
export function countUp(root = document) {
  for (const el of root.querySelectorAll('[data-count]')) {
    const to = +el.dataset.count, key = el.dataset.countKey || 'total';
    const from = shown[key] ?? 0;
    shown[key] = to;
    if (calm() || Math.abs(to - from) < 0.01) continue;
    const fmt = el.textContent.replace(/[\d.,\s]/g, '').replace('−', '') ;
    const t0 = performance.now(), dur = 1100;
    const nf = new Intl.NumberFormat(document.documentElement.lang || 'en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    (function tick(t) {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt + nf.format(from + (to - from) * e);
      if (k < 1 && el.isConnected) requestAnimationFrame(tick);
    })(t0);
  }
}

// ---- chart tooltips: any element with data-tip="Label|Value" ----
function showTip(el, e) {
  const tip = $('#tip');
  const [label, value] = el.dataset.tip.split('|');
  tip.innerHTML = `<b>${esc(value ?? '')}</b> ${esc(label)}`;
  tip.hidden = false;
  moveTip(e);
}
function moveTip(e) {
  const tip = $('#tip');
  if (tip.hidden) return;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 12, y = e.clientY - h - 12;
  if (x + w > innerWidth - 8) x = e.clientX - w - 12;
  if (y < 8) y = e.clientY + 16;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = y + 'px';
}
document.addEventListener('pointerover', e => {
  const el = e.target.closest?.('[data-tip]');
  if (el) showTip(el, e); else $('#tip').hidden = true;
});
document.addEventListener('pointermove', moveTip);
document.addEventListener('scroll', () => { $('#tip').hidden = true; }, true);
