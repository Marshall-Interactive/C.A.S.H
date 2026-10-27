// Family sync through Supabase. Each phone keeps its full copy of the data
// (so the app works offline) and swaps changes with the household's shared
// database: push what changed here, pull what changed elsewhere, and listen
// live for the other phone's edits. The newest edit of a record wins.
import * as S from './store.js';
import { loadScript } from './util.js';
import { CONFIG } from './config.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const COLLS = ['categories', 'groups', 'transactions', 'bills', 'incomes', 'pots', 'accounts'];
// Settings shared by the household; theme and "who uses this phone" stay per device.
const SHARED = ['householdName', 'members', 'memberColors', 'currency', 'locale', 'monthStartDay', 'noSpendCats'];
const LS = 'cash.sync';

let sb = null, channel = null, timer = null, busy = false, again = false;
export const status = { state: 'off', message: '', email: '' };
const listeners = new Set();
export const onStatus = fn => listeners.add(fn);
function setStatus(state, message = '') {
  Object.assign(status, { state, message });
  listeners.forEach(fn => fn());
}

// Sync bookkeeping is per device, so it lives outside the backed-up data.
export function conf() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } }
function saveConf(patch) { localStorage.setItem(LS, JSON.stringify({ ...conf(), ...patch })); }

export function credentials() {
  const c = conf();
  return { url: (c.url || CONFIG.supabaseUrl || '').trim(), key: (c.key || CONFIG.supabaseKey || '').trim() };
}
export const configured = () => { const { url, key } = credentials(); return !!(url && key); };
export const connected = () => configured() && !!conf().householdId && !!status.email;

export function setCredentials(url, key) {
  saveConf({ url: url.trim().replace(/\/+$/, ''), key: key.trim() });
  sb = null;
}

async function client() {
  if (sb) return sb;
  const { url, key } = credentials();
  if (!url || !key) throw new Error('Family sync is not set up yet');
  await loadScript(LIB);
  sb = window.supabase.createClient(url, key, { auth: { persistSession: true, storageKey: 'cash-auth', autoRefreshToken: true } });
  sb.auth.onAuthStateChange((event, session) => {
    status.email = session?.user?.email || '';
    if (event === 'SIGNED_OUT') { stopRealtime(); setStatus('signedout'); }
  });
  return sb;
}

// ---------- starting up ----------
export async function start() {
  if (!configured()) return setStatus('off');
  try {
    const c = await client();
    const { data: { session } } = await c.auth.getSession();
    status.email = session?.user?.email || '';
    if (!session) return setStatus('signedout');
    if (!conf().householdId) {
      // Signing back in on a phone that was in a household before: pick it up again.
      const { data } = await c.from('households').select('id,name,join_code').limit(2);
      if (data?.length !== 1) return setStatus('nohousehold');
      // The household's copy wins over whatever is on this phone.
      saveConf({ householdId: data[0].id, householdName: data[0].name, joinCode: data[0].join_code, lastPush: Date.now(), lastPulled: null });
    }
    startRealtime();
    await syncNow();
  } catch (e) {
    setStatus(navigator.onLine ? 'error' : 'offline', e.message || String(e));
  }
}

export async function signIn(email, password) {
  const c = await client();
  const { error } = await c.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  await start();
}

