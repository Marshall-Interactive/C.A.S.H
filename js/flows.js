// Importing money data: receipt photos, banking-app screenshots, bank CSVs.
// OCR runs on the device with Tesseract.js — images are never uploaded.
import * as S from './store.js';
import { esc, money, todayISO, fromISO, parseAmount, round2, parseDate, titleCase, loadScript, sum, fmtDate, FREQS, $, $$ } from './util.js';
import { openSheet, closeSheet, sheetHead, toast, icon } from './ui.js';
import { guessCategory, learn, merchantName } from './categorise.js';
import { findDuplicate, isMine, matchBill, matchIncome, linkOccurrence, relinkIncomes, learnPayName } from './calc.js';
import { catOptions, recordBalance } from './sheets.js';
import { findRegular, nextDate } from './detect.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const PAPAPARSE = 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js';

// ================= OCR =================
async function prepareImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height), px = img.data;
  let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = g; total += g;
  }
  // Dark-mode banking apps: flip to dark text on light, which OCR reads far better.
  const invert = total / (px.length / 4) < 110;
  for (let i = 0; i < px.length; i += 4) {
    let g = invert ? 255 - px[i] : px[i];
    g = Math.max(0, Math.min(255, (g - 128) * 1.35 + 128));
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

async function ocr(file, onProgress) {
  await loadScript(TESSERACT);
  const canvas = await prepareImage(file);
  const worker = await window.Tesseract.createWorker('eng', 1, {
    logger: m => { if (m.status === 'recognizing text') onProgress(0.15 + m.progress * 0.85); else onProgress(0.08); },
  });
  try { return (await worker.recognize(canvas)).data.text; } finally { await worker.terminate(); }
}

// ================= receipt parsing =================
const AMT_END = /(-)?\s?[£€$]?\s?(\d{1,5}[.,]\d{2})\s*(-)?\s*[A-Z*]{0,2}\s*$/;
const TOTAL = /\b(total|balance due|amount due|to pay)\b/i;
const NOT_ITEM = /(sub\s*-?\s*total|\bvat\b|\bgst\b|\btax\b|change|cash|tender|\bcard\b|eftpos|rounding|visa|master|amex|maestro|debit|contactless|auth|merchant|terminal|points|balance|\bdue\b|\bpaid\b|refund|\btip\b|price\s*\/|qty)/i;

export function parseReceipt(text) {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const items = [], totals = [], amounts = [];
  for (const line of lines) {
    const m = line.match(AMT_END);
    if (!m) continue;
    let amount = parseFloat(m[2].replace(',', '.'));
    if (m[1] || m[3]) amount = -amount;
    if (Math.abs(amount) > 20000) continue;
    amounts.push(amount);
    const desc = line.slice(0, m.index).replace(/[£:*#\-\s]+$/, '').trim();
    if (TOTAL.test(line) && !/sub|sav|disc/i.test(line)) { totals.push(amount); continue; }
    if (NOT_ITEM.test(line) || !/[a-z]{2}/i.test(desc)) continue;
    if (/sav|disc|\boff\b|promo|price cut|multibuy|offer|coupon|voucher/i.test(desc) && amount > 0) amount = -amount;
    items.push({ desc: titleCase(desc.replace(/^\d+\s*[x@]\s*/i, '')), amount: round2(amount) });
  }
  const itemSum = round2(sum(items, i => i.amount));
  let total = totals.length ? Math.max(...totals) : 0;
  if (!total) total = itemSum > 0 ? itemSum : (amounts.length ? Math.max(...amounts) : 0);
  let date = null;
  for (const l of lines) { const d = parseDate(l); if (d && d <= todayISO()) { date = d; break; } }
  const firstName = lines.find(l => /[a-z]{3}/i.test(l) && !/\d{3}/.test(l)) || 'Receipt';
  return { merchant: merchantName(text) || titleCase(firstName).slice(0, 40), date: date || todayISO(), total: round2(total), items: items.slice(0, 80) };
}

// ================= banking screenshot parsing =================
const AMT_ANY = /([+\-−–]?)\s?[£€$]\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2}))|([+\-−–]?)\s?(\d{1,3}(?:,\d{3})*\.\d{2})(?!\d)/g;

export function parseStatement(text) {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  let cur = todayISO(), prev = '';
  const rows = [];
  for (const line of lines) {
    const ms = [...line.matchAll(AMT_ANY)];
    if (!ms.length) {
      const d = parseDate(line);
      if (d && line.length < 40) cur = d;
      else if (/[a-z]{3}/i.test(line)) prev = line;
      continue;
    }
    if (/balance|available|overdraft|spent today|total|budget|left to spend/i.test(line)) continue;
    const m = ms[ms.length - 1];
    const sign = m[1] || m[3] || '';
    const amount = parseFloat((m[2] || m[4]).replace(/,/g, ''));
    let desc = line.slice(0, m.index).replace(/[•·|>›<‹]+/g, ' ').replace(/\s+[+\-−–]$/, '').trim();
    const inlineDate = parseDate(desc);
    if (inlineDate) cur = inlineDate;
    if (!/[a-z]{2}/i.test(desc)) desc = prev;
    prev = '';
    if (!amount || !desc) continue;
    rows.push({ date: cur, desc: titleCase(desc).slice(0, 60), amount: round2(amount), type: sign === '+' ? 'in' : 'out' });
  }
  return rows;
}

