// The main screens. Each returns an HTML string for <main>.
import * as S from './store.js';
import { esc, money, sum, periodOf, shiftPeriod, relDay, fmtDate, perMonth, FREQS, fromISO, todayISO, round2, currentPeriodKey, toISO } from './util.js';
import { txInPeriod, spendLines, spentByCategory, totals, billsInPeriod, incomesInPeriod, expectedIn, nextDue, incomeAmount, doneTx } from './calc.js';
import { donut, inOutBars, growthChart } from './charts.js';
import { icon, view, sheetHead } from './ui.js';
import * as Sync from './sync.js';
import { yearTab, yearCard, monthStats } from './year.js';
import { streakCard, sweepCard } from './motivate.js';
import { remindersOn, canNotify } from './reminders.js';
import { cardLines, cardSheetHtml } from './card.js';
import * as Off from './offset.js';

export const TITLES = { home: 'Home', activity: 'Activity', plan: 'Plan', savings: 'Savings', settings: 'Settings' };

export const NAV = [
  ['home', 'Home', 'home'],
  ['activity', 'Activity', 'list'],
  ['plan', 'Plan', 'plan'],
  ['savings', 'Savings', 'target'],
];

export function topbar(route) {
  const showMonth = ['home', 'activity', 'plan'].includes(route) && !(route === 'plan' && view.planTab === 'year');
  const p = periodOf(view.period);
  return `<div class="topbar-inner">
    <a class="brand-sm" href="#home" aria-label="C.A.S.H home"><img src="icons/logo.svg" alt=""></a>
    <div class="tb-title"><h1>${TITLES[route] || ''}</h1><small>${esc(S.settings().householdName)} · ${who(S.settings().currentMember)}</small></div>
    ${showMonth ? `<div class="month-switch" title="${esc(p.range)}">
      <button class="icon-btn" data-action="prevPeriod" aria-label="Previous month">${icon('chevL', 18)}</button>
      <button class="month-label" data-action="thisPeriod" title="Back to this month">${esc(p.short)}</button>
      <button class="icon-btn" data-action="nextPeriod" aria-label="Next month">${icon('chevR', 18)}</button></div>` : ''}
    ${syncDot()}<a class="icon-btn" href="#settings" aria-label="Settings">${icon('gear')}</a>
  </div>`;
}

// ---------- shared pieces ----------
// A person's name with their chosen colour dot.
export const who = name => name
  ? `<span class="who" style="--c:${S.memberColor(name)}"><i></i>${esc(name)}</span>` : '';

export function txRow(t) {
  const c = S.cat(t.categoryId);
  const transfer = c.type === 'transfer';
  const split = t.splits?.length > 1 ? `<span class="badge">split ${t.splits.length}</span>` : '';
  const src = { receipt: 'receipt', screenshot: 'screenshot', csv: 'bank', pdf: 'bank', bill: 'bill', income: 'wage' }[t.source];
  const acc = t.accountId ? S.byId('accounts', t.accountId) : null;
  return `<button class="tx" data-action="editTx" data-id="${t.id}">
    <span class="tx-ic" style="--c:${S.memberColor(t.member)}">${c.icon}</span>
    <span class="tx-main"><b>${esc(t.desc)}</b><small>${who(t.member)} ${esc(c.name)}${split}${acc ? `<span class="badge">${esc(acc.name)}</span>` : src ? `<span class="badge">${src}</span>` : ''}</small></span>
    <span class="tx-amt ${transfer ? 'transfer' : t.type}">${transfer ? '⇄ ' : t.type === 'in' ? '+' : '−'}${money(t.amount)}</span>
  </button>`;
}

function status(spent, budget) {
  if (!budget) return { cls: 'none', text: spent ? money(spent) + ' spent' : 'No budget set' };
  const r = spent / budget;
  if (r > 1) return { cls: 'bad', text: `⚠ ${money(spent - budget)} over` };
  if (r >= 0.8) return { cls: 'warn', text: `● ${money(budget - spent)} left` };
  return { cls: 'good', text: `✓ ${money(budget - spent)} left` };
}

function catRow(c, spent) {
  const st = status(spent, c.budget);
  const pct = c.budget ? Math.min(100, (spent / c.budget) * 100) : 0;
  return `<button class="cat-row" data-action="spendList" data-kind="cat" data-id="${c.id}">
    <span class="tx-ic">${c.icon}</span>
    <span><span class="nm">${esc(c.name)}</span><br><span class="status ${st.cls}">${st.text}</span></span>
    <span class="vals"><b>${money(spent, { whole: true })}</b><br>of ${money(c.budget, { whole: true })}</span>
    <span class="bar"><i class="${st.cls}" style="width:${pct}%"></i></span>
  </button>`;
}

// ---------- accounts (offset + home loan, credit card, main…) ----------
export const KINDS = {
  offset: ['🏦', 'Offset account'], savings: ['💰', 'Savings account'],
  everyday: ['👛', 'Main account'], credit: ['💳', 'Credit card'],
};

// Money you owe shows as a red minus figure, e.g. −$354,358.27
const owed = v => `<span class="neg">${money(-Math.abs(v))}</span>`;
const signed = v => v < 0 ? `<span class="neg">${money(v)}</span>` : money(v);

function accountFacts(a) {
  const set = a.balance != null;
  const hist = a.history || [];
  const last = hist[hist.length - 1];
  const prev = hist.length > 1 ? hist[hist.length - 2] : null;
  const credit = a.kind === 'credit';
  let change = '';
  if (set && prev && prev.balance != null) {
    const diff = a.balance - prev.balance;
    const good = credit ? diff < 0 : diff > 0;
    if (Math.abs(diff) >= 0.01) change = `<span class="${good ? 'pos' : 'neg'}">${diff > 0 ? '▲' : '▼'} ${money(Math.abs(diff))}</span> since ${fmtDate(prev.date)}`;
  }
  // the headline figure and the lines underneath it
  const big = !set ? '—' : credit ? owed(a.balance) : signed(a.balance);
  const label = credit ? 'Amount owing' : a.kind === 'offset' ? 'Offset balance' : 'Balance';
  const lines = [];
  let bar = '';
  if (credit) {
    const avail = a.available ?? (a.limit && set ? a.limit - a.balance : null);
    if (avail != null) lines.push(`<div class="acc-line avail"><span>Available balance</span><b class="pos">${money(avail)}</b></div>`);
    if (a.limit && set) {
      const pct = Math.min(100, (a.balance / a.limit) * 100);
      const cls = pct >= 80 ? 'bad' : pct >= 50 ? 'warn' : 'good';
      lines.push(`<div class="bar"><i class="${cls}" style="width:${pct}%"></i></div>`);
      lines.push(`<p class="small status ${cls}">${cls === 'good' ? '✓' : cls === 'warn' ? '●' : '⚠'} ${Math.round(pct)}% of your ${money(a.limit, { whole: true })} limit used</p>`);
    } else if (!a.limit && a.available == null) lines.push(`<p class="small muted">Tap ${icon('gear', 13)} to add your card limit — then C.A.S.H works out what's available</p>`);
    lines.push(cardLines(a));
  }
  if (a.kind === 'offset') {
    if (a.loanBalance != null) {
      lines.push(`<div class="acc-line"><span>Home loan balance</span><b>${owed(a.loanBalance)}</b></div>`);
      if (set) lines.push(`<div class="acc-line"><span>Owing after offset</span><b>${owed(Math.max(0, a.loanBalance - a.balance))}</b></div>`);
    } else lines.push('<p class="small muted">Tap Update to add your home loan balance</p>');
    lines.push(set && a.rate
      ? `<p class="small">Offset saving you about <b>${money((a.balance * a.rate) / 100 / 12)}</b> interest a month</p>`
      : '<p class="small muted">Add your home-loan rate to see the interest it saves</p>');
  }
  const stale = !last || (Date.now() - fromISO(last.date)) > 3 * 864e5;
  const day = last && relDay(last.date);
  const updated = last ? `Updated ${/^(Today|Yesterday)$/.test(day) ? day.toLowerCase() : fmtDate(last.date)} ${who(last.by)}` : 'Not updated yet';
  return { set, credit, change, big, label, lines: lines.join(''), bar, updated, stale, hist };
}

function accountMini(a) {
  const f = accountFacts(a);
  const [ic] = KINDS[a.kind] || KINDS.everyday;
  return `<div class="acc-mini ${f.stale ? 'stale' : ''}">
    <div class="acc-top"><span>${ic} ${esc(a.name)}</span><span class="acc-btns"><button class="icon-btn sm" data-action="editAccount" data-id="${a.id}" aria-label="${esc(a.name)} settings" title="Settings">${icon('gear', 18)}</button><button class="btn sm" data-action="updateBalance" data-id="${a.id}">Update</button></span></div>
    <small class="muted">${f.label}</small>
    <div class="acc-bal">${f.big}</div>
    ${f.bar}${f.lines}
    <p class="small muted">${f.updated}${f.change ? ' · ' + f.change : ''}</p>
    <button class="link small stmt-link" data-action="statement" data-id="${a.id}">📄 Statement ›</button>
  </div>`;
}

export function accountCard(a) {
  const f = accountFacts(a);
  const [ic, label] = KINDS[a.kind] || KINDS.everyday;
  return `<section class="card account">
    <div class="acc-head">
      <button class="pot-head" data-action="editAccount" data-id="${a.id}">
        <span class="pot-ic acc">${ic}</span>
        <span><b>${esc(a.name)}</b><small>${label}${a.last4 ? ` ·· ${esc(a.last4)}` : ''}${a.kind === 'offset' && a.rate ? ` · ${a.rate}% loan rate` : ''}${a.kind === 'credit' && a.limit ? ` · ${money(a.limit, { whole: true })} limit` : ''}</small></span>
      </button>
      <button class="icon-btn" data-action="editAccount" data-id="${a.id}" aria-label="${esc(a.name)} settings" title="Settings">${icon('gear', 20)}</button>
    </div>
    <small class="muted acc-label">${f.label}</small>
    <div class="acc-bal big">${f.big}</div>
    ${f.bar}${f.lines}
    <p class="small muted">${f.updated}${f.change ? ' · ' + f.change : ''}</p>
    ${f.stale ? '<p class="notice small">● Time for an update — type the figures from your NAB app, or import a NAB statement.</p>' : ''}
    ${f.hist.length > 1 ? `<div class="pot-entries">${f.hist.slice(-5).reverse().map(h => `<div><span>${fmtDate(h.date)} ${who(h.by)}</span><b>${h.balance == null ? '—' : f.credit ? owed(h.balance) : signed(h.balance)}</b></div>`).join('')}</div>` : ''}
    <div class="btn-row"><button class="btn sm primary" data-action="updateBalance" data-id="${a.id}">Update</button><button class="btn sm" data-action="statement" data-id="${a.id}">📄 Statement</button></div>
  </section>`;
}

