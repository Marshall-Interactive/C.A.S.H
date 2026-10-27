// The Year tab: what came in, went out and was saved across a year, a
// calendar of months (or weeks) coloured by whether money was left over,
// and an outlook for the months still to come.
import * as S from './store.js';
import { esc, money, sum, periodOf, shiftPeriod, currentPeriodKey, toISO, addDays, fmtDate } from './util.js';
import { txInPeriod, spendLines, totals, expectedIn } from './calc.js';
import { inOutBars } from './charts.js';
import { view } from './ui.js';

const saved = (key, k) => { try { return localStorage.getItem(key) || k; } catch { return k; } };
view.yearKind ||= saved('cash.yearKind', 'cal');   // calendar year or Australian financial year
view.yearView ||= saved('cash.yearView', 'month'); // month tiles or week tiles

// The year that holds today, in the chosen kind.
export function thisYear(kind = view.yearKind) {
  const [y, m] = currentPeriodKey().split('-').map(Number);
  return kind === 'fy' && m >= 7 ? y + 1 : y;
}
// Month keys in a year: Jan–Dec, or Jul–Jun for a financial year ("FY2027" = Jul 2026 – Jun 2027).
export function yearMonths(y = view.year ?? thisYear(), kind = view.yearKind) {
  const first = kind === 'fy' ? `${y - 1}-07` : `${y}-01`;
  return Array.from({ length: 12 }, (_, i) => shiftPeriod(first, i));
}
export const yearLabel = (y, kind = view.yearKind) => (kind === 'fy' ? `FY ${y - 1}–${String(y).slice(2)}` : String(y));

// In, out and saved (spending in savings areas) for a set of payments.
function stats(txs) {
  const t = totals(txs);
  const savingsAreas = new Set(S.groups().filter(g => g.savings).map(g => g.id));
  const save = sum(spendLines(txs).filter(l => savingsAreas.has(S.byId('categories', l.categoryId) ? S.cat(l.categoryId).group : 'other')), l => l.amount);
  return { in: t.in, out: t.out, saved: save, spent: t.out - save, net: t.in - t.out };
}

export function monthStats(key) {
  return stats(txInPeriod(periodOf(key)));
}

// What a future month will probably look like: the wages you expect, and
// spending like the last three full months (or your budget if there's no history yet).
function forecastOut(nowKey) {
  const past = [1, 2, 3].map(k => monthStats(shiftPeriod(nowKey, -k))).filter(s => s.out > 0);
  if (past.length) return { out: sum(past, s => s.out) / past.length, saved: sum(past, s => s.saved) / past.length };
  const cats = S.list('categories').filter(c => (c.type || 'out') === 'out');
  const savingsAreas = new Set(S.groups().filter(g => g.savings).map(g => g.id));
  return { out: sum(cats, c => +c.budget || 0), saved: sum(cats.filter(c => savingsAreas.has(c.group)), c => +c.budget || 0) };
}

export function yearData(y = view.year ?? thisYear(), kind = view.yearKind) {
  const nowKey = currentPeriodKey();
  const fc = forecastOut(nowKey);
  const months = yearMonths(y, kind).map(key => {
    const p = periodOf(key);
    const when = key < nowKey ? 'past' : key === nowKey ? 'now' : 'future';
    const actual = when === 'future' ? { in: 0, out: 0, saved: 0, spent: 0, net: 0 } : monthStats(key);
    // forecast: future months fully, this month for what's still to come
    let f = actual;
    if (when !== 'past') {
      const inn = Math.max(actual.in, expectedIn(p));
      const out = Math.max(actual.out, fc.out), sv = Math.max(actual.saved, fc.saved);
      f = { in: inn, out, saved: sv, spent: out - sv, net: inn - out };
    }
    return { key, p, when, actual, forecast: f };
  });
  const sumOf = (list, k) => sum(list, m => m[k]);
  const sofar = months.filter(m => m.when !== 'future').map(m => m.actual);
  const outlook = months.map(m => m.forecast);
  return {
    months,
    sofar: { in: sumOf(sofar, 'in'), out: sumOf(sofar, 'out'), saved: sumOf(sofar, 'saved'), spent: sumOf(sofar, 'spent'), net: sumOf(sofar, 'net') },
    outlook: { in: sumOf(outlook, 'in'), out: sumOf(outlook, 'out'), saved: sumOf(outlook, 'saved'), net: sumOf(outlook, 'net') },
    hasFuture: months.some(m => m.when !== 'past'),
    hasPast: months.some(m => m.when !== 'future'),
  };
}

