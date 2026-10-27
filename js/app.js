// C.A.S.H — Control All Spending Habits. App shell: routing, events, startup.
import * as S from './store.js';
import { $, $$, shiftPeriod, todayISO, download, esc } from './util.js';
import { view, resetPeriod, icon, toast, closeSheet, openSheet, countUp } from './ui.js';
import * as V from './views.js';
import * as Sheets from './sheets.js';
import * as Flows from './flows.js';
import { demoState } from './demo.js';
import { thisYear } from './year.js';
import { showWrapped, maybeShowWrapped } from './wrapped.js';
import * as Remind from './reminders.js';
import * as Sync from './sync.js';

const actions = {
  ...Sheets.actions,
  ...Flows.actions,
  closeSheet: () => closeSheet(),
  prevPeriod: () => { view.period = shiftPeriod(view.period, -1); render(); },
  nextPeriod: () => { view.period = shiftPeriod(view.period, 1); render(); },
  thisPeriod: () => { resetPeriod(); render(); },
  pieDrill: el => { view.pieMode = 'categories'; view.pieGroup = el.dataset.id; render(); },
  moneyIn: () => openSheet(V.moneyInSheet()),
  cardSheet: el => openSheet(V.cardSheet(S.byId('accounts', el.dataset.id))),
  wrapped: el => showWrapped(el.dataset.key),
  remindersOn: el => busyButton(el, async () => {
    const daily = await Remind.turnOn();
    toast(daily ? '🔔 Reminders on — C.A.S.H will check your bills about once a day' : '🔔 Reminders on — you\'ll get them when you open C.A.S.H');
    render();
  }),
  remindersOff: async () => { await Remind.turnOff(); toast('Reminders off'); render(); },
  prevYear: () => { view.year = (view.year ?? thisYear()) - 1; render(); },
  nextYear: () => { view.year = (view.year ?? thisYear()) + 1; render(); },
  thisYear: () => { view.year = thisYear(); render(); },
  openMonth: el => { view.period = el.dataset.key; location.hash = '#home'; window.scrollTo(0, 0); },
  spendList: el => openSheet(V.spendSheet(el.dataset.kind, el.dataset.id)),
  pieDrillFromSheet: el => { closeSheet(); view.pieMode = 'categories'; view.pieGroup = el.dataset.id; setTimeout(render, 60); },
  catActivity: el => {
    view.filters = { type: 'out', q: '', categoryId: el.dataset.id, member: '' };
    closeSheet();
    setTimeout(() => { location.hash = '#activity'; }, 60);
  },
  moneyInActivity: () => {
    view.filters = { type: 'in', q: '', categoryId: '', member: '' };
    closeSheet();
    // closing the sheet steps history back first; move on once that has landed
    setTimeout(() => { location.hash = '#activity'; }, 60);
  },
  pieRest: () => { view.pieRestOpen = !view.pieRestOpen; render(); },
  pieBack: () => { view.pieMode = 'areas'; view.pieGroup = null; render(); },
  exportBackup: () => {
    download(`cash-backup-${todayISO()}.json`, JSON.stringify(S.getState(), null, 1));
    toast('Backup downloaded');
  },
  exportCsv: () => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Date', 'Type', 'Description', 'Category', 'Amount', 'Who', 'Note', 'Source']];
    for (const t of S.list('transactions').sort((a, b) => a.date.localeCompare(b.date))) {
      if (t.splits?.length > 1) t.splits.forEach(s => rows.push([t.date, t.type, t.desc, S.cat(s.categoryId).name, s.amount, t.member, t.note, t.source]));
      else rows.push([t.date, t.type, t.desc, S.cat(t.categoryId).name, t.amount, t.member, t.note, t.source]);
    }
    download(`cash-payments-${todayISO()}.csv`, rows.map(r => r.map(q).join(',')).join('\n'), 'text/csv');
  },
  loadDemo: () => {
    if (Sync.conf().householdId) return toast('Demo data is off while family sync is on — it would be shared with your partner');
    if (!confirm('Replace everything on this device with demo data?')) return;
    S.setState(demoState({ ...S.settings() }));
    toast('Demo data loaded');
  },
  syncSignUp: async el => {
    const f = el.form;
    if (!f.reportValidity()) return;
    await busyButton(el, async () => {
      const confirmFirst = await Sync.signUp(f.email.value, f.password.value);
      toast(confirmFirst ? 'Check your email and tap the link to confirm, then sign in here' : 'Login created');
    });
  },
  syncCreate: async el => busyButton(el, async () => {
    const h = await Sync.createHousehold();
    toast(`Household created — share code ${h.join_code} with your partner`);
  }),
  syncNow: () => Sync.syncNow(),
  syncSignOut: async () => {
    if (!confirm('Sign out of family sync on this device? Your data stays on this phone.')) return;
    await Sync.signOut();
  },
  syncForget: () => {
    if (!confirm('Remove the Supabase details from this device?')) return;
    Sync.setCredentials('', '');
    Sync.start();
    render();
  },
  copyJoinCode: async el => {
    try { await navigator.clipboard.writeText(el.dataset.code); toast('Join code copied'); } catch { toast(el.dataset.code); }
  },
  wipeAll: () => {
    if (!confirm('Erase ALL C.A.S.H data on this device? Download a backup first if you want to keep it.')) return;
    if (!confirm('Really erase everything? This cannot be undone.')) return;
    S.wipe();
    Sync.forgetHousehold();
    location.hash = '#home';
    location.reload();
  },
};

