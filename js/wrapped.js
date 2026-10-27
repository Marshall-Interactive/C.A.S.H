// "Month wrapped": a story-style recap of a month — tap through slides of
// what came in, what went out, the biggest category, the favourite shop,
// what was saved and what was left over.
import * as S from './store.js';
import { esc, money, sum, periodOf, shiftPeriod, currentPeriodKey, fromISO } from './util.js';
import { txInPeriod, spendLines, totals } from './calc.js';
import { similarText } from './categorise.js';
import { confetti, countUp } from './ui.js';
import { monthStats, yearMonths, thisYear } from './year.js';

const SEEN = 'cash.wrapped';

// Enough happened that month to be worth a recap?
export const hasRecap = key => txInPeriod(periodOf(key)).length >= 5;

// First open in a new month: show last month's recap once per device.
export function maybeShowWrapped() {
  const last = shiftPeriod(currentPeriodKey(), -1);
  let seen = '';
  try { seen = localStorage.getItem(SEEN) || ''; } catch {}
  if (seen >= last || !hasRecap(last)) return;
  try { localStorage.setItem(SEEN, last); } catch {}
  setTimeout(() => showWrapped(last), 900);
}

function slidesFor(key) {
  const p = periodOf(key), name = p.start.toLocaleDateString('en-AU', { month: 'long' });
  const txs = txInPeriod(p);
  const s = monthStats(key), before = monthStats(shiftPeriod(key, -1));
  const t = totals(txs);
  const pays = txs.filter(x => x.type === 'in' && x.categoryId === 'wages').length;
  const n = (v, k) => `<b class="w-big" data-count="${Math.round(v)}" data-count-key="w-${k}" data-count-from="0" data-count-dp="0">${money(v, { whole: true })}</b>`;

  // biggest everyday category (regular bills like the mortgage would win every month)
  const billCats = new Set(S.list('bills').filter(b => b.active !== false).map(b => b.categoryId));
  const savingsAreas = new Set(S.groups().filter(g => g.savings).map(g => g.id));
  const byCat = {};
  for (const l of spendLines(txs)) {
    if (billCats.has(l.categoryId) || l.tx.billId || savingsAreas.has(S.cat(l.categoryId).group)) continue;
    byCat[l.categoryId] = (byCat[l.categoryId] || 0) + l.amount;
  }
  const [topCat, topCatV] = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0] || [];
  // favourite shop: the name that turns up most often
  const shops = {};
  for (const x of txs.filter(x => x.type === 'out' && !S.isTransfer(x.categoryId) && x.source !== 'bill' && !x.billId)) {
    const k = similarText(x.desc);
    if (!k) continue;
    (shops[k.toLowerCase()] ||= { name: k, n: 0, v: 0 });
    shops[k.toLowerCase()].n++; shops[k.toLowerCase()].v += x.amount;
  }
  const shop = Object.values(shops).sort((a, b) => b.n - a.n || b.v - a.v)[0];
  // who spent
  const members = S.settings().members;
  const byWho = members.map(m => ({ m, v: sum(txs.filter(x => x.type === 'out' && !S.isTransfer(x.categoryId) && x.member === m), x => x.amount) })).filter(x => x.v > 0);
  const whoMax = Math.max(...byWho.map(x => x.v), 1);
  // best month this year?
  const yr = yearMonths(thisYear('cal'), 'cal').filter(k => k <= key && k < currentPeriodKey()).map(k => ({ k, net: monthStats(k).net }));
  const best = yr.length > 1 && yr.every(x => x.k === key || x.net <= s.net) && s.net > 0;
  // pots
  const potIn = sum(S.list('pots').flatMap(pt => pt.entries || []).filter(e => { const d = fromISO(e.date); return d >= p.start && d < p.end && e.amount > 0; }), e => e.amount);

  const change = before.out ? Math.round(((s.out - before.out) / before.out) * 100) : null;
  const slides = [
    { cls: 'w-intro', html: `<span class="w-emoji">🎁</span><h2>Your ${esc(name)},<br>wrapped</h2><p>Here's how the family did. Tap to keep going →</p>` },
    { cls: 'w-in', html: `<p class="w-k">Money that came in</p>${n(s.in, 'in')}<p>${pays ? `from ${pays} pay${pays === 1 ? '' : 's'}` : ''}${s.in - sum(txs.filter(x => x.type === 'in' && x.categoryId === 'wages'), x => x.amount) > 1 ? ' plus a little extra' : ''} 💵</p>` },
    { cls: 'w-out', html: `<p class="w-k">You spent</p>${n(s.spent, 'out')}<p>${change == null ? `across ${t.count} payments` : change <= 0 ? `That's <b>${Math.abs(change)}% less</b> than the month before 🙌` : `That's ${change}% more than the month before`}</p>` },
    topCat && { cls: 'w-cat', html: `<p class="w-k">Your biggest everyday spend</p><span class="w-emoji">${S.cat(topCat).icon}</span><h2>${esc(S.cat(topCat).name)}</h2>${n(topCatV, 'cat')}<p>${Math.round((topCatV / sum(Object.values(byCat), v => v)) * 100)}% of your everyday spending</p>` },
    shop && shop.n >= 2 && { cls: 'w-shop', html: `<p class="w-k">Your favourite place</p><h2>${esc(shop.name)}</h2><p class="w-mid"><b>${shop.n}</b> visits</p>${n(shop.v, 'shop')}` },
    byWho.length > 1 && { cls: 'w-who', html: `<p class="w-k">Who spent what</p><div class="w-bars">${byWho.map(x => `<div class="w-bar"><span>${esc(x.m)}</span><i style="--w:${(x.v / whoMax) * 100}%;background:${S.memberColor(x.m)}"></i><b>${money(x.v, { whole: true })}</b></div>`).join('')}</div>` },
    { cls: 'w-saved', party: s.saved + potIn > 0, html: `<p class="w-k">Put away for later</p>${n(Math.max(s.saved, potIn), 'saved')}<p>${s.saved + potIn > 0 ? 'Future you says thanks 🐷' : 'Nothing saved this time — next month!'}</p>` },
    { cls: s.net >= 0 ? 'w-left up' : 'w-left down', party: s.net > 0, html: `<p class="w-k">${s.net >= 0 ? 'Left over' : 'Overspent by'}</p>${n(Math.abs(s.net), 'net')}${best ? '<p class="w-badge">🏆 Best month of the year so far!</p>' : ''}<p>${s.net >= 0 ? 'Nice work, team.' : "It happens — let's win it back."}</p>` },
    { cls: 'w-end', html: `<span class="w-emoji">💪</span><h2>Onwards to ${esc(periodOf(shiftPeriod(key, 1)).start.toLocaleDateString('en-AU', { month: 'long' }))}</h2><button class="btn primary big" data-w="close">Let's go</button>` },
  ].filter(Boolean);
  return slides;
}