function accountsHome() {
  const accs = S.list('accounts');
  if (!accs.length) return '';
  const cash = sum(accs.filter(a => a.kind !== 'credit'), a => a.balance || 0);
  const cards = sum(accs.filter(a => a.kind === 'credit'), a => a.balance || 0);
  return `<section class="card span2">
    <h2>Accounts <a href="#savings">Details</a></h2>
    <div class="acc-grid">${accs.map(accountMini).join('')}</div>
    ${cards && cash ? `<p class="small muted mt">Cash minus card debt: <b>${signed(cash - cards)}</b></p>` : ''}
  </section>`;
}

const empty = (ic, text, action = '') => `<div class="empty"><span class="e-ic">${ic}</span>${text}${action}</div>`;

// ---------- Home pie: income / spending areas / categories ----------
export const PIE_MODES = [['income', 'Income'], ['areas', 'Spending areas'], ['categories', 'Categories']];

// Spending (incl. savings) per area, with anything in a deleted area counted as Ungrouped.
function byArea(spent) {
  const gs = S.groups();
  const rows = gs.map(g => ({ ...g, value: 0 }));
  const loose = { id: 'ungrouped', name: 'Ungrouped', color: 'var(--line-2)', savings: false, value: 0 };
  for (const [id, v] of Object.entries(spent)) {
    const c = S.byId('categories', id);
    const row = rows.find(r => r.id === (c ? c.group : 'other')) || loose;
    row.value += v;
  }
  return loose.value > 0.004 ? [...rows, loose] : rows;
}

// The month in two parts: what has really happened so far (money in − out),
// and, for the current month, a rough month-end figure — wages still to land,
// minus bills still due, minus the rest of what you usually spend in a month.
function monthOutlook(p, t, expIn) {
  const now = t.in - t.out;
  const live = p.end > new Date() && p.start <= new Date();
  if (!live) return { now, live, toCome: 0, billsLeft: 0, usualLeft: 0, end: now, avgOut: 0 };
  const today = todayISO();
  const toCome = Math.max(0, expIn - t.in);
  const billsLeft = sum(billsInPeriod(p).filter(b => !b.done && b.date >= today), b => +b.item.amount || 0);
  const past = [1, 2, 3].map(k => monthStats(shiftPeriod(p.key, -k))).filter(m => m.out > 0);
  const avgOut = past.length ? sum(past, m => m.out) / past.length : 0;
  // usual spending still to come, on top of the bills (never below zero)
  const usualLeft = Math.max(0, avgOut - t.out - billsLeft);
  return { now, live, toCome, billsLeft, usualLeft, avgOut, months: past.length, end: now + toCome - billsLeft - usualLeft };
}
const offsetName = () => S.list('accounts').find(a => a.kind === 'offset')?.name;
// Fortnightly (or weekly) wages that land one more time than usual this month.
function extraPaydays(p) {
  const n = {};
  for (const r of incomesInPeriod(p)) if (['fortnightly', 'weekly'].includes(r.item.frequency)) n[r.item.id] = (n[r.item.id] || 0) + 1;
  return Object.entries(n).filter(([id, k]) => k > (S.byId('incomes', id).frequency === 'weekly' ? 4 : 2)).map(([id]) => S.byId('incomes', id).name);
}

let lastPie = '';
export const replayPie = () => { lastPie = ''; };
function moneyPie(spent, t, base, txs, look) {
  const mode = view.pieMode || 'income';
  const areas = byArea(spent);
  const saved = sum(areas.filter(a => a.savings), a => a.value);
  const spending = sum(areas.filter(a => !a.savings), a => a.value);
  let segs = [], center = '', sub = '', note = '', heading = '', tally = '';
  if (mode === 'income') {
    // still to spend this month (bills due + usual spending), then what's likely left
    const toSpend = look.billsLeft + look.usualLeft;
    const left = Math.max(0, base - spending - saved - toSpend);
    segs = [
      { label: 'Spent', value: spending, color: 'var(--s2)', open: opens('spend') },
      { label: 'Saved', value: saved, color: 'var(--s3)', open: opens('saved') },
      { label: 'Still to spend (est.)', value: Math.min(toSpend, Math.max(0, base - spending - saved)), color: 'var(--line-2)' },
      { label: look.live ? 'Likely left over' : 'Left over', value: left, color: 'var(--s1)', open: 'data-action="moneyIn"' },
    ].filter(s => s.value > 0.004);
    center = money(base, { whole: true }); sub = 'coming in';
    if (base && spending + saved > base) note = `<p class="status bad small">⚠ Spending is ${money(spending + saved - base)} more than came in</p>`;
    if (!base) note = '<p class="small muted">Add your wages in Plan → Wages to see your income split.</p>';
    tally = incomeTally(txs, t, look, spending, saved);
  } else if (mode === 'areas') {
    segs = areas.filter(a => a.value > 0.004).map(a => ({ id: a.id, label: a.name + (a.savings ? ' (saved)' : ''), value: a.value, color: a.color, open: opens('area', a.id) }));
    center = money(t.out, { whole: true }); sub = 'out';
    note = '<p class="small muted">Tap an area to see every payment in it.</p>';
  } else {
    const g = view.pieGroup && S.groups().find(x => x.id === view.pieGroup);
    const rows = Object.entries(spent).filter(([id, v]) => v > 0.004 && (!g || S.cat(id).group === g.id)).sort((a, b) => b[1] - a[1]);
    // the 7 biggest get their own colour; the rest fold into "Everything else"
    segs = rows.slice(0, 7).map(([id, v], i) => ({ label: `${S.cat(id).icon} ${S.cat(id).name}`, value: v, color: `var(--s${i + 1})`, open: opens('cat', id) }));
    const rest = sum(rows.slice(7), ([, v]) => v);
    if (rest > 0.004) segs.push({ label: `Everything else (${rows.length - 7})`, value: rest, color: 'var(--line-2)', open: 'data-action="pieRest"', rest: rows.slice(7) });
    center = money(sum(rows, ([, v]) => v), { whole: true }); sub = g ? g.name : 'out';
    if (g) heading = `<button class="link" data-action="pieBack">← All spending areas</button>`;
  }
  const total = sum(segs, s => s.value);
  // Play the sweep + count-up when what the pie shows changes (new view, new month, new data),
  // not every time Home redraws for something else.
  const sig = [mode, view.pieGroup, view.period, ...segs.map(s => s.value.toFixed(2))].join('|');
  const fresh = sig !== lastPie;
  lastPie = sig;
  const centreValue = Math.round(mode === 'income' ? base : mode === 'areas' ? t.out : total);
  const legend = segs.map((s, i) => {
    const pct = total ? Math.round((s.value / total) * 100) : 0;
    const count = fresh ? ` data-count="${Math.round(s.value)}" data-count-key="pie-${i}" data-count-dp="0" data-count-from="0" data-count-ms="900"` : '';
    const inner = `<i style="background:${s.color}"></i><span>${esc(s.label)}</span><b${count}>${money(s.value, { whole: true })}</b><small>${pct}%</small>`;
    if (s.rest) {
      // "Everything else" opens up in place to show the smaller categories
      const open = view.pieRestOpen;
      const kids = open ? `<div class="pie-rest">${s.rest.map(([id, v]) => `<button class="legend-row pie-row sub" ${opens('cat', id)}>
          <span>${S.cat(id).icon} ${esc(S.cat(id).name)}</span><b>${money(v, { whole: true })}</b><small>${total ? Math.round((v / total) * 100) : 0}%</small><i class="chev">›</i></button>`).join('')}
        <button class="link small" ${opens('cats', s.rest.map(([id]) => id).join(','))}>See all their payments ›</button></div>` : '';
      return `<button class="legend-row pie-row" ${s.open} aria-expanded="${open ? 'true' : 'false'}">${inner}<i class="chev rest-chev ${open ? 'open' : ''}">›</i></button>${kids}`;
    }
    return s.open ? `<button class="legend-row pie-row" ${s.open}>${inner}<i class="chev">›</i></button>` : `<div class="legend-row pie-row">${inner}</div>`;
  }).join('');
  return `<section class="card span2 pie-card">
    <h2>Where the money goes</h2>
    <div class="pie-layout">
      <div class="chart pie-chart" ${mode === 'income' ? 'data-action="moneyIn" role="button" tabindex="0" aria-label="See money in"' : ''}>${donut(segs, { size: 200, thick: 30, center, sub, sweep: fresh, count: fresh ? { value: centreValue, key: 'pie' } : null })}</div>
      <div class="pie-side">
        <div class="seg small pie-modes" role="radiogroup" aria-label="Show">${PIE_MODES.map(([v, l]) => `<label><input type="radio" name="pieMode" value="${v}" ${mode === v ? 'checked' : ''} data-change="pieMode"><span>${l}</span></label>`).join('')}</div>
        ${heading}
        <div class="legend ${fresh ? 'stagger' : ''}">${legend || '<p class="small muted">Nothing to show for this month yet.</p>'}</div>
        ${note}
      </div>
    </div>
    ${tally}
  </section>`;
}

// What a pie slice opens: the payments behind it.
const opens = (kind, id = '') => `data-action="spendList" data-kind="${kind}" data-id="${esc(id)}"`;