// Returns true when Supabase wants the email address confirmed first.
export async function signUp(email, password) {
  const c = await client();
  const { data, error } = await c.auth.signUp({
    email: email.trim(), password,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
  if (!data.session) return true;
  await start();
  return false;
}

// Leave the household on this device only (used by "Erase everything").
export function forgetHousehold() {
  stopRealtime();
  saveConf({ householdId: null, householdName: null, joinCode: null, lastPush: 0, lastPulled: null });
}

export async function signOut() {
  const c = await client();
  stopRealtime();
  await c.auth.signOut();
  saveConf({ householdId: null, householdName: null, joinCode: null, lastPush: 0, lastPulled: null });
  setStatus('signedout');
}

// The first person starts the household: everything on this phone is uploaded.
export async function createHousehold() {
  const c = await client();
  const { data, error } = await c.rpc('create_household', { hh_name: S.settings().householdName });
  if (error) throw error;
  const st = S.getState();
  st.settings.sharedUpdatedAt = Date.now();
  st.rulesUpdatedAt = Date.now();
  S.save();
  saveConf({ householdId: data.id, householdName: data.name, joinCode: data.join_code, lastPush: 0, lastPulled: null });
  await start();
  return data;
}

// The second person joins: this phone's data is replaced with the household's.
export async function joinHousehold(code) {
  const c = await client();
  const { data, error } = await c.rpc('join_household', { code });
  if (error) throw error;
  const st = S.getState();
  COLLS.forEach(k => { st[k] = []; });
  st.rules = {};
  st.rulesUpdatedAt = 0;
  st.settings.sharedUpdatedAt = 0;
  saveConf({ householdId: data.id, householdName: data.name, joinCode: data.join_code, lastPush: Date.now(), lastPulled: null });
  await start();
  return data;
}

// ---------- the sync itself ----------
export function schedule(delay = 1500) {
  if (!connected()) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

export async function syncNow() {
  if (!configured() || !conf().householdId) return;
  if (busy) { again = true; return; }
  busy = true;
  setStatus('syncing');
  try {
    await client();
    await push();
    await pull();
    saveConf({ lastSync: Date.now() });
    setStatus('ok');
  } catch (e) {
    console.warn('sync', e);
    setStatus(navigator.onLine ? 'error' : 'offline', e.message || String(e));
  } finally {
    busy = false;
    if (again) { again = false; schedule(300); }
  }
}

const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));

// Everything changed on this phone since the last successful push.
export function changedRows(st, since) {
  const rows = [];
  for (const coll of COLLS) {
    for (const x of st[coll] || []) {
      if ((x.updatedAt || 0) > since || (!x.updatedAt && !since)) {
        rows.push({ coll, id: x.id, data: x, updated_at: x.updatedAt || Date.now(), deleted: !!x.deleted });
      }
    }
  }
  if ((st.settings.sharedUpdatedAt || 0) > since) {
    rows.push({ coll: 'settings', id: 'main', data: pick(st.settings, SHARED), updated_at: st.settings.sharedUpdatedAt, deleted: false });
  }
  if ((st.rulesUpdatedAt || 0) > since) {
    rows.push({ coll: 'rules', id: 'main', data: st.rules, updated_at: st.rulesUpdatedAt, deleted: false });
  }
  return rows;
}

async function push() {
  const { householdId, lastPush = 0 } = conf();
  const started = Date.now();
  const rows = changedRows(S.getState(), lastPush);
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await sb.rpc('push_records', { hh: householdId, rows: rows.slice(i, i + 300) });
    if (error) throw error;
  }
  saveConf({ lastPush: started });
}

async function pull() {
  const { householdId, lastPulled } = conf();
  const full = !lastPulled;
  // overlap by a few seconds so a slow write is never skipped (applying twice is harmless)
  const since = full ? '1970-01-01T00:00:00Z' : new Date(new Date(lastPulled).getTime() - 5000).toISOString();
  let from = 0, newest = lastPulled, changed = false;
  for (;;) {
    const { data, error } = await sb.from('records')
      .select('coll,id,data,updated_at,deleted,server_ts')
      .eq('household_id', householdId).gt('server_ts', since)
      .order('server_ts').range(from, from + 999);
    if (error) throw error;
    for (const r of data) { if (apply(S.getState(), r, full)) changed = true; newest = r.server_ts; }
    if (data.length < 1000) break;
    from += 1000;
  }
  saveConf({ lastPulled: newest || new Date().toISOString() });
  if (changed) S.save();
}

// Merge one row from the server into local data. Returns true if anything changed.
export function apply(st, r, force = false) {
  const ts = +r.updated_at;
  if (r.coll === 'settings') {
    if (!force && (st.settings.sharedUpdatedAt || 0) >= ts) return false;
    Object.assign(st.settings, pick(r.data, SHARED), { sharedUpdatedAt: ts });
    S.ensureColours(st.settings);
    if (!st.settings.members.includes(st.settings.currentMember)) st.settings.currentMember = st.settings.members[0];
    return true;
  }
  if (r.coll === 'rules') {
    if (!force && (st.rulesUpdatedAt || 0) >= ts) return false;
    st.rules = { ...st.rules, ...r.data };
    st.rulesUpdatedAt = ts;
    return true;
  }
  const arr = st[r.coll];
  if (!arr) return false;
  const i = arr.findIndex(x => x.id === r.id);
  if (i >= 0 && !force && (arr[i].updatedAt || 0) >= ts) return false;
  const rec = { ...r.data, updatedAt: ts, deleted: !!r.deleted };
  if (i >= 0) arr[i] = rec; else arr.push(rec);
  return true;
}

// ---------- live updates from the other phone ----------
function startRealtime() {
  if (channel || !sb) return;
  const hh = conf().householdId;
  channel = sb.channel('cash-' + hh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `household_id=eq.${hh}` }, payload => {
      if (payload.new?.coll && apply(S.getState(), payload.new)) {
        S.save();
        saveConf({ lastSync: Date.now() });
        setStatus('ok');
      }
    })
    .subscribe();
}
function stopRealtime() {
  if (channel && sb) sb.removeChannel(channel);
  channel = null;
}

window.addEventListener('online', () => syncNow());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