// ================= scan flow (UI) =================
export function startScan(mode, presetFile) {
  const isReceipt = mode === 'receipt';
  openSheet(`${sheetHead(isReceipt ? 'Scan a receipt' : 'Read a screenshot',
    isReceipt ? 'Snap a receipt — C.A.S.H reads it and splits it by category' : 'Screenshot your banking app — C.A.S.H picks out each payment')}
  <div class="scan-pick" id="scan-body">
    ${isReceipt ? `<label class="btn primary big">${icon('camera')} Take a photo<input type="file" accept="image/*" capture="environment" hidden data-scan-file></label>` : ''}
    <label class="btn big ${isReceipt ? '' : 'primary'}">${icon(isReceipt ? 'upload' : 'phone')} ${isReceipt ? 'Choose from gallery' : 'Choose a screenshot'}<input type="file" accept="image/*" hidden data-scan-file></label>
    <p class="hint">On a laptop you can also paste a screenshot here with Ctrl+V.</p>
    <p class="hint">🔒 Read on your device — the picture never leaves it.</p>
    <p class="hint">Tip: lay receipts flat, in good light, filling the frame.</p>
  </div>`, {
    onMount: sheet => {
      $$('[data-scan-file]', sheet).forEach(inp => inp.addEventListener('change', () => inp.files[0] && runScan(inp.files[0], mode)));
      const onPaste = e => {
        const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
        if (f) runScan(f, mode);
      };
      document.addEventListener('paste', onPaste);
      if (presetFile) runScan(presetFile, mode);
      return () => document.removeEventListener('paste', onPaste);
    },
  });
}

async function runScan(file, mode) {
  const body = $('#scan-body');
  if (!body) return;
  const url = URL.createObjectURL(file);
  body.innerHTML = `<img src="${url}" alt="Your image" class="scan-preview">
    <div class="progress"><i id="scan-progress"></i></div>
    <p class="hint" id="scan-status">Getting the reader ready… (first time needs internet)</p>`;
  try {
    const text = await ocr(file, p => {
      const bar = $('#scan-progress'); if (bar) bar.style.width = Math.round(p * 100) + '%';
      const st = $('#scan-status'); if (st && p > 0.15) st.textContent = `Reading… ${Math.round(p * 100)}%`;
    });
    if (mode === 'receipt') receiptReview(parseReceipt(text), text);
    else {
      const rows = parseStatement(text);
      if (!rows.length) {
        body.innerHTML = `<p class="notice">Couldn't find any payments in that screenshot. Try cropping to just the list of payments.</p><details><summary>What we read</summary><pre class="ocr">${esc(text)}</pre></details>`;
        return;
      }
      review(rows, 'screenshot', { editable: true });
    }
  } catch (e) {
    console.error(e);
    body.innerHTML = `<p class="notice">Sorry — couldn't read that image. ${esc(e.message || '')}</p>`;
  }
}

function itemRow(i, it, mainCat) {
  return `<div class="item-row">
    <input name="d_${i}" value="${esc(it.desc)}" aria-label="Item">
    <input name="a_${i}" value="${it.amount.toFixed(2)}" inputmode="decimal" class="amt" aria-label="Price">
    <select name="c_${i}" aria-label="Category">${catOptions('out', it.categoryId || '', { blank: 'Same as main category' })}</select>
  </div>`;
}