// Tint a tile green or red, stronger for bigger amounts.
function tint(net, scale) {
  if (!scale || Math.abs(net) < 0.5) return '';
  const pct = Math.round(10 + Math.min(1, Math.abs(net) / scale) * 32);
  return `style="--tint:color-mix(in srgb, var(${net >= 0 ? '--good' : '--bad'}) ${pct}%, var(--surface))"`;
}
const netText = net => (net >= 0 ? `+${money(net, { whole: true })}` : `−${money(-net, { whole: true })}`);

function monthTiles(d) {
  const scale = Math.max(...d.months.map(m => Math.abs((m.when === 'future' ? m.forecast : m.actual).net)), 1);
  return `<div class="cal-months">${d.months.map(m => {
    const s = m.when === 'future' ? m.forecast : m.actual;
    const name = m.p.start.toLocaleDateString('en-AU', { month: 'short' });
    const empty = m.when !== 'future' && !s.in && !s.out;
    return `<button class="cal-tile ${m.when} ${s.net >= 0 ? 'up' : 'down'}" data-action="openMonth" data-key="${m.key}" ${empty ? '' : tint(s.net, scale)}>
      <span class="cal-name">${name}${m.when === 'now' ? ' <i>now</i>' : ''}</span>
      <b class="cal-net">${empty ? '—' : netText(s.net)}</b>
      <small>${empty ? 'Nothing yet' : m.when === 'future' ? 'forecast' : s.net >= 0 ? 'left over' : 'overspent'}</small>
      ${empty ? '' : `<span class="cal-io"><span class="pos">↓${money(s.in, { whole: true })}</span><span>↑${money(s.out, { whole: true })}</span></span>`}
    </button>`;
  }).join('')}</div>`;
}

// Weeks run Monday–Sunday across the year's range.
function weekTiles(d) {
  const start = d.months[0].p.start, end = d.months[11].p.end;
  let w = addDays(start, -((start.getDay() + 6) % 7));
  const txs = S.list('transactions').filter(t => t.date >= toISO(w) && t.date < toISO(end));
  const today = new Date();
  const weeks = [];
  while (w < end) {
    const e = addDays(w, 7), a = toISO(w), b = toISO(e);
    const s = stats(txs.filter(t => t.date >= a && t.date < b));
    weeks.push({ w, e, s, when: e <= today ? 'past' : w <= today ? 'now' : 'future' });
    w = e;
  }
  const scale = Math.max(...weeks.map(x => Math.abs(x.s.net)), 1);
  let html = '', month = -1;
  for (const x of weeks) {
    const mid = addDays(x.w, 3);
    if (mid.getMonth() !== month) {
      if (month !== -1) html += '</div>';
      month = mid.getMonth();
      html += `<div class="cal-week-head">${mid.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</div><div class="cal-weeks">`;
    }
    const empty = !x.s.in && !x.s.out;
    html += `<button class="cal-tile wk ${x.when} ${x.s.net >= 0 ? 'up' : 'down'}" data-action="openMonth" data-key="${toISO(mid).slice(0, 7)}" ${empty || x.when === 'future' ? '' : tint(x.s.net, scale)}
      title="${fmtDate(toISO(x.w), { day: 'numeric', month: 'short' })} – ${fmtDate(toISO(addDays(x.e, -1)), { day: 'numeric', month: 'short' })}">
      <span class="cal-name">${x.w.getDate()}–${addDays(x.e, -1).getDate()}${x.when === 'now' ? ' <i>now</i>' : ''}</span>
      <b class="cal-net">${empty ? '—' : netText(x.s.net)}</b>
      ${empty ? '' : `<span class="cal-io"><span class="pos">↓${money(x.s.in, { whole: true })}</span><span>↑${money(x.s.out, { whole: true })}</span></span>`}
    </button>`;
  }
  return html + '</div>';
}

