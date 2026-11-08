// The timeline: one bar per step, inserted text stacked above the axis by kind, deletions below, flags as markers.
// Two x-axis modes: by step (equal widths) and by clock (real time, long gaps collapsed into marked breaks).

import { svg, KIND_STYLE, fmtDateTime, fmtInt, fmtDuration } from './dom.js';

const H = 178, AXIS = 122, UP = 100, DOWN = 44, TOP = 16;
const KIND_DELETE = 7, KIND_STYLE_ONLY = 8;
const STACK = [3, 0, 1, 6, 5, 4, 2];   // baseline, typed, chunk, restored, suggestion, Gemini, bulk (top)

function patterns() {
  const defs = svg('defs');
  const p = (id, body) => { const pt = svg('pattern', { id, width: 6, height: 6, patternUnits: 'userSpaceOnUse' }); body.forEach(b => pt.append(b)); defs.append(pt); };
  const line = a => svg('line', Object.assign({ stroke: '#fff', 'stroke-width': 1.3, 'stroke-opacity': 0.75 }, a));
  p('di-hatch', [line({ x1: 0, y1: 6, x2: 6, y2: 0 })]);
  p('di-cross', [line({ x1: 0, y1: 6, x2: 6, y2: 0 }), line({ x1: 0, y1: 0, x2: 6, y2: 6 })]);
  p('di-dots', [svg('circle', { cx: 3, cy: 3, r: 1, fill: '#fff', 'fill-opacity': 0.8 })]);
  p('di-vline', [line({ x1: 3, y1: 0, x2: 3, y2: 6 })]);
  p('di-hline', [line({ x1: 0, y1: 3, x2: 6, y2: 3 })]);
  return defs;
}

// Bar x positions and widths for the chosen axis.
export function layout(bars, axis, width, collapseMs) {
  const n = bars.length;
  if (!n) return { xs: [], ws: [], breaks: [], width };
  if (axis !== 'clock') {
    const w = Math.max(3, Math.floor((width - 8) / n));
    const gap = w >= 6 ? 1 : 0;
    return { xs: bars.map((_, i) => 4 + i * w), ws: bars.map(() => w - gap), breaks: [], width: Math.max(width, 8 + n * w) };
  }
  const BREAK = 14;
  let span = 0, nBreaks = 0;
  for (let i = 0; i < n; i++) {
    span += Math.max(1000, bars[i].t1 - bars[i].t0);
    if (i) { const g = bars[i].t0 - bars[i - 1].t1; if (g > collapseMs) nBreaks++; else span += Math.max(0, g); }
  }
  const usable = Math.max(100, width - 8 - nBreaks * BREAK);
  const k = usable / span;
  const xs = [], ws = [], breaks = [];
  let x = 4;
  for (let i = 0; i < n; i++) {
    if (i) {
      const g = bars[i].t0 - bars[i - 1].t1;
      if (g > collapseMs) { breaks.push({ x: x + BREAK / 2, ms: g }); x += BREAK; } else x += Math.max(0, g) * k;
    }
    const w = Math.max(2, Math.max(1000, bars[i].t1 - bars[i].t0) * k);
    xs.push(x); ws.push(w);
    x += w;
  }
  return { xs, ws, breaks, width };
}

