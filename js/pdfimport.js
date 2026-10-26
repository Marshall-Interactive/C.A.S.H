// Reading bank statements saved as PDF. PDFs are laid out for printing, so this
// is best-effort: rebuild the text lines from where words sit on the page, then
// find lines that start with a date and carry amounts. The running balance
// (when the statement has one) tells us whether money went in or out.
import { loadScript, parseDate, parseAmount, round2, todayISO, toISO, addDays } from './util.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

export async function pdfLines(file) {
  await loadScript(PDFJS);
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = WORKER;
  let doc;
  try {
    doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new Error('this PDF is password-protected — save an unlocked copy or use the CSV export');
    throw e;
  }
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const rows = [];
    for (const it of (await page.getTextContent()).items) {
      const s = it.str.trim();
      if (!s) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find(r => Math.abs(r.y - y) < 3);
      if (!row) rows.push(row = { y, items: [] });
      row.items.push({ x, w: it.width, s });
    }
    rows.sort((a, b) => b.y - a.y).forEach(r => {
      r.items.sort((a, b) => a.x - b.x);
      lines.push({ page: p, items: r.items, text: r.items.map(i => i.s).join(' ') });
    });
  }
  return lines;
}

const MONEY = /^\(?[-−]?\$?\d{1,3}(,\d{3})*\.\d{2}\)?(CR|DR|-)?$/i;
const DATE_START = /^(\d{1,2}[/.\-]\d{1,2}(?:[/.\-]\d{2,4})?|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{4})?)\b/;
const OPENING = /opening balance|brought forward|balance b\/f/i;
const CLOSING = /closing balance|carried forward|balance c\/f/i;

function money(item) {
  const s = item.s.replace(/\s/g, '');
  const neg = /^[-−(]|-$|DR$/i.test(s);
  return { v: Math.abs(parseAmount(s.replace(/CR|DR/gi, '').replace(/[-−]$/, '').replace('−', '-'))), neg, cr: /CR$/i.test(s), x: item.x + item.w, item };
}

function withYear(d, year) {
  if (/\d{4}$|[/.\-]\d{2}$/.test(d) || !year) return d;
  return /^\d{1,2}[/.\-]\d{1,2}$/.test(d) ? `${d}/${year}` : `${d} ${year}`;
}

// credit: true for a credit-card statement (credits/payments marked CR or "-").
export function parsePdfStatement(lines, { credit = false } = {}) {
  let cols = null, prevBal = null, closing = null, year = null;
  for (const l of lines) {
    const m = l.text.match(/\b(?:to|period|ending|end date)\b[^\n]*?\b(20\d{2})\b/i);
    if (m) { year = +m[1]; break; }
  }
  const raw = [];
  let cur = null;
  for (const l of lines) {
    const t = l.text, low = t.toLowerCase();
    if (/(debit|withdrawal)/.test(low) && /(credit|deposit)/.test(low) && /balance/.test(low)) {
      const edge = re => { const it = l.items.find(i => re.test(i.s)); return it ? it.x + it.w : null; };
      cols = { debit: edge(/debit|withdrawal/i), credit: edge(/credit|deposit/i), balance: edge(/balance/i) };
      cur = null;
      continue;
    }
    const amts = l.items.filter(i => MONEY.test(i.s.replace(/\s/g, '')));
    if (OPENING.test(t) && amts.length) { const n = money(amts[amts.length - 1]); prevBal ??= n.neg ? -n.v : n.v; cur = null; continue; }
    if (CLOSING.test(t) && amts.length) { const n = money(amts[amts.length - 1]); closing = n.neg ? -n.v : n.v; cur = null; continue; }
    const dm = t.match(DATE_START);
    let date = dm && parseDate(withYear(dm[1], year));
    if (date && date > toISO(addDays(new Date(), 7))) date = parseDate(withYear(dm[1], (year || new Date().getFullYear()) - 1));
    const strip = s => { amts.forEach(a => { s = s.replace(a.s, ''); }); return s.replace(/\s+/g, ' ').trim(); };
    if (date) {
      cur = { date, desc: strip(t.slice(dm[0].length)), amounts: amts.map(money) };
      raw.push(cur);
    } else if (cur && amts.length && !cur.amounts.length) {
      cur.amounts = amts.map(money);
      const extra = strip(t);
      if (extra) cur.desc = (cur.desc + ' ' + extra).trim();
    } else if (cur && !amts.length && cur.desc.length < 60 && t.length < 60 && !/page \d|continued|statement|account (number|name)|bsb/i.test(low)) {
      cur.desc = (cur.desc + ' ' + t).trim();
    } else if (!amts.length) {
      cur = cur && cur.amounts.length ? null : cur;
    }
  }

  const rows = [];
  for (const r of raw) {
    const a = r.amounts;
    if (!a.length) continue;
    let bal = (cols?.balance && a.find(n => Math.abs(n.x - cols.balance) < 30)) || (a.length >= 2 ? a[a.length - 1] : null);
    const tx = a.find(n => n !== bal);
    if (!tx || !tx.v) continue;
    const balance = bal ? (bal.neg ? -bal.v : bal.v) : null;
    let type;
    if (balance != null && prevBal != null && Math.abs(Math.abs(balance - prevBal) - tx.v) < 0.02) type = balance > prevBal ? 'in' : 'out';
    else if (cols?.debit && cols?.credit) type = Math.abs(tx.x - cols.credit) < Math.abs(tx.x - cols.debit) ? 'in' : 'out';
    else if (credit) type = tx.cr || tx.neg ? 'in' : 'out';
    else type = tx.cr ? 'in' : 'out';
    if (balance != null) prevBal = balance;
    rows.push({ date: r.date, desc: (r.desc || 'Payment').slice(0, 80), amount: round2(tx.v), type });
  }
  const last = closing ?? prevBal;
  return { rows, balance: last != null ? { date: rows.length ? rows[rows.length - 1].date : todayISO(), value: round2(last) } : null };
}
