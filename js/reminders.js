// Bill reminders. A web app can't book an exact-time notification without a
// push server, so: (1) check when the app opens, and (2) on Android Chrome,
// ask for "periodic background sync" so the service worker can check about
// once a day. The app keeps a small list of upcoming bills in a cache the
// service worker can read (it can't see localStorage).
import * as S from './store.js';
import { toISO, addDays, periodOf, shiftPeriod, currentPeriodKey, money } from './util.js';
import { billsInPeriod } from './calc.js';

const KEY = 'cash.reminders';
export const remindersOn = () => { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } };
export const canNotify = () => 'Notification' in window && 'serviceWorker' in navigator;

// Unpaid bills due in the next week.
export function upcomingBills() {
  const today = toISO(new Date()), week = toISO(addDays(new Date(), 7));
  const cur = currentPeriodKey();
  return [cur, shiftPeriod(cur, 1)].flatMap(k => billsInPeriod(periodOf(k)))
    .filter(r => !r.done && r.date >= today && r.date <= week)
    .map(r => ({ id: `${r.item.id}:${r.date}`, name: r.item.name, amount: money(r.item.amount), date: r.date }));
}

// Hand the list to the service worker.
export async function shareWithWorker() {
  if (!remindersOn() || !('caches' in window)) return;
  try {
    const c = await caches.open('cash-meta');
    await c.put('reminders.json', new Response(JSON.stringify(upcomingBills()), { headers: { 'content-type': 'application/json' } }));
  } catch {}
}

// Notify about bills due today or tomorrow that haven't been mentioned yet.
export async function checkNow() {
  if (!remindersOn() || !canNotify() || Notification.permission !== 'granted') return;
  await shareWithWorker();
  const reg = await navigator.serviceWorker.ready;
  reg.active?.postMessage({ type: 'check-bills' });
}

export async function turnOn() {
  if (!canNotify()) throw new Error("This browser can't show notifications");
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked — allow them for C.A.S.H in your phone settings');
  try { localStorage.setItem(KEY, 'on'); } catch {}
  const reg = await navigator.serviceWorker.ready;
  let daily = false;
  try {
    if ('periodicSync' in reg) {
      const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (st.state === 'granted') { await reg.periodicSync.register('bill-reminders', { minInterval: 12 * 3600e3 }); daily = true; }
    }
  } catch {}
  await checkNow();
  return daily;
}

export async function turnOff() {
  try { localStorage.removeItem(KEY); } catch {}
  try { const reg = await navigator.serviceWorker.ready; await reg.periodicSync?.unregister('bill-reminders'); } catch {}
}

// Keep the worker's list fresh as bills change (at most every few seconds).
let timer;
export function watch() {
  S.subscribe(() => { clearTimeout(timer); timer = setTimeout(shareWithWorker, 3000); });
  checkNow();
}