const forms = {
  ...Sheets.forms,
  ...Flows.forms,
  settings: d => {
    const s = S.settings();
    const rows = Object.keys(d).filter(k => /^member\d+$/.test(k))
      .map(k => ({ i: +k.slice(6), name: d[k].trim(), color: d['color' + k.slice(6)] }));
    const members = rows.map(r => r.name).filter(Boolean);
    if (!members.length) return toast('Add at least one person');
    // Renaming someone carries their payments, bills and balance updates across.
    const renames = {};
    rows.forEach(r => { const old = s.members[r.i]; if (old && r.name && old !== r.name) renames[old] = r.name; });
    if (Object.keys(renames).length) {
      const st = S.getState();
      const fix = (o, key) => { if (renames[o[key]]) { o[key] = renames[o[key]]; o.updatedAt = Date.now(); } };
      st.transactions.forEach(t => fix(t, 'member'));
      st.incomes.forEach(i => fix(i, 'member'));
      st.bills.forEach(b => fix(b, 'payer'));
      st.accounts.forEach(a => (a.history || []).forEach(h => { if (renames[h.by]) { h.by = renames[h.by]; a.updatedAt = Date.now(); } }));
    }
    const memberColors = {};
    rows.forEach(r => { if (r.name) memberColors[r.name] = r.color || S.PERSON_COLOURS[r.i % S.PERSON_COLOURS.length]; });
    const current = renames[d.currentMember] || d.currentMember;
    Object.assign(s, {
      householdName: d.householdName.trim(), members, memberColors,
      currentMember: members.includes(current) ? current : members[0],
      monthStartDay: Math.min(28, Math.max(1, +d.monthStartDay || 1)),
      currency: d.currency, locale: S.CURRENCIES[d.currency] || 'en-AU', theme: d.theme,
    });
    s.sharedUpdatedAt = Date.now();
    applyTheme();
    resetPeriod();
    S.save();
    toast('Settings saved');
  },
  syncConfig: d => {
    if (!/^https:\/\/.+/.test(d.url.trim())) return toast('The Project URL should start with https://');
    Sync.setCredentials(d.url, d.key);
    Sync.start();
    render();
  },
  syncSignIn: async (d, f) => busyButton(f.querySelector('[type=submit]'), async () => {
    await Sync.signIn(d.email, d.password);
    toast('Signed in');
  }),
  syncJoin: async (d, f) => {
    if (!confirm("Joining replaces what's on this phone with your household's shared data. Carry on?")) return;
    await busyButton(f.querySelector('[type=submit]'), async () => {
      const h = await Sync.joinHousehold(d.code);
      toast(`Joined ${h.name} — now pick who uses this phone`);
    });
  },
  welcome: d => {
    const members = [d.me.trim() || 'Me', d.partner.trim()].filter(Boolean);
    const settings = { householdName: d.householdName.trim(), members, currentMember: members[0], monthStartDay: Math.min(28, Math.max(1, +d.monthStartDay || 1)) };
    S.setState(d.start === 'demo' ? demoState(settings) : S.blankState(settings));
    resetPeriod();
    closeSheet();
    render();
    toast(d.start === 'demo' ? 'Demo data loaded — explore away!' : 'All set — start by adding your wages and bills');
    if (d.start !== 'demo') location.hash = '#plan/wages';
  },
};

const changes = {
  pieMode: el => {
    view.pieMode = el.value; view.pieGroup = null;
    try { localStorage.setItem('cash.pieMode', el.value); } catch {}
    render();
  },
  yearKind: el => {
    view.yearKind = el.value; view.year = thisYear(el.value);
    try { localStorage.setItem('cash.yearKind', el.value); } catch {}
    render();
  },
  yearView: el => {
    view.yearView = el.value;
    try { localStorage.setItem('cash.yearView', el.value); } catch {}
    render();
  },
  filterType: el => { view.filters.type = el.value; $('#tx-list').innerHTML = V.txList(); },
  filterScope: el => { view.filters.scope = el.value; $('#tx-list').innerHTML = V.txList(); },
  filterCat: el => { view.filters.categoryId = el.value; $('#tx-list').innerHTML = V.txList(); },
  filterMember: el => { view.filters.member = el.value; $('#tx-list').innerHTML = V.txList(); },
  restoreBackup: async el => {
    const file = el.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.categories || !data.transactions) throw new Error('not a C.A.S.H backup');
      if (!confirm(`Restore this backup (${data.transactions.filter(t => !t.deleted).length} payments)? It replaces what's on this device.`)) return;
      if (Sync.conf().householdId) return toast('Restoring is off while family sync is on — your data already syncs');
      S.setState(data);
      applyTheme();
      toast('Backup restored');
    } catch (e) { toast('Could not restore: ' + e.message); }
  },
};