// Under the Income pie: what really happened so far, then (this month) the rest-of-month estimate.
function incomeTally(txs, t, look, spending, saved) {
  const real = txs.filter(x => x.type === 'in' && !S.isTransfer(x.categoryId));
  const wages = sum(real.filter(x => x.categoryId === 'wages'), x => x.amount);
  const other = t.in - wages;
  const off = offsetName();
  const stays = off ? `stays in ${esc(off)}` : 'stays in your accounts';
  const row = (label, value, cls = '', note = '') => {
    const inner = `<span>${label}${note ? `<small>${note}</small>` : ''}</span><b>${value}</b>`;
    return cls.startsWith('in') ? `<button class="tally-row ${cls}" data-action="moneyIn">${inner}<i class="chev">›</i></button>` : `<div class="tally-row ${cls}">${inner}</div>`;
  };
  const now = look.now;
  const rest = look.live && (look.toCome > 0.004 || look.billsLeft > 0.004 || look.usualLeft > 0.004);
  const usualNote = look.months ? `you usually spend about ${money(look.avgOut, { whole: true })} a month` : 'import a few months to estimate this';
  return `<div class="tally">
    <p class="tally-head">${look.live ? 'So far this month' : 'This month'}</p>
    ${row('💵 Wages in', money(wages), 'in')}
    ${other > 0.004 ? row('➕ Other money in', money(other), 'in') : ''}
    ${row('🛒 Spending', '−' + money(spending), 'out')}
    ${saved > 0.004 ? row('🐷 Put into savings', '−' + money(saved), 'out') : ''}
    ${row(now >= 0 ? (look.live ? '✅ Not spent so far' : '✅ Left over') : '⚠ Spent more than came in', money(Math.abs(now)), 'total ' + (now >= 0 ? 'pos' : 'neg'), now >= 0 ? stays : 'came out of savings')}
    ${rest ? `<p class="tally-head">Rest of the month (estimate)</p>
    ${look.toCome > 0.004 ? row('⏳ Wages still to come', '+' + money(look.toCome), 'in muted', 'expected paydays') : ''}
    ${look.billsLeft > 0.004 ? row('📄 Bills still to pay', '−' + money(look.billsLeft), 'out', 'due later this month') : ''}
    ${row('🛒 Usual spending still to come', '−' + money(look.usualLeft), 'out', usualNote)}
    ${row(look.end >= 0 ? '≈ Likely left at month end' : '⚠ Likely short at month end', money(Math.abs(look.end), { whole: true }), 'total ' + (look.end >= 0 ? 'pos' : 'neg'), look.end >= 0 ? stays : 'would come out of savings')}` : ''}
  </div>`;
}

// ---------- Money in (from Home) ----------
const SRC = { csv: '🏦 Bank file', pdf: '🏦 Bank statement', income: '✋ Ticked off', manual: '✋ Added by hand', receipt: '🧾 Receipt', screenshot: '📱 Screenshot', pot: '🐷 From a pot' };
export function moneyInSheet() {
  const p = periodOf(view.period);
  const ins = txInPeriod(p).filter(t => t.type === 'in' && !S.isTransfer(t.categoryId)).sort((a, b) => b.date.localeCompare(a.date));
  const wages = ins.filter(t => t.categoryId === 'wages');
  const other = ins.filter(t => t.categoryId !== 'wages');
  const due = p.end > new Date() ? incomesInPeriod(p).filter(r => !r.done && fromISO(r.date) >= new Date(new Date().toDateString())) : [];
  const row = t => {
    const acc = t.accountId ? S.byId('accounts', t.accountId) : null;
    const src = SRC[t.source] || SRC.manual;
    return `<button class="tx" data-action="editTx" data-id="${t.id}">
      <span class="tx-ic" style="--c:${S.memberColor(t.member)}">${S.cat(t.categoryId).icon}</span>
      <span class="tx-main"><b>${esc(t.bankDesc || t.desc)}</b><small>${fmtDate(t.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${src}${acc ? ` · ${esc(acc.name)}` : ''}${t.member ? ` · ${esc(t.member)}` : ''}</small></span>
      <span class="tx-amt in">+${money(t.amount)}</span></button>`;
  };
  const block = (title, list, ic) => list.length ? `<div class="section-title"><span>${ic} ${title}</span><span>${money(sum(list, t => t.amount))}</span></div>
    <div class="card list">${list.map(row).join('')}</div>` : '';
  const total = sum(ins, t => t.amount);
  return `${sheetHead('Money in', p.range)}
    <div class="in-summary">
      <div><small>Wages</small><b>${money(sum(wages, t => t.amount))}</b><small>${wages.length} pay${wages.length === 1 ? '' : 's'}</small></div>
      <div><small>All money in</small><b>${money(total)}</b><small>${ins.length} payment${ins.length === 1 ? '' : 's'}</small></div>
    </div>
    ${block('Wages', wages, '💵') || '<p class="small muted">No wages yet this month. Import a bank statement (WAGES rows are picked up automatically) or add one with ＋.</p>'}
    ${block('Other money in', other, '➕')}
    ${due.length ? `<div class="section-title"><span>⏳ Still to come</span><span>${money(sum(due, r => incomeAmount(r.item)))}</span></div>
    <div class="card list">${due.map(r => `<div class="tx static"><span class="tx-ic">💵</span><span class="tx-main"><b>${esc(r.item.name)}</b><small>Expected ${fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' })}${r.item.varies ? ' · about' : ''}</small></span><span class="tx-amt muted">${money(incomeAmount(r.item))}</span></div>`).join('')}</div>` : ''}
    <p class="small muted">Tap a payment to change it. Bank transfers between your own accounts aren't counted.</p>
    <div class="form-actions"><button class="btn" data-action="moneyInActivity">See all in Activity</button></div>`;
}

// ---------- Spending behind a pie slice ----------
export function spendSheet(kind, id) {
  const p = periodOf(view.period);
  const areaOf = c => (S.byId('categories', c) ? S.cat(c).group : 'other');
  const savingsAreas = new Set(S.groups().filter(g => g.savings).map(g => g.id));
  const ids = new Set(String(id).split(','));
  const keep = {
    spend: l => !savingsAreas.has(areaOf(l.categoryId)),
    saved: l => savingsAreas.has(areaOf(l.categoryId)),
    area: l => (S.groups().some(g => g.id === areaOf(l.categoryId)) ? areaOf(l.categoryId) : 'ungrouped') === id,
    cat: l => l.categoryId === id,
    cats: l => ids.has(l.categoryId),
  }[kind] || (() => true);
  const lines = spendLines(txInPeriod(p)).filter(keep).sort((a, b) => b.tx.date.localeCompare(a.tx.date));
  const total = sum(lines, l => l.amount);
  const g = kind === 'area' && S.groups().find(x => x.id === id);
  const c = kind === 'cat' && S.cat(id);
  const title = { spend: 'Spending', saved: 'Saved', area: g ? g.name : 'Ungrouped', cat: c ? `${c.icon} ${c.name}` : '', cats: 'Everything else' }[kind] || 'Spending';
  const row = l => {
    const t = l.tx, acc = t.accountId ? S.byId('accounts', t.accountId) : null;
    const part = t.splits?.length > 1 ? ` · part of ${money(t.amount)}` : '';
    return `<button class="tx" data-action="editTx" data-id="${t.id}">
      <span class="tx-ic" style="--c:${S.memberColor(t.member)}">${S.cat(l.categoryId).icon}</span>
      <span class="tx-main"><b>${esc(t.desc)}</b><small>${fmtDate(t.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${SRC[t.source] || SRC.manual}${acc ? ` · ${esc(acc.name)}` : ''}${t.member ? ` · ${esc(t.member)}` : ''}${part}</small></span>
      <span class="tx-amt out">−${money(l.amount)}</span></button>`;
  };
  // one category: a single list. Several: a list per category, biggest first.
  let body;
  if (kind === 'cat') body = lines.length ? `<div class="card list">${lines.map(row).join('')}</div>` : '';
  else {
    const byCat = {};
    for (const l of lines) (byCat[l.categoryId] ||= []).push(l);
    body = Object.entries(byCat).sort((a, b) => sum(b[1], l => l.amount) - sum(a[1], l => l.amount)).map(([cid, ls]) =>
      `<div class="section-title"><button class="link cat-link" data-action="spendList" data-kind="cat" data-id="${cid}">${S.cat(cid).icon} ${esc(S.cat(cid).name)} ›</button><span>${money(sum(ls, l => l.amount))}</span></div>
      <div class="card list">${ls.map(row).join('')}</div>`).join('');
  }
  const budget = c ? +c.budget || 0 : g ? sum(S.list('categories').filter(x => x.group === g.id), x => +x.budget || 0) : 0;
  const biggest = lines.reduce((m, l) => (l.amount > (m?.amount || 0) ? l : m), null);
  return `${sheetHead(title, p.range)}
    <div class="in-summary out">
      <div><small>Spent</small><b>${money(total)}</b><small>${lines.length} payment${lines.length === 1 ? '' : 's'}</small></div>
      ${budget ? `<div><small>Budget</small><b class="${total > budget ? 'neg' : ''}">${money(budget)}</b><small>${total > budget ? money(total - budget) + ' over' : money(budget - total) + ' left'}</small></div>`
        : biggest ? `<div><small>Biggest</small><b>${money(biggest.amount)}</b><small>${esc(biggest.tx.desc)}</small></div>` : ''}
    </div>
    ${body || '<p class="small muted">No spending here this month yet. Import a bank statement or add a payment with ＋.</p>'}
    <p class="small muted">Tap a payment to change it or move it to another category.</p>
    <div class="form-actions">
      ${kind === 'area' && g ? `<button class="btn" data-action="pieDrillFromSheet" data-id="${g.id}">Show as a pie by category</button>` : ''}
      ${kind === 'cat' ? `<button class="btn" data-action="editCategory" data-id="${esc(id)}">${icon('pen', 16)} Edit category</button><button class="btn" data-action="catActivity" data-id="${esc(id)}">See in Activity</button>` : ''}
    </div>`;
}

export const cardSheet = card => cardSheetHtml(card, { sheetHead, inOutBars });