export function yearTab() {
  const y = view.year ?? thisYear();
  const d = yearData(y);
  const so = d.sofar, ol = d.outlook;
  const num = (v, key) => `<b data-count="${Math.round(v)}" data-count-key="yr-${key}" data-count-dp="0">${money(v, { whole: true })}</b>`;
  const seg = (name, val, opts, change) => `<div class="seg small" role="radiogroup">${opts.map(([v, l]) =>
    `<label><input type="radio" name="${name}" value="${v}" ${val === v ? 'checked' : ''} data-change="${change}"><span>${l}</span></label>`).join('')}</div>`;
  const rows = d.months.map(m => ({ label: m.p.start.toLocaleDateString('en-AU', { month: 'narrow' }), in: (m.when === 'future' ? m.forecast : m.actual).in, out: (m.when === 'future' ? m.forecast : m.actual).out, forecast: m.when === 'future' }));
  return `<div class="grid">
    <section class="card year-hero">
      <div class="year-switch">
        <button class="icon-btn" data-action="prevYear" aria-label="Previous year">‹</button>
        <button class="year-label" data-action="thisYear" title="Back to this year">${esc(yearLabel(y))}</button>
        <button class="icon-btn" data-action="nextYear" aria-label="Next year">›</button>
        ${seg('yearKind', view.yearKind, [['cal', 'Jan–Dec'], ['fy', 'Financial year']], 'yearKind')}
      </div>
      ${d.hasPast ? `<span class="label">${d.hasFuture ? 'So far this year' : 'The whole year'}</span>
      <div class="year-stats">
        <div><small>💵 Came in</small>${num(so.in, 'in')}</div>
        <div><small>🛒 Spent</small>${num(so.spent, 'spent')}</div>
        <div><small>🐷 Saved</small>${num(so.saved, 'saved')}</div>
        <div class="${so.net >= 0 ? 'up' : 'down'}"><small>${so.net >= 0 ? '✅ Left over' : '⚠ Overspent'}</small>${num(Math.abs(so.net), 'net')}</div>
      </div>` : '<p class="muted">This year hasn\'t started yet — here\'s the outlook.</p>'}
      ${d.hasFuture ? `<div class="outlook ${ol.net >= 0 ? 'up' : 'down'}">
        <span>🔭 <b>Outlook for ${esc(yearLabel(y))}:</b> ${money(ol.in, { whole: true })} in, ${money(ol.out, { whole: true })} out${ol.saved ? ` (incl. ${money(ol.saved, { whole: true })} saved)` : ''}</span>
        <b>${ol.net >= 0 ? `On track to have ${money(ol.net, { whole: true })} left over` : `Heading for ${money(-ol.net, { whole: true })} overspent`}</b>
        <small class="muted">Future months use your expected wages and your average spending over the last 3 months.</small>
      </div>` : ''}
    </section>
    <section class="card">
      <h2>Month by month</h2>
      <div class="legend inline"><div class="legend-row"><i style="background:var(--s1)"></i><span>Money in</span></div><div class="legend-row"><i style="background:var(--s2)"></i><span>Money out</span></div>${d.hasFuture ? '<div class="legend-row"><i class="faded"></i><span>Forecast</span></div>' : ''}</div>
      <div class="chart">${inOutBars(rows, { h: 190 })}</div>
    </section>
    <section class="card">
      <div class="cal-head"><h2>Calendar</h2>${seg('yearView', view.yearView, [['month', 'Monthly'], ['week', 'Weekly']], 'yearView')}</div>
      <p class="small muted">Green = money left over, red = more went out than came in. Tap one to open it.</p>
      ${view.yearView === 'week' ? weekTiles(d) : monthTiles(d)}
    </section>
  </div>`;
}

// Small card for Home.
export function yearCard() {
  const y = thisYear();
  const d = yearData(y);
  return `<section class="card">
    <h2>This year <a href="#plan/year">See the year</a></h2>
    <div class="year-mini">
      <div><small>Came in</small><b class="pos">${money(d.sofar.in, { whole: true })}</b></div>
      <div><small>Went out</small><b>${money(d.sofar.out, { whole: true })}</b></div>
      <div><small>${d.sofar.net >= 0 ? 'Left over' : 'Overspent'}</small><b class="${d.sofar.net >= 0 ? 'pos' : 'neg'}">${money(Math.abs(d.sofar.net), { whole: true })}</b></div>
    </div>
    <p class="small muted">${d.outlook.net >= 0 ? `🔭 On track for ${money(d.outlook.net, { whole: true })} left over by the end of ${esc(yearLabel(y))}` : `🔭 Heading for ${money(-d.outlook.net, { whole: true })} overspent by the end of ${esc(yearLabel(y))}`}</p>
  </section>`;
}