// Run a slow action with the button showing it's busy; errors become a toast.
async function busyButton(btn, fn) {
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = 'Please wait…'; }
  try { await fn(); } catch (e) { console.warn(e); toast(e.message || String(e)); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
}

// ---------- rendering ----------
function route() {
  const [r, sub] = (location.hash.slice(1) || 'home').split('/');
  return { r: V.TITLES[r] ? r : 'home', sub };
}

let lastRoute = '';
function render() {
  if (!S.getState()) return;
  const { r, sub } = route();
  if (r !== lastRoute) V.replayPie(); // coming back to Home plays the pie again
  lastRoute = r;
  if (r === 'plan' && sub) view.planTab = sub;
  $('#topbar').innerHTML = V.topbar(r);
  const main = $('#view');
  const scroll = window.scrollY;
  main.innerHTML = r === 'activity' ? V.activity() : r === 'plan' ? V.plan(sub || view.planTab)
    : r === 'savings' ? V.savings() : r === 'settings' ? V.settingsView() : V.home();
  window.scrollTo(0, scroll);
  countUp(main);
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === r));
  document.title = r === 'home' ? 'C.A.S.H' : `${V.TITLES[r]} · C.A.S.H`;
}

function buildNav() {
  const links = V.NAV.map(([id, label, ic]) => `<a href="#${id}" data-nav="${id}">${icon(ic)}<span>${label}</span></a>`);
  $('#side-nav').innerHTML = links.join('') + `<a href="#settings" data-nav="settings">${icon('gear')}<span>Settings</span></a>`;
  $('#bottom-nav').innerHTML = links.slice(0, 2).join('') +
    `<button class="fab-slot" data-action="openAdd" aria-label="Add"><span class="fab">${icon('plus', 28)}</span></button>` + links.slice(2).join('');
}

function applyTheme() {
  const t = S.getState()?.settings.theme || 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

// ---------- events ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const fd = new FormData(f);
  forms[f.dataset.form]?.(Object.fromEntries(fd), f);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el) changes[el.dataset.change]?.(el);
});
document.addEventListener('input', e => {
  if (e.target.dataset.input === 'search') { view.filters.q = e.target.value; $('#tx-list').innerHTML = V.txList(); }
});
window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (handleShortcut(h)) return;
  render();
  window.scrollTo(0, 0);
});

// App shortcuts (long-press the icon on Android) and shared screenshots.
function handleShortcut(h) {
  if (!['add', 'scan', 'shared', 'import'].includes(h)) return false;
  history.replaceState(null, '', '#home');
  render();
  if (h === 'add') Sheets.addMenu();
  if (h === 'scan') Flows.startScan('receipt');
  if (h === 'import') Flows.actions.importCsv();
  if (h === 'shared') openShared();
  return true;
}

async function openShared() {
  try {
    const cache = await caches.open('cash-share');
    const res = await cache.match('shared-image');
    if (!res) return;
    const blob = await res.blob();
    await cache.delete('shared-image');
    const file = new File([blob], 'shared.png', { type: blob.type });
    openSheet(`<div class="sheet-head"><div><h2>What is this picture?</h2></div><button class="icon-btn" data-action="closeSheet" aria-label="Close">${icon('x')}</button></div>
      <div class="add-grid two"><button class="add-tile" id="sh-r"><span class="add-ic gold">${icon('camera')}</span><b>A receipt</b><small>Split it by category</small></button>
      <button class="add-tile" id="sh-s"><span class="add-ic gold">${icon('phone')}</span><b>Banking screenshot</b><small>Pick out each payment</small></button></div>`, {
      onMount: sh => {
        $('#sh-r', sh).onclick = () => Flows.startScan('receipt', file);
        $('#sh-s', sh).onclick = () => Flows.startScan('screenshot', file);
      },
    });
  } catch (e) { console.error(e); }
}

// ---------- start ----------
const firstRun = !S.load();
if (firstRun) S.setState(S.blankState());
applyTheme();
buildNav();
resetPeriod();
S.subscribe(render);
S.subscribe(() => Sync.schedule());
// Sync status only redraws the screen when you're looking at Settings (so typing isn't interrupted).
Sync.onStatus(() => {
  if (!S.getState()) return;
  const { r } = route();
  if (r === 'settings' && !document.activeElement?.closest?.('#view form')) render();
  else $('#topbar').innerHTML = V.topbar(r);
});
Sync.start();
if (!handleShortcut(location.hash.slice(1))) render();
if (firstRun) Sheets.welcome();
else maybeShowWrapped();
Remind.watch();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err));
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