// state: { bars, cur (bar index), rangeFrom (bar index or null), axis, level }
// A: the analysis. handlers: { press(), select(i, shift), zoom(i, j) }
export function renderTimeline(host, A, state, handlers) {
  const bars = state.bars;
  const width = Math.max(320, host.clientWidth || 900);
  const L = layout(bars, state.axis, width, A.settings.breakCollapseMin * 60000);
  const maxIns = Math.max(1, ...bars.map(b => b.insTotal));
  const maxDel = Math.max(1, ...bars.map(b => b.del));
  const hUp = v => (v > 0 ? Math.max(2, Math.sqrt(v / maxIns) * UP) : 0);
  const hDown = v => (v > 0 ? Math.max(2, Math.sqrt(v / maxDel) * DOWN) : 0);
  const root = svg('svg', { width: L.width, height: H, viewBox: `0 0 ${L.width} ${H}`, class: 'tl-svg', role: 'img', 'aria-label': `Timeline of ${bars.length} steps` });
  root.append(patterns());
  root.append(svg('line', { x1: 0, x2: L.width, y1: AXIS, y2: AXIS, class: 'tl-axis' }));

  // Range selection and the current step.
  if (state.rangeFrom != null && state.rangeFrom !== state.cur) {
    const a = Math.min(state.rangeFrom, state.cur), b = Math.max(state.rangeFrom, state.cur);
    root.append(svg('rect', { x: L.xs[a] - 1, y: TOP - 4, width: L.xs[b] + L.ws[b] - L.xs[a] + 2, height: H - TOP, class: 'tl-range' }));
  }
  if (bars[state.cur]) root.append(svg('rect', { x: L.xs[state.cur] - 2, y: TOP - 6, width: L.ws[state.cur] + 4, height: H - TOP + 4, class: 'tl-cur' }));

  // Session boundaries (step axis) and collapsed breaks (clock axis).
  const E = A.entries;
  for (let i = 1; i < bars.length; i++) {
    if (A.sessionOf[bars[i].a] !== A.sessionOf[bars[i - 1].b] && state.axis !== 'clock') {
      const x = L.xs[i] - 1;
      root.append(svg('line', { x1: x, x2: x, y1: TOP, y2: H - 4, class: 'tl-session' }));
    }
  }
  for (const br of L.breaks) {
    root.append(svg('line', { x1: br.x - 3, x2: br.x + 3, y1: AXIS - 6, y2: AXIS + 6, class: 'tl-break' }));
    root.append(svg('line', { x1: br.x + 1, x2: br.x + 7, y1: AXIS - 6, y2: AXIS + 6, class: 'tl-break' }));
  }

  const writer = A.writer, teacher = A.teacher;
  bars.forEach((b, i) => {
    const g = svg('g', { class: 'tl-bar', 'data-i': i });
    const x = L.xs[i], w = L.ws[i];
    const onlyTeacher = teacher >= 0 && b.authors === (1 << Math.min(30, teacher));
    const other = b.authors & ~(1 << Math.min(30, writer)) & ~(teacher >= 0 ? 1 << Math.min(30, teacher) : 0);
    if (onlyTeacher) g.setAttribute('opacity', '0.35');
    // Stacked insertions: heights proportional to each kind's share of the bar's height.
    const total = hUp(b.insTotal);
    let y = AXIS;
    for (const k of STACK) {
      if (!b.ins[k]) continue;
      const h = (b.ins[k] / b.insTotal) * total;
      y -= h;
      const st = KIND_STYLE[k];
      g.append(svg('rect', { x, y, width: w, height: h, fill: st.color }));
      if (st.pattern) g.append(svg('rect', { x, y, width: w, height: h, fill: `url(#di-${st.pattern})` }));
    }
    if (!b.insTotal && !b.del && b.style) g.append(svg('rect', { x, y: AXIS - 3, width: w, height: 3, fill: KIND_STYLE[KIND_STYLE_ONLY].color }));
    if (b.del) g.append(svg('rect', { x, y: AXIS + 1, width: w, height: hDown(b.del), fill: KIND_STYLE[KIND_DELETE].color }));
    if (other) g.append(svg('rect', { x, y: H - 6, width: w, height: 4, class: 'tl-other' }));
    // Flags: bulk insertions (and Gemini) as a marker above the bar; restores as a ring.
    if (b.bulk) g.append(svg('path', { d: `M${x + w / 2 - 5},2 h10 l-5,8 z`, class: 'tl-flag' }));
    else if (b.flags & 8) g.append(svg('circle', { cx: x + w / 2, cy: 7, r: 4, class: 'tl-restore' }));
    // A hit area across the whole height, so thin bars are easy to click.
    g.append(svg('rect', { x: x - 1, y: 0, width: w + 2, height: H, fill: 'transparent' }));
    const kinds = STACK.filter(k => b.ins[k]).map(k => `${fmtInt(b.ins[k])} ${KIND_STYLE[k].name}`).join(', ');
    g.append(svg('title', {}, `${fmtDateTime(b.t0)}${b.t1 - b.t0 > 1000 ? ' – ' + fmtDuration(b.t1 - b.t0) : ''}\n${b.b - b.a + 1} entr${b.b === b.a ? 'y' : 'ies'}${kinds ? '\nInserted: ' + kinds : ''}${b.del ? '\nDeleted: ' + fmtInt(b.del) : ''}${b.bulk ? '\nBulk insertion' : ''}`));
    root.append(g);
  });

  // Click a bar to go there (Shift: select a range); drag across bars to zoom into them.
  let down = null;
  const barAt = ev => {
    const r = root.getBoundingClientRect();
    const px = ev.clientX - r.left;
    let best = -1;
    for (let i = 0; i < L.xs.length; i++) { if (px >= L.xs[i] - 2) best = i; else break; }
    return Math.max(0, best);
  };
  // A press first stops playback (handlers.press), so the timeline is not redrawn under the pointer before it is released.
  root.addEventListener('pointerdown', ev => {
    down = { x: ev.clientX, i: barAt(ev) };
    root.setPointerCapture(ev.pointerId);
    if (handlers.press) handlers.press();
  });
  root.addEventListener('pointerup', ev => {
    if (!down) return;
    const j = barAt(ev);
    if (Math.abs(ev.clientX - down.x) > 10 && j !== down.i) handlers.zoom(Math.min(down.i, j), Math.max(down.i, j));
    else handlers.select(j, ev.shiftKey);
    down = null;
  });
  host.replaceChildren(root);
  const cx = L.xs[state.cur];
  if (cx != null && (cx < host.scrollLeft || cx > host.scrollLeft + host.clientWidth - 20)) host.scrollLeft = Math.max(0, cx - host.clientWidth / 2);
  return L;
}

export function legend() {
  const items = [0, 1, 2, 3, 4, 5, 6, 7].map(k => ({ k, st: KIND_STYLE[k] }));
  return items;
}