// ---------- Home ----------
export function home() {
  const p = periodOf(view.period);
  const txs = txInPeriod(p);
  const t = totals(txs);
  const expIn = expectedIn(p);
  // Until the month is over, count wages that are still due to land.
  const useExpected = expIn > t.in && p.end > new Date();
  const base = useExpected ? expIn : t.in;
  const look = monthOutlook(p, t, expIn);
  const pct = t.in ? Math.min(100, (t.out / t.in) * 100) : t.out ? 100 : 0;
  const spent = spentByCategory(txs);
  const outCats = S.list('categories').filter(c => (c.type || 'out') === 'out');

  // Same point last month: spending up to the same day of the month.
  let pace = '';
  if (p.key === currentPeriodKey()) {
    const day = Math.floor((new Date() - p.start) / 864e5);
    const lp = periodOf(shiftPeriod(p.key, -1));
    const cut = new Date(lp.start.getFullYear(), lp.start.getMonth(), lp.start.getDate() + day + 1);
    const lastOut = totals(txInPeriod(lp).filter(x => fromISO(x.date) < cut)).out;
    const diff = lastOut - t.out;
    if (lastOut > 0 && Math.abs(diff) >= 1) pace = `<div class="pace ${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '🙌' : '👀'} ${diff >= 0
      ? `<b>${money(diff, { whole: true })} less</b> spent than this time last month`
      : `<b>${money(-diff, { whole: true })} more</b> spent than this time last month`}</div>`;
  }

  // Hero
  const hero = `<section class="card hero span2">
    <div class="hero-top"><span class="label">This month</span><span class="label">${esc(p.range)}</span></div>
    <div class="hero-stats big-stats">
      <button class="hero-stat" data-action="moneyIn"><small>↓ Money in ›</small><b>${money(t.in)}</b><small>${expIn ? 'of ' + money(expIn) + ' expected' : 'this month'}</small></button>
      <div class="hero-stat"><small>↑ Money out</small><b>${money(t.out)}</b><small>${t.count} payments</small></div>
    </div>
    <div class="hero-left ${look.now >= 0 ? '' : 'neg'}"><span>${look.now >= 0 ? (look.live ? 'Not spent so far' : 'Left over') : 'Spent more than came in'}<small>${t.in ? `you've spent ${Math.round((t.out / t.in) * 100)}% of what came in` : t.out ? 'nothing has come in yet' : 'import a statement or add your wages'}</small></span><b>${money(Math.abs(look.now))}</b></div>
    <div class="meter" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
    ${look.live && (look.toCome || look.billsLeft || look.usualLeft) ? `<div class="hero-outlook ${look.end >= 0 ? '' : 'neg'}">📅 By month end, roughly <b>${money(Math.abs(look.end), { whole: true })} ${look.end >= 0 ? 'left' : 'short'}</b><small>after ${[look.toCome > 0.004 ? `+${money(look.toCome, { whole: true })} wages to come` : '', look.billsLeft > 0.004 ? `−${money(look.billsLeft, { whole: true })} bills` : '', look.usualLeft > 0.004 ? `−${money(look.usualLeft, { whole: true })} usual spending` : ''].filter(Boolean).join(' · ')}</small></div>` : ''}
    ${extraPaydays(p).length ? `<p class="hero-note">📅 3 paydays this month: one more than usual, so more is coming in than in a normal month. Don't count on it every month.</p>` : ''}
    ${pace}
  </section>`;

  // Where the money goes: one pie, three ways of looking at it.
  const pie = moneyPie(spent, t, base, txs, look);

  // Budget watch
  const budgetTotal = sum(outCats, c => c.budget);
  const watch = outCats.filter(c => c.budget > 0 && spent[c.id])
    .sort((a, b) => spent[b.id] / b.budget - spent[a.id] / a.budget).slice(0, 4);
  const bst = status(t.out, budgetTotal);
  const budget = `<section class="card">
    <h2>Budget <a href="#plan/budget">See all</a></h2>
    <div class="budget-total"><b>${money(t.out, { whole: true })}</b> <span>of ${money(budgetTotal, { whole: true })} budgeted</span></div>
    <div class="bar big"><i class="${bst.cls}" style="width:${budgetTotal ? Math.min(100, (t.out / budgetTotal) * 100) : 0}%"></i></div>
    <p class="status ${bst.cls}">${bst.text}</p>
    ${watch.length ? watch.map(c => catRow(c, spent[c.id] || 0)).join('') : '<p class="muted small">Categories you spend in will show here.</p>'}
  </section>`;

  // Bills coming up
  const bills = billsInPeriod(p);
  const unpaid = bills.filter(b => !b.done);
  const billsCard = `<section class="card">
    <h2>Bills this month <a href="#plan/bills">All bills</a></h2>
    <div class="stat-row"><div class="stat"><small>Due</small><b>${money(sum(bills, b => b.item.amount))}</b></div>
      <div class="stat"><small>Still to pay</small><b>${money(sum(unpaid, b => b.item.amount))}</b></div></div>
    ${bills.length ? unpaid.slice(0, 5).map(billRow).join('') || '<p class="status good">✓ All bills paid this month</p>'
      : empty('📄', 'Add your bills to see what is due.', `<br><button class="btn sm" data-action="newBill">Add a bill</button>`)}
  </section>`;

  // Recent
  const recent = `<section class="card">
    <h2>Recent <a href="#activity">See all</a></h2>
    ${txs.length ? txs.slice(0, 6).map(txRow).join('') : empty('✨', 'Nothing here yet for this month.')}
  </section>`;

  // Trend
  const rows = [];
  for (let k = -5; k <= 0; k++) {
    const pk = periodOf(shiftPeriod(view.period, k));
    const tt = totals(txInPeriod(pk));
    rows.push({ label: pk.start.toLocaleDateString('en-AU', { month: 'short' }), in: tt.in, out: tt.out });
  }
  const trend = `<section class="card">
    <h2>Last 6 months</h2>
    <div class="legend inline"><div class="legend-row"><i style="background:var(--s1)"></i><span>Money in</span></div><div class="legend-row"><i style="background:var(--s2)"></i><span>Money out</span></div></div>
    <div class="chart">${inOutBars(rows)}</div>
  </section>`;

  // Who spent
  const members = S.settings().members;
  const byMember = members.map(m => ({ m, v: sum(txs.filter(x => x.type === 'out' && !S.isTransfer(x.categoryId) && x.member === m), x => x.amount) }));
  const unassigned = t.out - sum(byMember, x => x.v);
  if (unassigned > 0.01) byMember.push({ m: 'Joint / not set', v: unassigned });
  const bmMax = Math.max(...byMember.map(x => x.v), 1);
  const whoCard = `<section class="card">
    <h2>Who spent</h2>
    <div class="hbar">${byMember.map(x => `<span>${who(x.m)}</span><span class="track"><i style="width:${(x.v / bmMax) * 100}%;background:${S.memberColor(x.m)}"></i></span><b>${money(x.v, { whole: true })}</b>`).join('')}</div>
  </section>`;

  return `<div class="grid cols">${hero}${sweepCard()}${pie}${accountsHome()}${streakCard()}${budget}${billsCard}${recent}${yearCard()}${trend}${whoCard}</div>`;
}

export function billRow(r) {
  const b = r.item, d = fromISO(r.date);
  const late = !r.done && r.date < todayISO();
  return `<div class="bill ${r.done ? 'is-paid' : ''}">
    <div class="due ${late ? 'late' : ''}"><b>${d.getDate()}</b><small>${d.toLocaleDateString('en-AU', { month: 'short' })}</small></div>
    <button class="bill-main" data-action="editBill" data-id="${b.id}">
      <b>${S.cat(b.categoryId).icon} ${esc(b.name)}</b>
      <small>${esc(b.method || '')}${b.payer ? ' · ' + esc(b.payer) : ''}${late ? ' · <span class="status bad">overdue?</span>' : ''}</small>
    </button>
    <span class="tx-amt">${money(b.amount)}</span>
    <button class="paid-btn ${r.done ? 'on' : ''}" data-action="toggleBill" data-id="${b.id}" data-date="${r.date}" aria-label="${r.done ? 'Mark unpaid' : 'Mark paid'}" title="${r.done ? 'Paid — tap to undo' : 'Mark as paid'}">${icon('check', 18)}</button>
  </div>`;
}

// ---------- Activity ----------
export function activity() {
  const f = view.filters;
  const cats = S.list('categories');
  const members = S.settings().members;
  return `<div class="toolbar">
      <div class="search">${icon('search', 18)}<input type="search" placeholder="Search payments" value="${esc(f.q)}" data-input="search" aria-label="Search payments"></div>
      <div class="seg small" role="radiogroup" aria-label="Type">
        ${[['all', 'All'], ['out', 'Out'], ['in', 'In']].map(([v, l]) => `<label><input type="radio" name="ftype" value="${v}" ${f.type === v ? 'checked' : ''} data-change="filterType"><span>${l}</span></label>`).join('')}
      </div>
      <select data-change="filterCat" aria-label="Category"><option value="">All categories</option>${cats.map(c => `<option value="${c.id}" ${f.categoryId === c.id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select>
      <select data-change="filterMember" aria-label="Person"><option value="">Everyone</option>${members.map(m => `<option ${f.member === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
    </div>
    <div id="tx-list">${txList()}</div>`;
}

// Searching looks across every month (with totals for this month, the last
// 3 months, this year and all time); "This month" narrows it back down.
export function txList() {
  const f = view.filters;
  const q = f.q.trim().toLowerCase();
  const allMonths = !!q && f.scope !== 'month';
  const match = t =>
    (f.type === 'all' || t.type === f.type) &&
    (!f.categoryId || t.categoryId === f.categoryId || t.splits?.some(s => s.categoryId === f.categoryId)) &&
    (!f.member || t.member === f.member) &&
    (!q || t.desc.toLowerCase().includes(q) || (t.bankDesc || '').toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q) || String(t.amount).includes(q));
  const pool = allMonths ? S.list('transactions').sort((a, b) => b.date.localeCompare(a.date)) : txInPeriod(periodOf(view.period));
  const txs = pool.filter(match);
  let html = q ? `<div class="seg small search-scope" role="radiogroup" aria-label="Search where">${[['all', 'All months'], ['month', 'This month']].map(([v, l]) =>
    `<label><input type="radio" name="fscope" value="${v}" ${(allMonths ? 'all' : 'month') === v ? 'checked' : ''} data-change="filterScope"><span>${l}</span></label>`).join('')}</div>` : '';
  if (!txs.length) return html + `<div class="card">${empty('🔍', allMonths ? 'Nothing matches that search.' : 'No payments match for this month.', `<br><button class="btn sm" data-action="openAdd">Add one</button>`)}</div>`;
  const t = totals(txs);
  if (q) {
    // totals over time for whatever is searched
    const every = S.list('transactions').filter(match);
    const cur = periodOf(currentPeriodKey()), three = periodOf(shiftPeriod(cur.key, -2));
    const yStart = new Date(new Date().getFullYear(), 0, 1);
    const spent = list => { const x = totals(list); return x.out || x.in; };
    const since = d => every.filter(x => { const dd = fromISO(x.date); return dd >= d && dd < cur.end; });
    html += `<section class="card search-sum">
      <h2>“${esc(f.q.trim())}”</h2>
      <div class="sum-grid">
        <div><small>This month</small><b>${money(spent(since(cur.start)))}</b></div>
        <div><small>Last 3 months</small><b>${money(spent(since(three.start)))}</b></div>
        <div><small>This year</small><b>${money(spent(since(yStart)))}</b></div>
        <div><small>All time</small><b>${money(spent(every))}</b></div>
      </div>
      <p class="small muted">${every.length} payment${every.length === 1 ? '' : 's'}${every.length ? ` since ${fmtDate(every.map(x => x.date).sort()[0], { day: 'numeric', month: 'short', year: 'numeric' })}` : ''} · about ${money(spent(since(three.start)) / 3, { whole: true })} a month lately</p>
      <button class="btn sm" data-action="moveSearch">🏷️ Move all “${esc(f.q.trim())}” payments to a category…</button>
    </section>`;
  } else {
    html += `<div class="stat-row"><div class="stat"><small>${txs.length} payments · in</small><b class="pos">${money(t.in)}</b></div><div class="stat"><small>Out</small><b>${money(t.out)}</b></div></div>`;
  }
  const groups = {};
  txs.forEach(x => (groups[allMonths ? x.date.slice(0, 7) : x.date] ||= []).push(x));
  for (const [k, list] of Object.entries(groups)) {
    const out = sum(list.filter(x => x.type === 'out' && !S.isTransfer(x.categoryId)), x => x.amount);
    const head = allMonths ? periodOf(k).label : relDay(k);
    html += `<div class="day-head"><span>${head}</span><span>${out ? '−' + money(out) : ''}</span></div><div class="card list">${list.map(allMonths ? txRowDated : txRow).join('')}</div>`;
  }
  return html;
}
// In an all-months search each row shows its date.
const txRowDated = t => txRow(t).replace('<small>', `<small>${fmtDate(t.date, { day: 'numeric', month: 'short' })} · `);

// ---------- Plan: budget, bills, wages ----------
export function plan(tab = view.planTab) {
  view.planTab = tab;
  const tabs = [['budget', 'Budget'], ['bills', 'Bills'], ['wages', 'Wages'], ['year', 'Year']];
  const body = tab === 'bills' ? billsTab() : tab === 'wages' ? wagesTab() : tab === 'year' ? yearTab() : budgetTab();
  return `<nav class="tabs">${tabs.map(([id, l]) => `<a href="#plan/${id}" class="${tab === id ? 'active' : ''}">${l}</a>`).join('')}</nav>${body}`;
}

function budgetTab() {
  const p = periodOf(view.period);
  const spent = spentByCategory(txInPeriod(p));
  const cats = S.list('categories').filter(c => (c.type || 'out') === 'out');
  const expIn = expectedIn(p) || sum(S.list('incomes'), i => perMonth(incomeAmount(i), i.frequency));
  const budgeted = sum(cats, c => c.budget);
  const left = expIn - budgeted;
  const billsMonthly = sum(S.list('bills').filter(b => b.active !== false), b => perMonth(b.amount, b.frequency));
  // What really happens: money you don't spend stays in the offset, and real spending is often more than the budgets.
  const offsetAcc = S.list('accounts').find(a => a.kind === 'offset');
  const recent = [1, 2, 3].map(k => monthStats(shiftPeriod(currentPeriodKey(), -k))).filter(m => m.in || m.out);
  const avgOut = recent.length ? sum(recent, m => m.out) / recent.length : 0;
  const avgIn = recent.length ? sum(recent, m => m.in) / recent.length : 0;
  const pays = incomesInPeriod(p).filter(r => ['fortnightly', 'weekly'].includes(r.item.frequency));
  const byIncome = {};
  for (const r of pays) byIncome[r.item.id] = (byIncome[r.item.id] || 0) + 1;
  const extraPay = Object.entries(byIncome).filter(([id, n]) => n > (S.byId('incomes', id).frequency === 'weekly' ? 4 : 2)).map(([id]) => S.byId('incomes', id).name);
  const reality = recent.length ? `<div class="plan-reality">
      <p><b>What really happens:</b> over the last ${recent.length} month${recent.length === 1 ? '' : 's'} you spent about <b>${money(avgOut, { whole: true })}</b> a month against <b>${money(avgIn, { whole: true })}</b> coming in${avgOut > budgeted + 1 ? ` — ${money(avgOut - budgeted, { whole: true })} more than your budgets add up to` : ''}.</p>
      <p>${avgIn - avgOut >= 0 ? `So roughly <b class="pos">${money(avgIn - avgOut, { whole: true })} a month</b> actually ${offsetAcc ? `stays in your ${esc(offsetAcc.name)}` : 'is left over'}.` : `So you've been <b class="neg">${money(avgOut - avgIn, { whole: true })} a month short</b>${offsetAcc ? ` — dipping into the ${esc(offsetAcc.name)}` : ''}.`}
      ${avgOut > budgeted + 1 ? ' Raising the budgets to match real spending (✨ Budget helper, or tap a category) makes the plan honest.' : ''}</p>
    </div>` : '';
  let html = `<div class="grid cols"><section class="card span2">
    <h2>Your monthly plan</h2>
    <div class="stat-row">
      <div class="stat"><small>Expected income</small><b>${money(expIn, { whole: true })}</b></div>
      <div class="stat"><small>Budgeted</small><b>${money(budgeted, { whole: true })}</b></div>
      <div class="stat"><small>${left < 0 ? 'Over-planned by' : offsetAcc ? `Not budgeted — stays in ${esc(offsetAcc.name)}` : 'Not yet given a job'}</small><b class="${left >= 0 ? 'pos' : 'neg'}">${money(Math.abs(left), { whole: true })}</b></div>
      <div class="stat"><small>Bills (monthly)</small><b>${money(billsMonthly, { whole: true })}</b></div>
    </div>
    ${!expIn ? `<p class="notice">Add your wages in the <a href="#plan/wages">Wages</a> tab so C.A.S.H can check your budget adds up.</p>` : ''}
    ${extraPay.length ? `<p class="notice small">📅 ${esc(p.label)} has an extra payday (${extraPay.map(esc).join(', ')}) — paid fortnightly, a couple of months a year get 3 pays, so income looks higher than usual this month.</p>` : ''}
    ${left > 0 && offsetAcc ? `<p class="small muted">Anything not budgeted isn't lost — it simply stays in your ${esc(offsetAcc.name)}, which is your savings.</p>` : ''}
    ${reality}
    <div class="btn-row"><button class="btn" data-action="budgetHelper">✨ Budget helper (50/30/20)</button><button class="btn" data-action="newCategory">${icon('plus', 18)} Category</button></div>
  </section></div>`;
  const gs = S.groups();
  const known = new Set(gs.map(g => g.id));
  const loose = cats.filter(c => !known.has(c.group));
  for (const g of [...gs, ...(loose.length ? [S.group('ungrouped')] : [])]) {
    const gc = g.id === 'ungrouped' ? loose : cats.filter(c => c.group === g.id);
    const gs2 = sum(gc, c => spent[c.id] || 0), gb = sum(gc, c => c.budget);
    html += `<div class="section-title"><span><i class="dot" style="background:${g.color}"></i>${esc(g.name)}${g.savings && !/sav/i.test(g.name) ? ' <span class="badge">savings</span>' : ''}
        ${g.id !== 'ungrouped' ? `<button class="link" data-action="editGroup" data-id="${g.id}" aria-label="Edit ${esc(g.name)}">${icon('pen', 14)} Edit</button>` : ''}</span>
      <span>${money(gs2, { whole: true })} / ${money(gb, { whole: true })}</span></div>
      <div class="card list">${gc.map(c => catRow(c, spent[c.id] || 0)).join('') || '<p class="small muted empty-row">No categories here yet.</p>'}
        ${g.id !== 'ungrouped' ? `<button class="link add-row" data-action="newCategory" data-group="${g.id}">${icon('plus', 14)} Add a category to ${esc(g.name)}</button>` : ''}</div>`;
  }
  html += `<div class="btn-row"><button class="btn" data-action="newGroup">${icon('plus', 18)} Add a spending area</button></div>`;
  return html;
}

function billsTab() {
  const p = periodOf(view.period);
  const rows = billsInPeriod(p);
  const all = S.list('bills');
  const monthly = sum(all.filter(b => b.active !== false), b => perMonth(b.amount, b.frequency));
  const notThisMonth = all.filter(b => !rows.some(r => r.item.id === b.id));
  return `<section class="card">
      <div class="stat-row">
        <div class="stat"><small>Bills a month</small><b>${money(monthly)}</b></div>
        <div class="stat"><small>Bills a year</small><b>${money(monthly * 12, { whole: true })}</b></div>
        <div class="stat"><small>Paid this month</small><b>${rows.filter(r => r.done).length} of ${rows.length}</b></div>
      </div>
      <div class="btn-row"><button class="btn primary" data-action="newBill">${icon('plus', 18)} Add bill</button><button class="btn" data-action="findRegular">${icon('search', 18)} Find from my payments</button></div>
    </section>
    <div class="section-title"><span>Due in ${esc(p.label)}</span><span>${money(sum(rows, r => r.item.amount))}</span></div>
    <div class="card list">${rows.length ? rows.map(billRow).join('') : empty('📄', 'No bills due this month yet.<br>Add rent, council tax, energy, phones, subscriptions…')}</div>
    ${notThisMonth.length ? `<div class="section-title"><span>Not due this month</span></div><div class="card list">${notThisMonth.map(b => {
      const nd = nextDue(b);
      return `<button class="tx" data-action="editBill" data-id="${b.id}"><span class="tx-ic">${S.cat(b.categoryId).icon}</span>
        <span class="tx-main"><b>${esc(b.name)}</b><small>${FREQS[b.frequency] || ''}${b.active === false ? ' · paused' : nd ? ' · next ' + fmtDate(nd) : ''}</small></span>
        <span class="tx-amt">${money(b.amount)}</span></button>`;
    }).join('')}</div>` : ''}`;
}

function wagesTab() {
  const p = periodOf(view.period);
  // paydays that came in show what actually landed; the rest show the estimate
  const rows = incomesInPeriod(p).map(r => ({ ...r, tx: r.done ? doneTx(r.item, 'received', r.date) : null }));
  const amountOf = r => (r.tx ? r.tx.amount : incomeAmount(r.item));
  const received = sum(txInPeriod(p).filter(t => t.type === 'in' && !S.isTransfer(t.categoryId)), t => t.amount);
  return `<section class="card">
      <div class="stat-row">
        <div class="stat"><small>Expected this month</small><b>${money(sum(rows, amountOf))}</b></div>
        <div class="stat"><small>Received so far</small><b class="pos">${money(received)}</b></div>
        <div class="stat"><small>Average a month</small><b>${money(sum(S.list('incomes'), i => perMonth(incomeAmount(i), i.frequency)), { whole: true })}</b></div>
      </div>
      <div class="btn-row"><button class="btn primary" data-action="newIncome">${icon('plus', 18)} Add wage / income</button><button class="btn" data-action="findRegular">${icon('search', 18)} Find from my payments</button></div>
    </section>
    <div class="section-title"><span>Paydays in ${esc(p.label)}</span></div>
    <div class="card list">${rows.length ? rows.map(r => {
      const i = r.item, d = fromISO(r.date);
      return `<div class="bill ${r.done ? 'is-paid' : ''}">
        <div class="due in"><b>${d.getDate()}</b><small>${d.toLocaleDateString('en-AU', { month: 'short' })}</small></div>
        <button class="bill-main" data-action="${r.tx ? 'editTx' : 'editIncome'}" data-id="${r.tx ? r.tx.id : i.id}"><b>💵 ${esc(i.name)}</b><small>${esc(i.member || '')} · ${r.tx ? (/^(csv|pdf)$/.test(r.tx.source) ? `🏦 Paid ${fmtDate(r.tx.date, { day: 'numeric', month: 'short' })}` : '✋ Ticked — estimate') : `Expected${i.varies ? ' · about' : ''}`}</small></button>
        <span class="tx-amt in ${r.tx ? '' : 'est'}">${r.tx ? '+' : '≈ '}${money(amountOf(r))}</span>
        <button class="paid-btn ${r.done ? 'on' : ''}" data-action="toggleIncome" data-id="${i.id}" data-date="${r.date}" aria-label="${r.done ? 'Mark not received' : 'Mark received'}" title="${r.done ? 'Received — tap to undo' : 'Mark as received'}">${icon('check', 18)}</button>
      </div>`;
    }).join('') : empty('💵', 'Add each wage, Family Tax Benefit and other regular money coming in.')}</div>`;
}

// ---------- Savings ----------
// Pots linked to the offset take their share of its balance; the rest are filled by hand.
export const potSaved = pot => (pot.linkTo ? Off.allocation(pot.linkTo).map[pot.id] ?? 0 : sum(pot.entries || [], e => e.amount));
export const potColor = p => `var(--s${p.slot || 3})`;
export const MILESTONES = [25, 50, 75, 100];
export const potPct = p => (+p.goal ? Math.max(0, (potSaved(p) / p.goal) * 100) : 0);

// Remember how full each jar was last time, so it rises from there (not from empty).
const lastFill = {};

// A jar that fills with a pile of gold coins. New money drops in from the top;
// a nearly full jar spills a coin, and a full one pops its lid and overflows.
const seeded = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0; return () => ((h = (h * 1103515245 + 12345) | 0) >>> 0) / 4294967296; };

function jar(p) {
  const pct = Math.min(100, potPct(p));
  const from = Math.min(lastFill[p.id] ?? 0, pct);
  lastFill[p.id] = pct;
  const rnd = seeded(p.id);
  const top = 28, bottom = 110, h = bottom - top, rowH = 6.4;
  const level = bottom - (h * pct) / 100, was = bottom - (h * from) / 100;
  const id = 'jar' + p.id, coin = 'coin' + p.id;
  const coins = [];
  let order = 0;
  // rows from the bottom up; the top row thins out into a little mound
  for (let y = bottom - 3, row = 0; y >= level - 2 && pct > 0; y -= rowH, row++) {
    const topRow = y - rowH < level - 2;
    const n = topRow ? Math.max(1, Math.round(2 + rnd() * 3)) : 5;
    for (let i = 0; i < n; i++) {
      const span = topRow ? 34 : 56;
      const x = 50 - span / 2 + (span / (n - 1 || 1)) * i + (row % 2 ? 5 : -5) * (topRow ? 0 : 1) + (rnd() - 0.5) * 4;
      if (n === 1 && topRow) coins.push({ x: 50 + (rnd() - 0.5) * 10, y, r: (rnd() - 0.5) * 30, isNew: y < was - 1, k: order++ });
      else coins.push({ x: Math.min(78, Math.max(22, x)), y: y + (rnd() - 0.5) * 1.5, r: (rnd() - 0.5) * 24, isNew: y < was - 1, k: order++ });
    }
  }
  // only a jar that grew drops coins; a small top-up that doesn't start a new row still drops the top ones
  const grew = pct > from + 0.01;
  if (!grew) coins.forEach(c => { c.isNew = false; });
  else if (!coins.some(c => c.isNew)) { const topY = Math.min(...coins.map(c => c.y)); coins.forEach(c => { if (c.y <= topY + rowH) c.isNew = true; }); }
  const newCount = coins.filter(c => c.isNew).length;
  const firstNew = coins.findIndex(c => c.isNew);
  const drawCoin = (c, extra = '') => {
    const delay = c.isNew ? Math.min(1.4, ((c.k - firstNew) / Math.max(1, newCount)) * 1.1 + rnd() * 0.12) : 0;
    return `<g transform="translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) rotate(${c.r.toFixed(0)})"><g class="${c.isNew ? 'drop' : ''}${extra}" ${c.isNew ? `style="--dy:${(-(c.y - 0) - 10).toFixed(0)}px;animation-delay:${delay.toFixed(2)}s"` : ''}><use href="#${coin}"/></g></g>`;
  };
  const full = pct >= 100;
  // overflow above the rim, and coins that tumbled out around the base
  const heap = full ? [[36, 24], [50, 23], [64, 24], [43, 18], [57, 18], [50, 13]].map(([x, y], i) => ({ x, y, r: (rnd() - 0.5) * 30, isNew: from < 100, k: order + i })) : [];
  const spillAt = [[7, 113, -20], [94, 114, 15], [15, 117, 5], [86, 118, -10], [3, 118, 30]];
  const spills = full ? spillAt : pct >= 75 ? spillAt.slice(1, 2) : [];
  const fresh = (full && from < 100) || (pct >= 75 && from < 75);
  return `<svg class="jar ${full ? 'is-full' : ''}" viewBox="0 0 100 124" role="img" aria-label="${Math.round(pct)}% full">
    <defs>
      <clipPath id="${id}"><rect x="14" y="24" width="72" height="90" rx="18"/></clipPath>
      <g id="${coin}"><ellipse cx="0" cy="1.6" rx="7" ry="3.3" class="coin-edge"/><ellipse cx="0" cy="0" rx="7" ry="3.3" class="coin-face"/><ellipse cx="0" cy="0" rx="4.4" ry="1.9" class="coin-ring"/><ellipse cx="-2.6" cy="-1" rx="1.6" ry=".6" class="coin-shine"/></g>
    </defs>
    <g clip-path="url(#${id})">
      <rect x="0" y="0" width="100" height="124" class="jar-glass"/>
      ${coins.map(c => drawCoin(c)).join('')}
    </g>
    <rect x="14" y="24" width="72" height="90" rx="18" class="jar-outline"/>
    <rect x="21" y="34" width="5" height="50" rx="2.5" class="jar-shine"/>
    ${full ? '' : `<rect x="24" y="16" width="52" height="10" rx="4" class="jar-neck"/>`}
    ${heap.map(c => drawCoin(c)).join('')}
    <g class="${full ? 'lid-off' : ''}"><rect x="30" y="6" width="40" height="12" rx="4" class="jar-lid"/></g>
    ${spills.map(([x, y, r], i) => `<g transform="translate(${x} ${y}) rotate(${r})"><g class="${fresh ? 'spill' : ''}" style="--sx:${(50 - x).toFixed(0)}px;animation-delay:${(1 + i * 0.15).toFixed(2)}s"><use href="#${coin}"/></g></g>`).join('')}
    ${full ? '<g class="sparkles"><path d="M10 40l2 4 4 2-4 2-2 4-2-4-4-2 4-2z"/><path d="M90 30l1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5z"/><path d="M84 70l1.2 2.4 2.4 1.2-2.4 1.2-1.2 2.4-1.2-2.4-2.4-1.2 2.4-1.2z"/></g>' : ''}
  </svg>`;
}

// One big ring for all the goals together.
function ring(pct) {
  const r = 52, c = 2 * Math.PI * r, p = Math.min(100, pct);
  return `<svg class="save-ring" viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="${r}" class="ring-track"/>
    <circle cx="60" cy="60" r="${r}" class="ring-fill" stroke-dasharray="${c}" stroke-dashoffset="${c}" style="--to:${c * (1 - p / 100)}" transform="rotate(-90 60 60)"/>
  </svg>`;
}

function savingsStats(pots) {
  const entries = pots.flatMap(p => (p.entries || []).map(e => ({ ...e, pot: p })));
  const cur = periodOf(view.period === currentPeriodKey() ? view.period : currentPeriodKey());
  const net = pk => { const pp = periodOf(pk); return sum(entries.filter(e => { const d = fromISO(e.date); return d >= pp.start && d < pp.end; }), e => e.amount); };
  const thisMonth = net(cur.key);
  // streak: months in a row with more going in than out (this month counts once it has started)
  let streak = 0, k = thisMonth > 0 ? 0 : -1;
  while (streak < 60 && net(shiftPeriod(cur.key, k)) > 0) { streak++; k--; }
  const feed = entries.filter(e => !/starting balance/i.test(e.note || '')).sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0)).slice(0, 6);
  return { thisMonth, streak, feed };
}

export function savings() {
  const pots = S.list('pots');
  const byHand = pots.filter(p => !p.linkTo);
  const saveAccs = Off.savingsAccounts().filter(a => a.balance != null);
  const total = sum(byHand, potSaved) + sum(saveAccs, a => Math.max(0, a.balance));
  const goal = sum(pots, p => +p.goal || 0);
  const pct = goal ? (sum(pots, p => Math.min(potSaved(p), +p.goal || 0)) / goal) * 100 : 0;
  const reached = pots.filter(p => p.goal && potSaved(p) >= p.goal).length;
  const st = savingsStats(byHand);
  const lastMonthEnd = toISO(new Date(periodOf(currentPeriodKey()).start - 864e5));
  st.thisMonth += sum(saveAccs, a => { const b = Off.balanceOn(a, lastMonthEnd); return b == null ? 0 : a.balance - b; });
  const accs = S.list('accounts');
  return `<div class="grid">
    <section class="card save-hero">
      <div class="save-hero-ring">${ring(pct)}<div class="ring-label"><b>${goal ? Math.round(pct) + '%' : '🐷'}</b><small>${goal ? 'of goals' : 'start saving'}</small></div></div>
      <div class="save-hero-main">
        <span class="label">Total saved${saveAccs.length ? ` <small class="incl">incl. ${saveAccs.map(a => esc(a.name)).join(' & ')}</small>` : ''}</span>
        <div class="big" data-count="${round2(total)}">${money(total)}</div>
        <div class="save-chips">
          <span class="save-chip ${st.thisMonth > 0 ? 'up' : ''}">${st.thisMonth >= 0 ? '▲' : '▼'} ${money(Math.abs(st.thisMonth), { whole: true })} this month</span>
          ${st.streak ? `<span class="save-chip fire">🔥 ${st.streak}-month streak</span>` : ''}
          ${pots.length ? `<span class="save-chip">🏆 ${reached} of ${pots.filter(p => p.goal).length || pots.length} goals</span>` : ''}
        </div>
      </div>
    </section>
    ${saveAccs.map(growthCard).join('')}
    ${saveAccs.map(carveCard).join('')}
    <div class="section-title first"><span>Savings pots</span><span><button class="link" data-action="newPot">${icon('plus', 14)} New pot</button></span></div>
    <div class="pots">${pots.map(potCard).join('') || `<div class="card">${empty('🫙', 'No pots yet — start one for an Emergency fund, Holiday or Christmas and watch it fill up.', `<br><button class="btn primary sm" data-action="newPot">Start a pot</button>`)}</div>`}</div>
    ${st.feed.length ? `<div class="section-title"><span>Recent savings</span></div>
    <div class="card list save-feed">${st.feed.map(e => `<div class="feed-row">
      <span class="feed-ic" style="--c:${potColor(e.pot)}">${e.pot.icon || '🐷'}</span>
      <span class="feed-main">${e.by ? who(e.by) + ' ' : ''}${e.amount >= 0 ? 'added' : 'took'} <b>${money(Math.abs(e.amount))}</b> ${e.amount >= 0 ? 'to' : 'from'} ${esc(e.pot.name)}<small>${relDay(e.date)}${e.note ? ' · ' + esc(e.note) : ''}</small></span>
      <b class="${e.amount >= 0 ? 'pos' : ''}">${money(e.amount, { sign: true, whole: true })}</b></div>`).join('')}</div>` : ''}
    <div class="section-title"><span>Accounts</span><span><button class="link" data-action="newAccount">${icon('plus', 14)} Add account</button></span></div>
    <div class="pots">${accs.map(accountCard).join('') || `<div class="card">${empty('🏦', 'Add your offset account and credit card to track their balances.')}</div>`}</div>
  </div>`;
}

// ---- the offset as savings ----
function growthCard(a) {
  const pts = Off.series(a);
  const now = a.balance;
  const yStart = new Date(new Date().getFullYear(), 0, 1);
  const lastMonthEnd = toISO(new Date(periodOf(currentPeriodKey()).start - 864e5));
  const atMonth = Off.balanceOn(a, lastMonthEnd), atYear = Off.balanceOn(a, toISO(new Date(yStart - 864e5))) ?? pts[0]?.v;
  const flags = Off.crossings(pts);
  const next = Off.nextMilestone(now);
  const prevM = [...Off.MILESTONES].reverse().find(m => m <= now) || 0;
  const toNext = next ? ((now - prevM) / (next - prevM)) * 100 : 100;
  const interest = Off.interestSaved(a, yStart);
  const chip = (v, label) => v == null ? '' : `<span class="save-chip ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${money(Math.abs(v), { whole: true })} ${label}</span>`;
  return `<section class="card grow-card">
    <div class="grow-head"><div><span class="label">🏦 ${esc(a.name)}</span>
      <div class="big" data-count="${round2(now)}" data-count-key="grow-${a.id}">${money(now)}</div></div>
      <button class="link small" data-action="statement" data-id="${a.id}">📄 Statement</button></div>
    <div class="save-chips">${chip(atMonth == null ? null : now - atMonth, 'this month')}${chip(atYear == null ? null : now - atYear, 'this year')}
      ${interest ? `<span class="save-chip gold">💰 ${money(interest, { whole: true })} interest saved this year</span>` : ''}</div>
    ${pts.length >= 2 ? `<div class="chart">${growthChart(pts, { flags })}</div>` : `<p class="small muted">Your growth chart builds as balances come in — import a statement with a balance column, or tap Update now and then.</p>`}
    ${next ? `<div class="next-ms"><div class="next-ms-top"><span>Next milestone <b>${money(next, { whole: true })}</b></span><span>${money(next - now, { whole: true })} to go</span></div>
      <div class="bar"><i class="good" style="width:${Math.max(2, toNext)}%"></i></div></div>` : ''}
    ${flags.length ? `<div class="ms-done">${flags.slice(-4).reverse().map(f => `<span class="ms-badge">★ ${money(f.m, { whole: true })} <small>${fmtDate(f.date, { month: 'short', year: '2-digit' })}</small></span>`).join('')}</div>` : ''}
    ${!a.rate && a.kind === 'offset' ? `<p class="small muted">Add your home-loan rate (⚙️ on the account) to see the interest it saves.</p>` : ''}
  </section>`;
}

function carveCard(a) {
  const linked = Off.linkedPots(a.id);
  if (!linked.length) return a.kind === 'offset' ? `<section class="card carve-card empty-carve">
      <h2>Carve up your ${esc(a.name)}</h2>
      <p class="small">Split the balance into goals — an emergency fund, a holiday, Christmas. The jars fill on their own as the offset grows.</p>
      <button class="btn primary sm" data-action="newPot" data-link="${a.id}">＋ Add a goal to the offset</button></section>` : '';
  const al = Off.allocation(a.id);
  const total = al.balance || 1;
  const segs = [...linked.map(p => ({ p, v: al.map[p.id] || 0, color: potColor(p) })), { v: al.free, color: 'var(--line-2)', free: true }].filter(s => s.v > 0.004);
  return `<section class="card carve-card">
    <h2>Your ${esc(a.name)}, carved up</h2>
    <div class="carve-bar">${segs.map(s => `<i style="--w:${(s.v / total) * 100}%;background:${s.color}" data-tip="${s.free ? 'Free' : esc(s.p.name)}|${esc(money(s.v))}"></i>`).join('')}</div>
    <div class="carve-legend">${linked.map((p, i) => {
      const v = al.map[p.id] || 0, full = v >= (+p.goal || 0);
      return `<div class="carve-row"><i style="background:${potColor(p)}"></i><span>${i + 1}. ${p.icon || '🐷'} ${esc(p.name)}</span><b>${money(v, { whole: true })}</b><small>${full ? '✓ full' : `of ${money(p.goal, { whole: true })}`}</small></div>`;
    }).join('')}
      <div class="carve-row"><i style="background:var(--line-2)"></i><span>Free to use</span><b>${money(al.free, { whole: true })}</b><small></small></div></div>
    <button class="link small" data-action="newPot" data-link="${a.id}">＋ Add another goal</button>
  </section>`;
}

function linkedLine(p) {
  const acc = S.byId('accounts', p.linkTo);
  const list = Off.linkedPots(p.linkTo), i = list.findIndex(x => x.id === p.id);
  const saved = potSaved(p), goal = +p.goal || 0;
  const before = list.slice(0, i).find(x => potSaved(x) < (+x.goal || 0));
  const note = saved >= goal ? '' : before ? `Fills once ${esc(before.name)} is full` : `The next ${money(goal - saved, { whole: true })} the offset grows goes here`;
  return `<div class="linked-line"><span class="small">🏦 Part of ${esc(acc?.name || 'your offset')} · fills ${['1st', '2nd', '3rd'][i] || `${i + 1}th`}${note ? ` · ${note}` : ''}</span>
    ${i > 0 ? `<button class="btn sm ghost" data-action="potUp" data-id="${p.id}">↑ Fill sooner</button>` : ''}</div>`;
}

function potCard(p) {
  const saved = potSaved(p), goal = +p.goal || 0;
  const pct = potPct(p);
  const next = MILESTONES.find(m => pct < m);
  let pace = '';
  if (goal && saved >= goal) pace = '<p class="pot-done">🎉 Goal reached!</p>';
  else if (goal && p.targetDate) {
    const months = Math.max(1, (fromISO(p.targetDate) - new Date()) / (864e5 * 30.44));
    const by = fmtDate(p.targetDate, { month: 'short', year: 'numeric' });
    pace = `<p class="small">Save <b>${money((goal - saved) / months)}</b> a month to reach it by ${by}</p>`;
    // A linked goal only fills once the ones above it are full, so it really needs all of theirs too.
    if (p.linkTo) {
      const list = Off.linkedPots(p.linkTo), i = list.findIndex(x => x.id === p.id);
      const ahead = list.slice(0, i).filter(x => potSaved(x) < (+x.goal || 0));
      if (ahead.length) {
        const all = sum(ahead, x => (+x.goal || 0) - potSaved(x)) + goal - saved;
        pace += `<p class="small pace-all">Save <b>${money(all / months)}</b> a month to reach it by ${by} — including ${ahead.length === 1 ? 'the priority goal' : `${ahead.length} priority goals`} above it (${ahead.map(x => esc(x.name)).join(', ')})</p>`;
      }
    }
  } else if (goal && next) pace = `<p class="small">${money((goal * next) / 100 - saved)} to go until ${next}%</p>`;
  const cur = periodOf(currentPeriodKey());
  const shares = {};
  for (const e of p.entries || []) { const d = fromISO(e.date); if (d >= cur.start && d < cur.end && e.amount > 0 && e.by) shares[e.by] = (shares[e.by] || 0) + e.amount; }
  const shareLine = Object.keys(shares).length ? `<div class="pot-shares"><span class="small muted">This month:</span>${Object.entries(shares).sort((a, b) => b[1] - a[1]).map(([m, v]) =>
    `<span class="share" style="--c:${S.memberColor(m)}"><i></i>${esc(m)} <b>${money(v, { whole: true })}</b></span>`).join('')}</div>` : '';
  return `<section class="card pot" style="--pot:${potColor(p)}">
    <div class="pot-top">
      <div class="pot-jar">${jar(p)}<span class="pot-emoji">${p.icon || '🐷'}</span></div>
      <div class="pot-info">
        <button class="pot-name" data-action="editPot" data-id="${p.id}"><b>${esc(p.name)}</b>${icon('pen', 13)}</button>
        <div class="pot-amount">${money(saved)}</div>
        <small class="muted">${goal ? `of ${money(goal, { whole: true })} · <b class="pot-pct">${Math.round(pct)}%</b>` : 'No goal yet — tap the name to add one'}</small>
        ${goal ? `<div class="milestones">${MILESTONES.map(m => `<span class="ms ${pct >= m ? 'hit' : ''}" title="${m}%">${m === 100 ? '🏆' : m + '%'}</span>`).join('')}</div>` : ''}
      </div>
    </div>
    ${pace}
    ${shareLine}
    ${p.linkTo ? linkedLine(p) : `<div class="quick-add">${[20, 50, 100].map(a => `<button class="btn sm quick" data-action="potQuick" data-id="${p.id}" data-amt="${a}">+${money(a, { whole: true })}</button>`).join('')}
      <button class="btn sm" data-action="potIn" data-id="${p.id}">＋ Other</button>
      <button class="btn sm ghost" data-action="potOut" data-id="${p.id}" title="Take money out">−</button></div>`}
  </section>`;
}

// ---------- Family sync ----------
const SYNC_TEXT = {
  ok: ['ok', '✓ Up to date'], syncing: ['busy', 'Syncing…'], offline: ['warn', '● Offline — will sync when you are back online'],
  error: ['bad', '⚠ Sync problem'], signedout: ['warn', 'Signed out'], nohousehold: ['warn', 'Not in a household yet'], off: ['', ''],
};

export function syncDot() {
  if (!Sync.configured()) return '';
  const [cls, text] = SYNC_TEXT[Sync.status.state] || SYNC_TEXT.off;
  return `<a href="#settings" class="sync-dot ${cls}" title="Family sync: ${esc(text)}" aria-label="Family sync: ${esc(text)}"></a>`;
}

function syncCard() {
  const st = Sync.status, c = Sync.conf();
  const head = `<h2><span class="h-ic">${icon('sync', 18)} Family sync</span></h2>`;
  if (!Sync.configured()) {
    return `${head}
      <p class="small">Share one live budget with your partner. Changes either of you make show up on the other phone within seconds.</p>
      <p class="small muted">First create a free Supabase project and run <b>supabase/setup.sql</b> (see the README). Then paste its details here, or put them in <b>js/config.js</b> so neither of you has to type them.</p>
      <form class="form" data-form="syncConfig">
        <label class="field"><span>Project URL</span><input name="url" placeholder="https://xxxx.supabase.co" required autocomplete="off" inputmode="url"></label>
        <label class="field"><span>Anon / publishable key</span><input name="key" placeholder="eyJ… or sb_publishable_…" required autocomplete="off"></label>
        <div class="form-actions"><button class="btn primary" type="submit">Connect</button></div>
      </form>`;
  }
  if (st.state === 'off' || (st.state === 'error' && !st.email)) {
    return `${head}<p class="status bad">⚠ Couldn't reach Supabase${st.message ? ': ' + esc(st.message) : ''}</p>
      <div class="btn-row"><button class="btn" data-action="syncNow">Try again</button><button class="btn ghost" data-action="syncForget">Change project details</button></div>`;
  }
  if (st.state === 'signedout') {
    return `${head}
      <p class="small">Each of you signs in with <b>your own</b> email and password.</p>
      <form class="form" data-form="syncSignIn">
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
        <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" minlength="8" required></label>
        <div class="btn-row"><button class="btn primary" type="submit">Sign in</button><button class="btn" type="button" data-action="syncSignUp">Create my login</button></div>
      </form>
      <p class="small muted">New here? Tap <b>Create my login</b>, then confirm the email Supabase sends you.</p>
      <div class="btn-row"><button class="btn sm ghost" data-action="syncForget">Change project details</button></div>`;
  }
  if (st.state === 'nohousehold') {
    return `${head}
      <p class="small">Signed in as <b>${esc(st.email)}</b>.</p>
      <div class="sync-choice">
        <div><b>First of you to set up?</b><p class="small muted">Uploads everything on this phone and gives you a code for your partner.</p>
          <button class="btn primary" data-action="syncCreate">Start our household</button></div>
        <form class="form" data-form="syncJoin"><b>Partner already set up?</b><p class="small muted">Enter the code from their Settings. This phone then shows the household's data.</p>
          <input name="code" placeholder="Join code e.g. 4F9A21C7" required autocomplete="off" autocapitalize="characters" maxlength="8">
          <button class="btn" type="submit">Join household</button></form>
      </div>
      <div class="btn-row"><button class="btn sm ghost" data-action="syncSignOut">Sign out</button></div>`;
  }
  const [cls, text] = SYNC_TEXT[st.state] || SYNC_TEXT.ok;
  const ago = c.lastSync ? Math.round((Date.now() - c.lastSync) / 60000) : null;
  return `${head}
    <p class="status ${cls}">${text}${st.state === 'ok' && ago !== null ? ` · ${ago < 1 ? 'just now' : ago + ' min ago'}` : ''}${st.state === 'error' && st.message ? ': ' + esc(st.message) : ''}</p>
    <p class="small">Household <b>${esc(c.householdName || S.settings().householdName)}</b> · signed in as <b>${esc(st.email)}</b></p>
    ${c.joinCode ? `<div class="join-code"><small>Partner's join code</small><b>${esc(c.joinCode)}</b><button class="btn sm" data-action="copyJoinCode" data-code="${esc(c.joinCode)}">Copy</button></div>` : ''}
    <div class="btn-row"><button class="btn" data-action="syncNow">${icon('sync', 16)} Sync now</button><button class="btn ghost" data-action="syncSignOut">Sign out</button></div>`;
}

// ---------- Settings ----------
export function settingsView() {
  const s = S.settings();
  const members = [...s.members, ''];
  return `<div class="grid cols">
  <section class="card">
    <h2>Household</h2>
    <form class="form" data-form="settings">
      <label class="field"><span>Household name</span><input name="householdName" value="${esc(s.householdName)}" required></label>
      <div class="field"><span>People and their colours</span>${members.map((m, i) => {
        const col = s.memberColors[m] || S.PERSON_COLOURS[i % S.PERSON_COLOURS.length];
        return `<div class="person-row">
          <input name="member${i}" value="${esc(m)}" placeholder="${i < 2 ? 'Name' : 'Add another person (optional)'}" aria-label="Person ${i + 1}">
          <div class="swatches" role="radiogroup" aria-label="Colour for person ${i + 1}">${S.PERSON_COLOURS.map(c => `<label><input type="radio" name="color${i}" value="${c}" ${c === col ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div>
        </div>`;
      }).join('')}</div>
      <label class="field"><span>Who uses this phone / laptop? <small class="muted">— payments added here are tagged with this person</small></span><select name="currentMember">${s.members.map(m => `<option ${m === s.currentMember ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
      <div class="row2">
        <label class="field"><span>Month starts on day</span><input name="monthStartDay" type="number" min="1" max="28" value="${s.monthStartDay}"><small class="muted">Set to payday (e.g. 28) to budget payday-to-payday</small></label>
        <label class="field"><span>Currency</span><select name="currency">${Object.keys(S.CURRENCIES).map(c => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      </div>
      <div class="field"><span>Appearance</span><div class="seg">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<label><input type="radio" name="theme" value="${v}" ${s.theme === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
      <div class="form-actions"><button class="btn primary" type="submit">Save settings</button></div>
    </form>
  </section>
  <section class="card">
    ${syncCard()}
    <h2 class="mt">Bill reminders</h2>
    ${canNotify() ? (remindersOn() ? `<p class="small">🔔 On for this device — a notification the day before and the day a bill is due.</p>
      <div class="btn-col"><button class="btn" data-action="remindersOff">Turn reminders off</button></div>`
      : `<p class="small muted">Get a notification the day before and the day a bill is due. Each phone turns this on for itself.</p>
      <div class="btn-col"><button class="btn" data-action="remindersOn">🔔 Turn on bill reminders</button></div>`) : '<p class="small muted">This browser can\'t show notifications.</p>'}
    <h2 class="mt">Sorting</h2>
    <div class="btn-col"><button class="btn" data-action="rules">🏷️ Category rules <small class="muted">— e.g. “BWS” → Alcohol</small></button></div>
    <h2 class="mt">Your data</h2>
    <div class="btn-col">
      <button class="btn" data-action="exportBackup">${icon('download', 18)} Back up (download file)</button>
      <label class="btn">${icon('upload', 18)} Restore from backup<input type="file" accept=".json,application/json" hidden data-change="restoreBackup"></label>
      <button class="btn" data-action="exportCsv">${icon('download', 18)} Export payments to CSV / Excel</button>
      <button class="btn" data-action="importCsv">${icon('upload', 18)} Import a bank statement (CSV)</button>
      <button class="btn" data-action="loadDemo">✨ Load demo data</button>
      <button class="btn danger" data-action="wipeAll">${icon('x', 18)} Erase everything on this device</button>
    </div>
    <p class="small muted mt">C.A.S.H — Control All Spending Habits · v1.0</p>
  </section></div>`;
}