function receiptReview(r, text) {
  const mainCat = guessCategory(r.merchant, 'out');
  openSheet(`${sheetHead('Check your receipt', 'Fix anything we misread, then save')}
  <form class="form" data-form="receipt">
    <div class="row2"><label class="field"><span>Shop</span><input name="merchant" value="${esc(r.merchant)}" required></label>
      <label class="field"><span>Date</span><input type="date" name="date" value="${r.date}" required></label></div>
    <div class="row2"><label class="field"><span>Total paid</span><input name="total" inputmode="decimal" value="${r.total.toFixed(2)}" required></label>
      <label class="field"><span>Who</span><select name="member">${[...S.settings().members, 'Joint'].map(m => `<option ${m === S.settings().currentMember ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label></div>
    <label class="field"><span>Main category</span><select name="mainCat">${catOptions('out', mainCat)}</select></label>
    <div class="field"><span>Items found (${r.items.length}) — change a category to split the receipt</span>
      <div id="items" data-count="${r.items.length}">${r.items.map((it, i) => itemRow(i, it, mainCat)).join('')}</div>
      <button type="button" class="btn sm ghost" data-action="addReceiptItem">${icon('plus', 16)} Add an item</button></div>
    <div class="field"><span>How it will be split</span><div class="split-summary" id="split-summary"></div></div>
    <details><summary class="small muted">Text we read</summary><pre class="ocr">${esc(text)}</pre></details>
    <div class="form-actions"><button class="btn primary" type="submit">Save receipt</button></div>
  </form>`, { onMount: sheet => { const f = $('form', sheet); f.addEventListener('input', () => updateSplit(f)); f.addEventListener('change', () => updateSplit(f)); updateSplit(f); } });
}

function computeSplit(f) {
  const total = round2(parseAmount(f.total.value));
  const main = f.mainCat.value;
  const n = +$('#items', f).dataset.count;
  const items = [];
  for (let i = 0; i < n; i++) {
    if (!f['a_' + i]) continue;
    const amount = round2(parseAmount(f['a_' + i].value));
    if (!amount) continue;
    items.push({ desc: f['d_' + i].value.trim(), amount, categoryId: f['c_' + i].value || main });
  }
  const byCat = {};
  items.forEach(it => { byCat[it.categoryId] = round2((byCat[it.categoryId] || 0) + it.amount); });
  const itemsSum = round2(sum(items, i => i.amount));
  const remainder = round2(total - itemsSum);
  byCat[main] = round2((byCat[main] || 0) + remainder);
  // fold any category that ended up zero/negative (e.g. a lone discount line) into the main one
  for (const [k, v] of Object.entries(byCat)) if (k !== main && v <= 0) { byCat[main] = round2(byCat[main] + v); delete byCat[k]; }
  return { total, main, items, byCat, remainder, itemsSum };
}

function updateSplit(f) {
  const { byCat, remainder, itemsSum, total } = computeSplit(f);
  $('#split-summary', f).innerHTML = Object.entries(byCat).filter(([, v]) => v).map(([k, v]) => `<span>${S.cat(k).icon} ${esc(S.cat(k).name)} ${money(v)}</span>`).join('') +
    (remainder < -0.01 ? `<p class="status warn small">● Items add up to ${money(itemsSum)}, more than the ${money(total)} total — check the total.</p>` : '');
}

function saveReceipt(d, f) {
  const s = computeSplit(f);
  if (!(s.total > 0)) return toast('Enter the total');
  if (s.byCat[s.main] < 0) return toast('Items add up to more than the total — check the numbers');
  const cats = Object.entries(s.byCat).filter(([, v]) => v > 0);
  const tx = {
    type: 'out', amount: s.total, desc: d.merchant.trim(), date: d.date, member: d.member, source: 'receipt',
    categoryId: cats.sort((a, b) => b[1] - a[1])[0]?.[0] || s.main,
    splits: cats.length > 1 ? cats.map(([categoryId, amount]) => ({ categoryId, amount })) : null,
    items: s.items.length ? s.items : null,
  };
  if (findDuplicate(tx) && !confirm('This looks like a payment you already have. Save it anyway?')) return;
  learn(tx.desc, s.main);
  s.items.forEach(it => { if (it.categoryId !== s.main) learn(it.desc, it.categoryId); });
  S.upsert('transactions', tx);
  closeSheet();
  toast(cats.length > 1 ? `Receipt saved, split across ${cats.length} categories` : 'Receipt saved');
}

function addReceiptItem() {
  const box = $('#items');
  const n = +box.dataset.count;
  box.insertAdjacentHTML('beforeend', itemRow(n, { desc: '', amount: 0 }));
  box.dataset.count = n + 1;
  $(`[name=d_${n}]`, box).focus();
}

// ================= CSV import =================
const BANKS = 'NAB, CommBank, Westpac, ANZ, ING, Macquarie, Up, Bendigo, St.George, Amex…';

export function startCsv() {
  openSheet(`${sheetHead('Import a bank statement', 'Bring in months of payments in one go')}
  <div class="scan-pick">
    <label class="btn primary big">${icon('upload')} Choose CSV or PDF statement<input type="file" accept=".csv,.pdf,text/csv,text/comma-separated-values,application/vnd.ms-excel,application/pdf" hidden id="csv-file"></label>
    <p class="hint">Works with ${BANKS}</p>
    <p class="hint">CSV is the most accurate. PDF statements work too — just check the list before importing.</p>
    <details class="howto"><summary>How do I get a CSV from my bank?</summary>
      <ul>
        <li><b>NAB:</b> log in to NAB Internet Banking on a computer → open the account (Offset or Credit card) → Transaction history → pick the dates → Export → CSV. Do one file per account.</li>
        <li><b>CommBank:</b> NetBank → View accounts → choose the account → Export → CSV</li>
        <li><b>Westpac, ANZ, St.George:</b> internet banking → account → Transactions → Export / Download → CSV</li>
        <li><b>ING, Macquarie, Up:</b> internet banking or app → Transactions → Export → CSV</li>
        <li><b>Amex:</b> Statements → Download → CSV (spending shows as positive — C.A.S.H detects this)</li>
      </ul>
      <p class="small">Duplicates you've already added are spotted and left unticked.</p>
    </details>
  </div>`, {
    onMount: sheet => {
      $('#csv-file', sheet).addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        try { if (isPdf) await startPdf(file); else csvMapping(await readCsv(file)); } catch (err) { console.error(err); toast('Could not read that file: ' + err.message); }
      });
    },
  });
}

async function readCsv(file) {
  await loadScript(PAPAPARSE);
  const text = (await file.text()).replace(/^﻿/, '');
  const rows = window.Papa.parse(text, { skipEmptyLines: true }).data.map(r => r.map(c => String(c ?? '').trim()));
  let hi = rows.findIndex((r, i) => i < 25 && r.length >= 3 && r.some(c => /date/i.test(c)));
  let headers;
  if (hi < 0) { // some banks (HSBC) export without a header row
    const width = Math.max(...rows.slice(0, 10).map(r => r.length));
    headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    hi = -1;
  } else headers = rows[hi];
  const data = rows.slice(hi + 1).filter(r => r.length >= 2 && r.some(Boolean));
  if (!data.length) throw new Error('no rows found');
  return { headers, rows: data, name: file.name };
}

function guessMapping(headers, rows) {
  const f = re => headers.findIndex(h => re.test(h));
  let date = f(/^(transaction |posting |posted |completed )?date$/i);
  if (date < 0) date = f(/date/i);
  // Description: a clean merchant name if the bank gives one (NAB's "Merchant Name"),
  // falling back to the full transaction details when that's blank.
  const first = res => { for (const re of res) { const i = f(re); if (i >= 0) return i; } return -1; };
  let desc = first([/^name$/i, /merchant name/i, /^merchant$/i]);
  let desc2 = first([/description/i, /transaction details|details/i, /narrative|memo|transaction$/i, /payee|counter ?party/i, /reference/i]);
  if (desc < 0) { desc = desc2; desc2 = -1; }
  let amount = f(/^amount|^value$|amount \(/i);
  const out = f(/paid out|money out|debit|withdrawal|spent/i);
  const inn = f(/paid in|money in|credit amount|^credit$|deposit|received/i);
  let balance = f(/balance/i);
  const sample = rows.slice(0, 40);
  const numeric = i => sample.filter(r => /^[-+(£$€]*\d[\d,]*\.\d{1,2}\)?$|^[-+]?\$?\d[\d,]*$/.test((r[i] || '').replace(/\s/g, ''))).length > sample.length * 0.6;
  if (date < 0) date = headers.findIndex((_, i) => sample.filter(r => parseDate(r[i])).length > sample.length * 0.6);
  if (amount < 0 && (out < 0 || inn < 0)) amount = headers.findIndex((_, i) => i !== date && numeric(i));
  if (balance < 0 && /^Column/.test(headers[0])) { // no header row: balance is usually the last number column
    for (let i = headers.length - 1; i > amount; i--) if (i !== date && numeric(i)) { balance = i; break; }
  }
  if (desc < 0) { // the wordiest text column
    let best = 0;
    headers.forEach((_, i) => {
      if (i === date || i === amount || i === balance) return;
      const texty = sample.filter(r => /[a-z]{3}/i.test(r[i] || ''));
      const avg = sum(texty, r => r[i].length) / sample.length;
      if (texty.length > sample.length * 0.6 && avg > best) { best = avg; desc = i; }
    });
  }
  const mode = amount >= 0 && !(out >= 0 && inn >= 0 && amount < 0) ? 'single' : 'split';
  let sign = 'negOut';
  if (mode === 'single' && amount >= 0) {
    const vals = sample.map(r => parseAmount(r[amount])).filter(Boolean);
    if (vals.filter(v => v > 0).length > vals.filter(v => v < 0).length * 3 && vals.some(v => v > 0)) sign = 'posOut';
  }
  return { date, desc, desc2, amount, out, inn, balance, mode, sign };
}

// Which tracked account is this statement for? Match the last 4 digits from
// an "Account Number" column or the file name.
function guessAccount(csv) {
  const accs = S.list('accounts').filter(a => a.last4);
  const ai = csv.headers.findIndex(h => /account/i.test(h));
  const hay = csv.name + ' ' + (ai >= 0 ? csv.rows.slice(0, 5).map(r => r[ai]).join(' ') : '');
  const nums = hay.replace(/\D/g, ' ').split(' ');
  const loan = S.list('accounts').find(a => a.loanLast4 && nums.some(n => n.endsWith(a.loanLast4)));
  if (loan) return loan.id + ':loan';
  return accs.find(a => nums.some(n => n.endsWith(a.last4)))?.id || '';
}

// The most recent balance in the statement (banks list newest first or oldest first).
function latestBalance(rows, m) {
  if (m.balance < 0) return null;
  const withBal = rows.map((r, idx) => ({ date: parseDate(r[m.date]), raw: (r[m.balance] || '').trim(), idx }))
    .filter(x => x.date && /\d/.test(x.raw));
  if (!withBal.length) return null;
  const newestFirst = withBal[0].date >= withBal[withBal.length - 1].date;
  const latest = withBal.reduce((a, b) => (b.date > a.date || (b.date === a.date && !newestFirst && b.idx > a.idx)) ? b : a);
  return { date: latest.date, value: round2(parseAmount(latest.raw)) };
}

function applyMapping(rows, m) {
  const res = [];
  for (const r of rows) {
    const date = parseDate(r[m.date]);
    if (!date) continue;
    let amount, type;
    if (m.mode === 'single') {
      let v = parseAmount(r[m.amount]);
      if (m.sign === 'posOut') v = -v;
      type = v < 0 ? 'out' : 'in'; amount = Math.abs(v);
    } else {
      const o = Math.abs(parseAmount(r[m.out])), i = Math.abs(parseAmount(r[m.inn]));
      if (o) { type = 'out'; amount = o; } else { type = 'in'; amount = i; }
    }
    if (!amount) continue;
    const desc = (r[m.desc] || '').trim() || (m.desc2 >= 0 ? (r[m.desc2] || '').trim() : '') || 'Payment';
    res.push({ date, desc: desc.replace(/\s+/g, ' ').slice(0, 80), amount: round2(amount), type });
  }
  return res;
}

let csvState = null;

function csvMapping(csv) {
  const m = guessMapping(csv.headers, csv.rows);
  csvState = { csv, m };
  const accs = S.list('accounts');
  const accId = guessAccount(csv);
  const opt = sel => `<option value="-1">—</option>` + csv.headers.map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(h || `Column ${i + 1}`)}</option>`).join('');
  openSheet(`${sheetHead('Match the columns', `${csv.rows.length} rows in ${csv.name}`)}
  <form class="form" data-form="csvMap">
    <p class="small muted">We've guessed which column is which — check the preview looks right.</p>
    ${accs.length ? `<div class="row2"><label class="field"><span>Statement is for</span><select name="accountId"><option value="">Not a tracked account</option>${accs.map(a => `<option value="${a.id}" ${a.id === accId ? 'selected' : ''}>${esc(a.name)}</option>` + (a.kind === 'offset' ? `<option value="${a.id}:loan" ${a.id + ':loan' === accId ? 'selected' : ''}>${esc(a.name)} – home loan</option>` : '')).join('')}</select></label>
      <label class="field"><span>Balance column</span><select name="balance">${opt(m.balance)}</select></label></div>` : '<input type="hidden" name="accountId" value=""><input type="hidden" name="balance" value="-1">'}
    <div class="row2"><label class="field"><span>Date</span><select name="date">${opt(m.date)}</select></label>
      <label class="field"><span>Description</span><select name="desc">${opt(m.desc)}</select></label></div>
    <div class="field"><span>Amounts are in</span><div class="seg">
      <label><input type="radio" name="mode" value="single" ${m.mode === 'single' ? 'checked' : ''}><span>One column</span></label>
      <label><input type="radio" name="mode" value="split" ${m.mode === 'split' ? 'checked' : ''}><span>Separate in / out</span></label></div></div>
    <div class="row2 if-single"><label class="field"><span>Amount</span><select name="amount">${opt(m.amount)}</select></label>
      <label class="field"><span>Money out shows as</span><select name="sign"><option value="negOut" ${m.sign === 'negOut' ? 'selected' : ''}>Negative (−12.50)</option><option value="posOut" ${m.sign === 'posOut' ? 'selected' : ''}>Positive (12.50)</option></select></label></div>
    <div class="row2 if-split"><label class="field"><span>Money out</span><select name="out">${opt(m.out)}</select></label>
      <label class="field"><span>Money in</span><select name="inn">${opt(m.inn)}</select></label></div>
    <div class="field"><span>Preview</span><div id="csv-preview" class="preview"></div></div>
    <div class="form-actions"><button class="btn primary" type="submit">Next: review</button></div>
  </form>`, {
    onMount: sheet => {
      const f = $('form', sheet);
      const upd = () => {
        const mm = readMap(f);
        f.dataset.mode = mm.mode;
        const rows = applyMapping(csvState.csv.rows.slice(0, 5), mm);
        const bal = latestBalance(csvState.csv.rows, mm);
        const acc = f.accountId.value && S.byId('accounts', f.accountId.value.split(':')[0]);
        $('#csv-preview', f).innerHTML = (rows.length ? rows.map(r => `<div><span>${fmtDate(r.date)}</span><span>${esc(r.desc)}</span><b class="${r.type === 'in' ? 'pos' : ''}">${r.type === 'in' ? '+' : '−'}${money(r.amount)}</b></div>`).join('')
          : '<p class="status warn">● Nothing readable yet — check the Date and Amount columns.</p>') +
          (acc && bal ? `<p class="status good">✓ Latest balance ${money(bal.value)} on ${fmtDate(bal.date)} will update ${esc(acc.name)}</p>` : '');
      };
      f.addEventListener('change', upd); upd();
    },
  });
}

const readMap = f => ({
  date: +f.date.value, desc: +f.desc.value, desc2: f.desc.value === String(csvState.m.desc) ? csvState.m.desc2 : -1,
  amount: +f.amount.value, out: +f.out.value, inn: +f.inn.value, balance: +f.balance.value, mode: f.mode.value, sign: f.sign.value,
});

function submitCsvMap(d, f) {
  const m = readMap(f);
  const rows = applyMapping(csvState.csv.rows, m);
  if (!rows.length) return toast('No payments found with those columns');
  const accountId = f.accountId.value;
  review(rows, 'csv', { accountId, balance: accountId ? latestBalance(csvState.csv.rows, m) : null });
}

// ================= shared review list (screenshot + CSV) =================
let pending = [];
let pendingMeta = {};

function review(rows, source, { editable = false, accountId = '', balance = null } = {}) {
  const pool = S.list('transactions');
  const acc = accountId ? S.byId('accounts', accountId.split(':')[0]) : null;
  const [accId, part] = (accountId || '').split(':');
  pendingMeta = { accountId: accId, part, balance };
  // Transfers between your own accounts: the same amount going out of one and into another.
  const others = S.list('transactions').filter(t => t.accountId && t.accountId !== accId);
  const last4s = S.list('accounts').flatMap(a => [a.last4, a.loanLast4]).filter(Boolean);
  const used = new Set();
  pending = rows.map(r => {
    const dup = findDuplicate(r, pool, used);
    if (dup) used.add(dup.id);
    const bill = matchBill(r), inc = matchIncome(r);
    let guess = guessCategory(r.desc, r.type);
    // Money going INTO a credit card is almost always you paying it off.
    if (acc?.kind === 'credit' && r.type === 'in' && guess !== 'refund') guess = 'transfer';
    // a home-loan statement is only repayments and interest — keep its balance, don't count it as spending
    if (part === 'loan') guess = 'transfer';
    if (last4s.some(n => r.desc.replace(/\D/g, ' ').split(' ').some(x => x.length >= 4 && x.endsWith(n)))) guess = 'transfer';
    const twin = others.find(t => t.type !== r.type && Math.abs(t.amount - r.amount) < 0.005 && Math.abs(fromISO(t.date) - fromISO(r.date)) <= 2 * 864e5);
    if (twin) guess = 'transfer';
    const categoryId = bill?.categoryId || (inc && guess === 'otherin' ? 'wages' : guess);
    return { ...r, dup: !!dup, dupOf: dup?.id, billId: twin ? undefined : bill?.id, incomeId: twin ? undefined : inc?.id, categoryId: twin || part === 'loan' ? 'transfer' : categoryId, guessed: twin || part === 'loan' ? 'transfer' : categoryId, twinId: twin?.id };
  }).sort((a, b) => b.date.localeCompare(a.date));
  const dups = pending.filter(p => p.dup).length;
  const real = pending.filter(p => p.categoryId !== 'transfer');
  const ins = real.filter(p => p.type === 'in'), outs = real.filter(p => p.type === 'out');
  openSheet(`${sheetHead('Review & import', `${pending.length} payments found${dups ? ` · ${dups} already in C.A.S.H` : ''}`)}
  <form class="form" data-form="review">
    <input type="hidden" name="source" value="${source}">
    <div class="stat-row"><div class="stat"><small>Money in</small><b class="pos">${money(sum(ins, r => r.amount))}</b></div><div class="stat"><small>Money out</small><b>${money(sum(outs, r => r.amount))}</b></div></div>
    ${acc && balance ? `<p class="notice">🏦 ${esc(acc.name)} will be updated to <b>${money(acc.kind === 'credit' ? Math.abs(balance.value) : balance.value)}</b>${acc.kind === 'credit' ? ' owed' : ''} (balance on ${fmtDate(balance.date)}).</p>` : ''}
    <p class="small muted">🔁 Transfers between your own accounts (like paying off the card) are imported but not counted as spending.</p>
    ${dups ? `<p class="notice small">⚠ <b>${dups}</b> ${dups === 1 ? 'payment matches' : 'payments match'} something already in C.A.S.H (same amount within 3 days). Your own entry is kept — choose <b>Reject</b> to skip the bank copy, or <b>Accept</b> if it really is a separate payment.</p>` : ''}
    <div class="btn-row"><button type="button" class="btn sm" data-action="reviewAll" data-on="1">Tick all</button><button type="button" class="btn sm" data-action="reviewAll" data-on="0">Untick all</button>
      <label class="field inline"><span>Who</span><select name="member">${[...S.settings().members, 'Joint'].map(m => `<option ${m === S.settings().currentMember ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label></div>
    <div class="imp-list">${pending.map((p, i) => `<div class="imp-row ${p.dup ? 'dup' : ''}">
      ${p.dup ? '<span class="dup-ic" title="Already in C.A.S.H">⚠</span>' : `<input type="checkbox" name="sel" value="${i}" checked aria-label="Import this payment">`}
      ${editable ? `<div class="imp-edit"><input name="desc_${i}" value="${esc(p.desc)}" aria-label="Description"><input type="date" name="date_${i}" value="${p.date}" aria-label="Date"></div>
        <div class="imp-amt"><select name="type_${i}" aria-label="In or out"><option value="out" ${p.type === 'out' ? 'selected' : ''}>Out</option><option value="in" ${p.type === 'in' ? 'selected' : ''}>In</option></select><input name="amt_${i}" value="${p.amount.toFixed(2)}" inputmode="decimal" aria-label="Amount"></div>`
        : `<div><b>${esc(p.desc)}</b><div class="meta">${fmtDate(p.date, { day: 'numeric', month: 'short', year: '2-digit' })}${p.billId ? ' · 📄 bill' : ''}${p.incomeId ? ' · 💵 wage' : ''}</div></div>
        <b class="tx-amt ${p.type}">${p.type === 'in' ? '+' : '−'}${money(p.amount)}</b>`}
      <select name="cat_${i}" aria-label="Category">${catOptions(p.type, p.categoryId)}</select>
      ${p.dup ? dupChoice(p, i) : ''}
    </div>`).join('')}</div>
    <div class="form-actions"><button class="btn primary" type="submit">Import</button></div>
  </form>`, { wide: true });
}

// "Matches your entry …" with Reject (keep mine) / Accept (it's separate).
function dupChoice(p, i) {
  const mine = S.byId('transactions', p.dupOf);
  const yours = mine && isMine(mine);
  return `<div class="dup-choice">
    <p class="small">${yours ? 'Matches what you added' : 'Already imported'}: <b>${esc(mine?.desc || '')}</b> · ${mine ? fmtDate(mine.date) : ''}${mine?.member ? ' · ' + esc(mine.member) : ''}</p>
    <div class="seg small" role="radiogroup" aria-label="Keep or import">
      <label><input type="radio" name="dup_${i}" value="reject" checked><span>✕ Reject — keep ${yours ? 'mine' : 'the existing one'}</span></label>
      <label><input type="radio" name="dup_${i}" value="accept"><span>✓ Accept as a new payment</span></label>
    </div>
  </div>`;
}

function submitReview(d, f) {
  const sel = $$('[name=sel]:checked', f).map(x => +x.value);
  // duplicates: Accept imports the bank row; Reject keeps your entry and links the bank details to it
  let linked = 0;
  pending.forEach((p, i) => {
    if (!p.dup) return;
    if (f['dup_' + i]?.value === 'accept') { sel.push(i); return; }
    const mine = S.byId('transactions', p.dupOf);
    if (mine && isMine(mine) && !mine.bankMatched) {
      Object.assign(mine, { bankMatched: true, bankDesc: p.desc, bankDate: p.date, updatedAt: Date.now() });
      if (pendingMeta.accountId && !mine.accountId) mine.accountId = pendingMeta.accountId;
      linked++;
    }
  });
  if (!sel.length && !linked && !pendingMeta.balance) return toast('Nothing ticked');
  let n = 0;
  const added = [];
  for (const i of sel) {
    const p = pending[i];
    const tx = {
      type: f['type_' + i]?.value || p.type,
      amount: f['amt_' + i] ? round2(parseAmount(f['amt_' + i].value)) : p.amount,
      desc: f['desc_' + i]?.value.trim() || p.desc,
      date: f['date_' + i]?.value || p.date,
      categoryId: f['cat_' + i].value, member: d.member, source: d.source,
      billId: p.billId, incomeId: p.incomeId, accountId: pendingMeta.accountId || undefined,
      accountPart: pendingMeta.part === 'loan' ? 'loan' : undefined,
    };
    if (!(tx.amount > 0)) continue;
    if (tx.categoryId !== p.guessed) learn(tx.desc, tx.categoryId);
    const saved = S.upsert('transactions', tx, { silent: true });
    if (p.twinId && tx.categoryId === 'transfer') { const tw = S.byId('transactions', p.twinId); if (tw && tw.categoryId !== 'transfer') { tw.categoryId = 'transfer'; tw.billId = tw.incomeId = undefined; tw.updatedAt = Date.now(); } }
    added.push(saved);
    if (p.billId) linkOccurrence(S.byId('bills', p.billId), 'paid', saved);
    if (p.incomeId) { const inc = S.byId('incomes', p.incomeId); learnPayName(inc, saved); linkOccurrence(inc, 'received', saved); }
    n++;
  }
  const { accountId, balance, part } = pendingMeta;
  const acc = accountId && S.byId('accounts', accountId);
  relinkIncomes();
  if (acc && balance) recordBalance(acc, part === 'loan' ? { loan: Math.abs(balance.value) } : { balance: acc.kind === 'credit' ? Math.abs(balance.value) : balance.value }, balance.date, { silent: true });
  S.save();
  pending = [];
  pendingMeta = {};
  closeSheet();
  toast(n || linked ? `Imported ${n} payment${n === 1 ? '' : 's'}${linked ? ` · ${linked} matched to your own entries` : ''}` : 'Nothing new — everything was already in C.A.S.H');
  const regular = findRegular(added);
  if (regular.length) setTimeout(() => suggestRegular(regular), 400);
}

// ================= regular wages & bills spotted in your payments =================
let suggestions = [];

export function suggestRegular(list) {
  suggestions = list;
  if (!list.length) return toast('No regular payments found yet — import at least two months of statements');
  const members = [...S.settings().members, 'Joint'];
  openSheet(`${sheetHead('We spotted regular payments', 'Tick the ones to add to your Wages and Bills')}
  <form class="form" data-form="regular">
    <div class="imp-list">${list.map((s, i) => {
      const next = nextDate(s);
      return `<div class="imp-row">
        <input type="checkbox" name="sel" value="${i}" checked aria-label="Add this">
        <div><input name="name_${i}" value="${esc(s.name)}" aria-label="Name" class="inline-name">
          <div class="meta">${s.type === 'in' ? '💵 Wage / income' : '📄 Bill'} · ${FREQS[s.frequency]} · seen ${s.count}×${s.varies ? ' · amount varies' : ''}${next ? ` · next ${fmtDate(next)}` : ''}</div></div>
        <b class="tx-amt ${s.type}">${s.varies ? '≈ ' : s.type === 'in' ? '+' : '−'}${money(s.amount)}</b>
        ${s.type === 'out'
          ? `<select name="cat_${i}" aria-label="Category">${catOptions('out', s.categoryId)}</select>`
          : `<select name="member_${i}" aria-label="Whose">${members.map(m => `<option ${m === s.member ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`}
      </div>`;
    }).join('')}</div>
    <p class="small muted">Wages that vary will use the average of your last 3 pays. Future imports tick each one off automatically.</p>
    <div class="form-actions"><button type="button" class="btn ghost" data-action="closeSheet">Not now</button><button class="btn primary" type="submit">Add ticked</button></div>
  </form>`, { wide: true });
}

function saveRegular(d, f) {
  const sel = $$('[name=sel]:checked', f).map(x => +x.value);
  if (!sel.length) return closeSheet();
  for (const i of sel) {
    const s = suggestions[i], isIn = s.type === 'in';
    const item = S.upsert(isIn ? 'incomes' : 'bills', {
      name: f['name_' + i].value.trim() || s.name, amount: s.amount, frequency: s.frequency,
      dueDay: s.dueDay, anchorDate: s.anchorDate, keywords: s.keywords, active: true,
      ...(isIn ? { member: f['member_' + i].value, varies: s.varies }
        : { categoryId: f['cat_' + i].value, method: 'Direct Debit', payer: s.member || 'Joint' }),
    }, { silent: true });
    for (const id of s.txIds) {
      const t = S.byId('transactions', id);
      if (!t) continue;
      if (isIn) { t.incomeId = item.id; if (t.categoryId === 'otherin') t.categoryId = 'wages'; }
      else { t.billId = item.id; t.categoryId = item.categoryId; }
      t.updatedAt = Date.now();
      linkOccurrence(item, isIn ? 'received' : 'paid', t);
    }
  }
  S.save();
  closeSheet();
  toast(`Added ${sel.length} regular payment${sel.length === 1 ? '' : 's'} to your plan`);
}

// ================= PDF statements =================
let pdfState = null;

function accountOptions(selected) {
  return `<option value="">Not a tracked account</option>` + S.list('accounts').map(a =>
    `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>` +
    (a.kind === 'offset' ? `<option value="${a.id}:loan" ${a.id + ':loan' === selected ? 'selected' : ''}>${esc(a.name)} – home loan</option>` : '')).join('');
}

async function startPdf(file) {
  const hint = $('#sheet .scan-pick');
  hint?.insertAdjacentHTML('beforeend', '<p class="hint" id="pdf-status">Reading the PDF…</p>');
  const { pdfLines, parsePdfStatement } = await import('./pdfimport.js');
  const lines = await pdfLines(file);
  const text = lines.map(l => l.text).join(' ');
  pdfState = { lines, parse: parsePdfStatement };
  const accId = guessAccount({ name: file.name + ' ' + text.slice(0, 4000), headers: [], rows: [] });
  openSheet(`${sheetHead('Check your PDF statement', file.name)}
  <form class="form" data-form="pdfMap">
    <label class="field"><span>Statement is for</span><select name="accountId">${accountOptions(accId)}</select></label>
    <div class="field"><span>What we found</span><div id="pdf-preview" class="preview"></div></div>
    <p class="small muted">PDFs are made for printing, so reading them is best-effort. You'll see every payment on the next screen to check before anything is saved.</p>
    <div class="form-actions"><button class="btn primary" type="submit">Next: review</button></div>
  </form>`, {
    onMount: sheet => {
      const f = $('form', sheet);
      const upd = () => {
        const p = parsePdf(f.accountId.value);
        const acc = f.accountId.value && S.byId('accounts', f.accountId.value.split(':')[0]);
        $('#pdf-preview', f).innerHTML = (p.rows.length
          ? `<p class="status good">✓ ${p.rows.length} payments found</p>` + p.rows.slice(0, 5).map(r => `<div><span>${fmtDate(r.date)}</span><span>${esc(r.desc)}</span><b class="${r.type === 'in' ? 'pos' : ''}">${r.type === 'in' ? '+' : '−'}${money(r.amount)}</b></div>`).join('')
          : '<p class="status warn">● No payments found in this PDF. Try the CSV export from NAB Internet Banking instead.</p>') +
          (acc && p.balance ? `<p class="status good">✓ Closing balance ${money(p.balance.value)} will update ${esc(acc.name)}</p>` : '');
      };
      f.addEventListener('change', upd); upd();
    },
  });
}

function parsePdf(accountValue) {
  const acc = accountValue && S.byId('accounts', accountValue.split(':')[0]);
  return pdfState.parse(pdfState.lines, { credit: acc?.kind === 'credit' && !accountValue.endsWith(':loan') });
}

function submitPdfMap(d, f) {
  const p = parsePdf(f.accountId.value);
  if (!p.rows.length) return toast('No payments found in this PDF — try the CSV export instead');
  review(p.rows, 'pdf', { accountId: f.accountId.value, balance: f.accountId.value ? p.balance : null });
}

export const forms = { receipt: saveReceipt, csvMap: submitCsvMap, review: submitReview, regular: saveRegular, pdfMap: submitPdfMap };
export const actions = {
  scan: el => startScan(el.dataset.mode),
  importCsv: () => startCsv(),
  findRegular: () => suggestRegular(findRegular()),
  addReceiptItem: () => addReceiptItem(),
  reviewAll: el => $$('#sheet [name=sel]').forEach(c => { c.checked = el.dataset.on === '1'; }),
};