export function showWrapped(key = shiftPeriod(currentPeriodKey(), -1)) {
  document.querySelector('.wrapped')?.remove();
  const slides = slidesFor(key);
  const el = document.createElement('div');
  el.className = 'wrapped';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Month recap');
  el.innerHTML = `<div class="w-progress">${slides.map(() => '<i></i>').join('')}</div>
    <button class="w-close" data-w="close" aria-label="Close">✕</button>
    ${slides.map((s, i) => `<section class="w-slide ${s.cls}" data-i="${i}">${s.html}</section>`).join('')}`;
  document.body.appendChild(el);
  document.body.classList.add('no-scroll');
  let at = -1;
  const go = i => {
    if (i < 0) return;
    if (i >= slides.length) return close();
    at = i;
    el.querySelectorAll('.w-slide').forEach((s, j) => s.classList.toggle('on', j === i));
    el.querySelectorAll('.w-progress i').forEach((b, j) => b.classList.toggle('done', j <= i));
    const slide = el.querySelector(`.w-slide[data-i="${i}"]`);
    countUp(slide);
    if (slides[i].party) setTimeout(() => confetti({ count: 120 }), 250);
  };
  const close = () => { el.classList.add('out'); document.body.classList.remove('no-scroll'); setTimeout(() => el.remove(), 250); document.removeEventListener('keydown', key2); };
  const key2 = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight' || e.key === ' ') go(at + 1); if (e.key === 'ArrowLeft') go(at - 1); };
  document.addEventListener('keydown', key2);
  el.addEventListener('click', e => {
    if (e.target.closest('[data-w=close]')) return close();
    go(e.clientX < innerWidth * 0.3 ? at - 1 : at + 1);
  });
  go(0);
}
