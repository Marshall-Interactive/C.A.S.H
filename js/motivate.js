// Little motivators: a no-spend streak, and a nudge at the start of the
// month to sweep last month's leftovers into a savings pot.
import * as S from './store.js';
import { esc, money, toISO, addDays, fromISO, periodOf, shiftPeriod, currentPeriodKey } from './util.js';
import { txInPeriod, totals } from './calc.js';

// Which categories count for the streak (shared between you both).
export function streakCats() {
  const set = S.settings().noSpendCats;
  if (set?.length) return set.filter(id => S.byId('categories', id));
  return ['eatingout', 'alcohol'].filter(id => S.byId('categories', id));
}

// Days in a row (up to today) with nothing spent in those categories, plus the best run.
export function noSpendStreak(cats = streakCats()) {
  const ids = new Set(cats);
  const spentDays = new Set();
  let first = null;
  for (const t of S.list('transactions')) {
    if (!first || t.date < first) first = t.date;
    if (t.type !== 'out') continue;
    const hit = t.splits?.length > 1 ? t.splits.some(s => ids.has(s.categoryId)) : ids.has(t.categoryId);
    if (hit) spentDays.add(t.date);
  }
  const today = new Date(new Date().toDateString());
  const start = first ? fromISO(first) : today;
  let current = 0, best = 0, run = 0, stillCurrent = true;
  const days = [];
  for (let d = today; d >= start; d = addDays(d, -1)) {
    const spent = spentDays.has(toISO(d));
    if (days.length < 14) days.push({ iso: toISO(d), spent });
    if (spent) { stillCurrent = false; best = Math.max(best, run); run = 0; }
    else { run++; if (stillCurrent) current = run; }
    if ((today - d) / 864e5 > 400) break;
  }
  best = Math.max(best, run, current);
  return { current, best, days: days.reverse(), cats };
}

export function streakCard() {
  const cats = streakCats();
  if (!cats.length) return '';
  const s = noSpendStreak(cats);
  const names = cats.map(id => S.cat(id).name).join(' or ');
  const fire = s.current >= 7 ? '🔥🔥' : s.current >= 1 ? '🔥' : '💧';
  return `<section class="card streak-card">
    <h2>No-spend streak <button class="link" data-action="streakCats">Change</button></h2>
    <div class="streak-main"><span class="streak-fire">${fire}</span>
      <div><b class="streak-n">${s.current} day${s.current === 1 ? '' : 's'}</b><small>without ${esc(names)}${s.best > s.current ? ` · best ${s.best} days` : s.current > 1 ? ' · your best yet!' : ''}</small></div></div>
    <div class="streak-days" aria-label="Last 14 days">${s.days.map(d => `<i class="${d.spent ? 'spent' : 'clear'}" title="${esc(d.iso)}"></i>`).join('')}</div>
  </section>`;
}

// First 10 days of a month, if last month had money left over: offer to put some in a pot.
export function sweepCard() {
  const cur = periodOf(currentPeriodKey());
  if ((new Date() - cur.start) / 864e5 > 10 || !S.list('pots').length) return '';
  const last = shiftPeriod(cur.key, -1);
  let done = '';
  try { done = localStorage.getItem('cash.swept') || ''; } catch {}
  if (done === last) return '';
  const t = totals(txInPeriod(periodOf(last)));
  const left = Math.floor(t.in - t.out);
  if (left < 20) return '';
  const name = periodOf(last).start.toLocaleDateString('en-AU', { month: 'long' });
  return `<section class="card sweep-card">
    <div class="sweep-ic">🧹</div>
    <div><b>${esc(name)} finished with ${money(left, { whole: true })} left over</b>
      <p class="small">Sweep some into a savings pot before it disappears?</p>
      <div class="btn-row"><button class="btn primary sm" data-action="sweep" data-key="${last}" data-amount="${left}">Move to a pot</button><button class="btn ghost sm" data-action="sweepSkip" data-key="${last}">Not this time</button></div></div>
  </section>`;
}
