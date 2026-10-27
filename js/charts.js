// Small hand-made SVG charts. Every mark carries data-tip for the hover layer.
import { esc, money, moneyShort } from './util.js';

const TAU = Math.PI * 2;
const pt = (cx, cy, r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];

function sector(cx, cy, r0, r1, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pt(cx, cy, r1, a0), [x1, y1] = pt(cx, cy, r1, a1);
  const [x2, y2] = pt(cx, cy, r0, a1), [x3, y3] = pt(cx, cy, r0, a0);
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

// segs: [{label, value, color}]
// sweep: draw the ring in clockwise. count: {value, key} makes the centre number tick up.
let sweepId = 0;
export function donut(segs, { size = 180, thick = 24, center = '', sub = '', sweep = false, count = null } = {}) {
  const c = size / 2, r1 = c - 2, r0 = r1 - thick;
  const total = segs.reduce((a, s) => a + Math.max(0, s.value), 0);
  let body;
  if (!total) {
    body = `<circle cx="${c}" cy="${c}" r="${(r0 + r1) / 2}" fill="none" stroke="var(--surface-2)" stroke-width="${thick}"/>`;
  } else {
    let a = 0;
    body = segs.filter(s => s.value > 0).map(s => {
      const a1 = a + (s.value / total) * TAU;
      const pct = Math.round((s.value / total) * 100);
      const d = a1 - a >= TAU - 1e-6
        ? sector(c, c, r0, r1, 0, Math.PI) + sector(c, c, r0, r1, Math.PI, TAU - 1e-4)
        : sector(c, c, r0, r1, a, a1);
      a = a1;
      return `<path d="${d}" fill="${s.color}" stroke="var(--surface)" stroke-width="2" data-tip="${esc(s.label)} · ${pct}%|${esc(money(s.value))}"${s.open ? ` ${s.open} class="slice"` : ''}/>`;
    }).join('');
  }
  if (sweep && total) {
    const id = 'sweep' + ++sweepId;
    body = `<defs><mask id="${id}"><circle cx="${c}" cy="${c}" r="${(r0 + r1) / 2}" fill="none" stroke="#fff" stroke-width="${thick + 6}"
      pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="100" transform="rotate(-90 ${c} ${c})" class="sweep-mask"/></mask></defs>
      <g mask="url(#${id})">${body}</g>`;
  }
  const counted = count ? ` data-count="${count.value}" data-count-key="${esc(count.key)}" data-count-dp="0"` : '';
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(sub)} ${esc(center)}">${body}
    <text x="${c}" y="${c + 2}" text-anchor="middle" class="donut-v"${counted}>${esc(center)}</text>
    <text x="${c}" y="${c + 20}" text-anchor="middle" class="donut-l">${esc(sub)}</text></svg>`;
}

function niceMax(v) {
  if (v <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function barPath(x, y, w, h, r = 4) {
  r = Math.min(r, h, w / 2);
  if (h <= 0) return '';
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
}

// rows: [{label, in, out}] — two series side by side, one axis.
export function inOutBars(rows, { h = 180, names = ['in', 'out'] } = {}) {
  const padL = 40, padB = 22, padT = 8, groupW = 52, barW = 16, gap = 2;
  const W = padL + rows.length * groupW + 8;
  const max = niceMax(Math.max(...rows.flatMap(r => [r.in, r.out]), 0));
  const plotH = h - padB - padT;
  const y = v => padT + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  let s = ticks.map(t => `<line class="${t ? 'grid-line' : 'base-line'}" x1="${padL}" x2="${W - 4}" y1="${y(t)}" y2="${y(t)}"/>
    <text x="${padL - 6}" y="${y(t) + 3}" text-anchor="end">${moneyShort(t)}</text>`).join('');
  rows.forEach((r, i) => {
    const gx = padL + i * groupW + (groupW - barW * 2 - gap) / 2;
    const op = r.forecast ? ' opacity=".35"' : '';
    s += `<path d="${barPath(gx, y(r.in), barW, plotH + padT - y(r.in))}" fill="var(--s1)"${op}/>`;
    s += `<path d="${barPath(gx + barW + gap, y(r.out), barW, plotH + padT - y(r.out))}" fill="var(--s2)"${op}/>`;
    s += `<text x="${gx + barW + gap / 2}" y="${h - 6}" text-anchor="middle">${esc(r.label)}</text>`;
    s += `<rect x="${padL + i * groupW}" y="${padT}" width="${groupW}" height="${plotH}" fill="transparent"
      data-tip="${esc(r.label)}: ${names[0]} ${esc(money(r.in, { whole: true }))} · ${names[1]} ${esc(money(r.out, { whole: true }))}|${esc(money(r.in - r.out, { sign: true, whole: true }))}"/>`;
  });
  return `<svg class="axis" viewBox="0 0 ${W} ${h}" role="img" aria-label="Money in and out by month">${s}</svg>`;
}

// A balance climbing over time: soft area, a line that draws itself in,
// flags where milestones were passed and a glowing dot for today.
let growId = 0;
export function growthChart(points, { flags = [], h = 170 } = {}) {
  if (points.length < 2) return '';
  const W = 340, padL = 44, padR = 12, padT = 14, padB = 22;
  const t0 = +new Date(points[0].date), t1 = +new Date(points[points.length - 1].date);
  const lo = Math.min(...points.map(p => p.v)), hi = Math.max(...points.map(p => p.v));
  const span = hi - lo || hi || 1;
  const min = Math.max(0, lo - span * 0.15), max = niceMax(hi + span * 0.08);
  const x = d => padL + ((+new Date(d) - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = v => padT + (1 - (v - min) / (max - min || 1)) * (h - padT - padB);
  // a step line: the balance holds until the next recorded day
  let line = `M${x(points[0].date)} ${y(points[0].v)}`;
  for (let i = 1; i < points.length; i++) line += `H${x(points[i].date)}V${y(points[i].v)}`;
  const area = `${line}V${h - padB}H${x(points[0].date)}Z`;
  const id = 'grow' + ++growId;
  const ticks = [min, (min + max) / 2, max];
  const months = [];
  for (let d = new Date(t0); d <= new Date(t1); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const m1 = new Date(d.getFullYear(), d.getMonth(), 1);
    if (+m1 >= t0) months.push(m1);
  }
  const step = Math.ceil(months.length / 6) || 1;
  const last = points[points.length - 1];
  return `<svg class="axis growth" viewBox="0 0 ${W} ${h}" role="img" aria-label="Balance over time">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--s3)" stop-opacity=".35"/><stop offset="1" stop-color="var(--s3)" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map(t => `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 6}" y="${y(t) + 3}" text-anchor="end">${moneyShort(t)}</text>`).join('')}
    ${months.filter((_, i) => i % step === 0).map(m => `<text x="${x(m)}" y="${h - 6}" text-anchor="middle">${m.toLocaleDateString('en-AU', { month: 'short' })}</text>`).join('')}
    <path d="${area}" fill="url(#${id})" class="grow-area"/>
    <path d="${line}" fill="none" stroke="var(--s3)" stroke-width="2.5" stroke-linejoin="round" pathLength="100" class="grow-line"/>
    ${flags.map(f => `<g class="grow-flag" data-tip="Passed ${esc(money(f.m, { whole: true }))}|${esc(new Date(f.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }))}">
      <line x1="${x(f.date)}" x2="${x(f.date)}" y1="${y(f.m)}" y2="${y(f.m) - 16}" stroke="var(--gold)" stroke-width="1.5"/>
      <circle cx="${x(f.date)}" cy="${y(f.m) - 18}" r="7" fill="var(--gold)"/><text x="${x(f.date)}" y="${y(f.m) - 15}" text-anchor="middle" class="flag-t">★</text></g>`).join('')}
    ${points.map(p => `<rect x="${x(p.date) - 3}" y="${padT}" width="6" height="${h - padT - padB}" fill="transparent" data-tip="${esc(new Date(p.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))}|${esc(money(p.v))}"/>`).join('')}
    <circle cx="${x(last.date)}" cy="${y(last.v)}" r="9" fill="var(--s3)" opacity=".25" class="grow-pulse"/>
    <circle cx="${x(last.date)}" cy="${y(last.v)}" r="4.5" fill="var(--s3)" stroke="var(--surface)" stroke-width="2"/>
  </svg>`;
}
