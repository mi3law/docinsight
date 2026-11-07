// The side panels: summary statistics, the list of bulk insertions, the indicators, authors, and the v1 charts.
// Every number has a ? that opens its definition.

import { el, svg, fmtInt, fmtPct, fmtDateTime, fmtDuration, fmtDate, KIND_STYLE } from './dom.js';
import { authorColor } from './docview.js';
import { CAUSES } from '../engine/definitions.js';

const KIND_BULK = 2, KIND_GEMINI = 4, KIND_TYPED = 0;
const STATUS = {
  flag: { label: 'Flag', cls: 'st-flag', icon: '▲' },
  look: { label: 'Worth a look', cls: 'st-look', icon: '●' },
  ok: { label: 'Nothing unusual', cls: 'st-ok', icon: '✓' },
  info: { label: 'Context', cls: 'st-info', icon: 'i' },
  insufficient: { label: 'Insufficient data', cls: 'st-na', icon: '–' },
};

export const defLink = (id, open, label) => el('button', { type: 'button', class: 'def', title: 'What this means', 'aria-label': 'Definition: ' + (label || id), on: { click: () => open(id) } }, '?');

function stat(label, value, def, open, note) {
  return el('div', { class: 'stat' }, el('dt', {}, label, def ? defLink(def, open, label) : null), el('dd', {}, value, note ? el('span', { class: 'note' }, ' ' + note) : null));
}

export function summaryPanel(A, open) {
  const s = A.stats, w = A.users[A.writer];
  const wpm = s.fastestMinuteWpm;
  const band = !(wpm > 0) ? '' : wpm <= 40 ? '(high-school norm 30–40)' : wpm <= 78 ? '(above the high-school norm)' : wpm <= 120 ? '(top tenth of adult typists)' : '(beyond observed human speed)';
  const G = A.granularity;
  return el('section', { class: 'panel', 'aria-labelledby': 'h-summary' },
    el('h2', { id: 'h-summary' }, 'Summary'),
    el('p', { class: 'summary-text' }, A.summary),
    el('dl', { class: 'stats' },
      stat('Writer', w ? w.name : '—', null, open),
      stat('First edit', fmtDateTime(s.firstEdit), 'time', open),
      stat('Last edit', fmtDateTime(s.lastEdit), 'time', open),
      stat('Sessions', fmtInt(s.sessions), 'session', open, s.calendarDays > 1 ? `over ${s.calendarDays} days` : ''),
      stat('Active writing time', fmtDuration(s.activeMs), 'active', open),
      stat('Final length', `${fmtInt(s.finalWords)} words`, 'word', open, `${fmtInt(s.finalLength)} characters`),
      stat('Characters typed', fmtInt(s.typed + s.chunked), 'chunk', open, s.chunked ? `${fmtInt(s.chunked)} of them in chunks` : ''),
      stat('Characters in bulk insertions', fmtInt(s.pasted + s.gemini), 'bulk', open, s.gemini ? `${fmtInt(s.gemini)} Gemini-like` : ''),
      stat('Characters deleted', fmtInt(s.deleted), null, open),
      stat('Share of the final text from bulk insertions', fmtPct(s.pasteShare), 'pasteShare', open),
      stat('Baseline text in the final text', fmtPct(s.baselineShare), 'baseline', open),
      stat('Edit ratio', Number.isFinite(s.editRatio) ? s.editRatio.toFixed(2) : '—', 'editRatio', open),
      stat('Fastest sustained typing', wpm > 0 ? `${fmtInt(wpm)} WPM` : '—', 'speed', open, band),
      stat('Granularity', G.level === 'keystroke' ? 'keystroke-level' : G.level === 'too-little' ? 'too little typing to tell' : G.level, 'granularity', open,
        G.typingEntries ? `${fmtPct(G.singleShare)} of typing entries hold one character` : ''),
    ),
    el('h3', {}, 'Time of day', defLink('time', open)),
    hoursChart(s.hours),
  );
}

function hoursChart(hours) {
  const W = 288, Hh = 64, max = Math.max(1, ...hours), bw = W / 24;
  const root = svg('svg', { viewBox: `0 0 ${W} ${Hh + 16}`, class: 'mini-chart', role: 'img', 'aria-label': 'Edits by hour of day' });
  hours.forEach((c, h) => {
    const bh = c ? Math.max(2, (c / max) * Hh) : 0;
    const r = svg('rect', { x: h * bw + 1, y: Hh - bh, width: bw - 2, height: bh, rx: 1.5, class: 'bar-ink' });
    r.append(svg('title', {}, `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59: ${fmtInt(c)} edits`));
    root.append(r);
  });
  for (const h of [0, 6, 12, 18]) root.append(svg('text', { x: h * bw + 1, y: Hh + 12, class: 'axis-label' }, String(h).padStart(2, '0')));
  return root;
}

export function bulkPanel(A, jump, open) {
  const items = A.bulk;
  const chunks = A.chunks;
  return el('section', { class: 'panel', 'aria-labelledby': 'h-bulk' },
    el('h2', { id: 'h-bulk' }, 'Bulk insertions', defLink('bulk', open)),
    items.length ? el('ol', { class: 'bulk-list' }, items.map(b => el('li', {},
      el('button', { type: 'button', class: 'bulk-item', on: { click: () => jump(b.entry) } },
        el('span', { class: 'when' }, fmtDateTime(b.t)),
        el('span', { class: 'size' }, `${fmtInt(b.words)} words · ${fmtInt(b.chars)} characters`, b.kind === KIND_GEMINI ? el('span', { class: 'tag gemini' }, 'Gemini-like') : null),
        el('span', { class: 'share' }, `${fmtPct(b.shareOfFinal)} of the final text still from it`),
        el('span', { class: 'first-line' }, '“' + (b.firstLine || '…') + '”'))))) : el('p', { class: 'muted' }, 'No single edit inserted ' + A.settings.bulkChars + ' or more characters.'),
    items.length ? el('details', { class: 'causes' }, el('summary', {}, 'Legitimate causes of a large single insertion'), causesList()) : null,
    chunks.length ? el('details', {}, el('summary', {}, `${chunks.length} chunk${chunks.length === 1 ? '' : 's'} (${A.settings.chunkChars}–${A.settings.bulkChars - 1} characters), listed, not flagged`), defLink('chunk', open),
      el('ol', { class: 'bulk-list small' }, chunks.slice(0, 200).map(b => el('li', {}, el('button', { type: 'button', class: 'bulk-item', on: { click: () => jump(b.entry) } },
        el('span', { class: 'when' }, fmtDateTime(b.t)), el('span', { class: 'size' }, `${fmtInt(b.chars)} characters`), el('span', { class: 'first-line' }, '“' + b.firstLine + '”')))))) : null,
    A.moves.length ? el('p', { class: 'muted' }, `${A.moves.length} internal move${A.moves.length === 1 ? '' : 's'} recognised and not counted `, defLink('move', open)) : null,
  );
}

export const causesList = () => el('ul', { class: 'causes-list' }, CAUSES.map(([c, how]) => el('li', {}, el('strong', {}, c), ': ', how)));

export function indicatorsPanel(A, open) {
  const groups = [
    ['Facts', A.indicators.filter(x => x.tier === 'fact')],
    ['Indicators', A.indicators.filter(x => x.tier === 'indicator' && !x.experimental)],
    ['Experimental rhythm indicators', A.indicators.filter(x => x.tier === 'indicator' && x.experimental)],
    ['Labels', A.indicators.filter(x => x.tier === 'label')],
  ];
  return el('section', { class: 'panel', 'aria-labelledby': 'h-ind' },
    el('h2', { id: 'h-ind' }, 'What the log shows'),
    el('p', { class: 'muted' }, 'Each indicator shows its data, its rule and its known false positives. They are never combined into one score; the conclusion is yours.'),
    groups.filter(g => g[1].length).map(([title, list]) => el('div', { class: 'ind-group' },
      el('h3', {}, title, title.startsWith('Experimental') ? defLink('experimental', open) : null),
      list.map(x => indicatorCard(x, open)))),
  );
}

function indicatorCard(x, open) {
  const st = STATUS[x.status] || STATUS.info;
  return el('details', { class: 'ind ' + st.cls },
    el('summary', {}, el('span', { class: 'chip ' + st.cls }, el('span', { 'aria-hidden': 'true' }, st.icon + ' '), st.label), ' ', el('strong', {}, x.title), x.experimental ? el('span', { class: 'tag' }, 'experimental') : null,
      el('span', { class: 'headline' }, x.headline)),
    el('table', { class: 'values' }, x.values.map(v => el('tr', {}, el('th', {}, v.label), el('td', {}, v.value)))),
    x.chart && x.chart.kind === 'histogram' ? histogram(x.chart) : null,
    x.chart && x.chart.kind === 'series' && x.chart.values.length > 1 ? series(x.chart) : null,
    el('p', {}, el('strong', {}, 'Rule: '), x.rule),
    el('p', {}, el('strong', {}, 'Strength: '), x.strength),
    el('p', {}, el('strong', {}, 'Known false positives: '), x.falsePositives),
    el('p', {}, defLink(x.def, open, x.title), ' Definition'),
  );
}

function histogram(c) {
  const W = 300, Hh = 70, n = c.bins.length, max = Math.max(1, ...c.bins), bw = W / n;
  const root = svg('svg', { viewBox: `0 0 ${W} ${Hh + 16}`, class: 'mini-chart', role: 'img', 'aria-label': c.label });
  c.bins.forEach((v, i) => {
    const h = v ? Math.max(1.5, (v / max) * Hh) : 0;
    const r = svg('rect', { x: i * bw + 0.5, y: Hh - h, width: Math.max(1, bw - 1), height: h, rx: 1, class: 'bar-ink' });
    r.append(svg('title', {}, `${(i * c.width / 1000).toFixed(1)}–${((i + 1) * c.width / 1000).toFixed(1)} s${i === n - 1 ? '+' : ''}: ${fmtInt(v)}`));
    root.append(r);
  });
  root.append(svg('text', { x: 0, y: Hh + 12, class: 'axis-label' }, '0 s'));
  root.append(svg('text', { x: W - 24, y: Hh + 12, class: 'axis-label' }, '10 s'));
  return el('figure', { class: 'fig' }, root, el('figcaption', {}, c.label));
}

function series(c) {
  return el('figure', { class: 'fig' }, lineChart(c.values, c.label, v => `${fmtInt(v)} per minute`), el('figcaption', {}, c.label));
}

function lineChart(values, label, fmt, opts = {}) {
  const W = 300, Hh = 70, n = values.length, max = Math.max(1, ...values);
  const x = i => (n === 1 ? W / 2 : (i / (n - 1)) * (W - 4) + 2), y = v => Hh - (v / max) * (Hh - 4);
  const root = svg('svg', { viewBox: `0 0 ${W} ${Hh + 4}`, class: 'mini-chart', role: 'img', 'aria-label': label });
  root.append(svg('polyline', { points: values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '), class: 'line-ink' }));
  values.forEach((v, i) => {
    const c = svg('circle', { cx: x(i), cy: y(v), r: 6, class: 'hit' });
    c.append(svg('title', {}, (opts.labels ? opts.labels[i] + ': ' : '') + fmt(v)));
    root.append(c);
  });
  return root;
}

export function authorsPanel(A, open, actions) {
  return el('section', { class: 'panel', 'aria-labelledby': 'h-authors' },
    el('h2', { id: 'h-authors' }, 'Authors'),
    el('ul', { class: 'authors' }, A.users.map((u, i) => el('li', { class: u.role },
      el('span', { class: 'swatch', style: `background:${authorColor(A, i)}` }),
      el('span', { class: 'name' }, u.name),
      el('span', { class: 'role' }, u.role === 'writer' ? 'writer' : u.role === 'teacher' ? 'you (left out of the statistics)' : 'other account'),
      el('span', { class: 'counts' }, `${fmtInt(u.ins)} inserted · ${fmtInt(u.del)} deleted · ${fmtInt(u.entries)} edits`),
      actions && actions.setMe ? (u.role === 'teacher'
        ? el('button', { type: 'button', class: 'link', on: { click: () => actions.setMe(null) } }, 'Not me')
        : el('button', { type: 'button', class: 'link', on: { click: () => actions.setMe(u.key) } }, 'This is my account')) : null,
    ))),
    el('p', { class: 'muted' }, 'Names and colours come from Google\'s own author list; Google gives no email addresses. Comments are not part of the history.'),
  );
}

// Charts (v1 should): typing speed over time, cursor position against time, and pause lengths.
export function chartsPanel(A, open) {
  const E = A.entries, w = A.writer;
  const section = el('section', { class: 'panel', 'aria-labelledby': 'h-charts' }, el('h2', { id: 'h-charts' }, 'Charts'));
  const speedHost = el('div');
  const pick = el('select', { 'aria-label': 'Window', on: { change: () => draw() } }, [1, 5, 15].map(m => el('option', { value: m }, `${m}-minute windows`)));
  function draw() {
    const win = Number(pick.value) * 60000;
    const vals = [], labels = [];
    for (const s of A.sessions) {
      if (!s.writerEntries) continue;
      for (let t = s.t0; t <= s.t1; t += win) {
        let c = 0;
        for (let i = s.a; i <= s.b; i++) if (E.uid[i] === w && A.kind[i] === KIND_TYPED && E.t[i] >= t && E.t[i] < t + win) c += E.insNew[i];
        vals.push((c / 5) / (win / 60000));
        labels.push(fmtDateTime(t));
      }
    }
    speedHost.replaceChildren(vals.length > 1 ? lineChart(vals, 'Typing speed over time (WPM)', v => `${v.toFixed(0)} WPM`, { labels }) : el('p', { class: 'muted' }, 'Not enough typing for a chart.'));
  }
  draw();
  section.append(el('h3', {}, 'Typing speed over time (words per minute) ', pick, defLink('speed', open)), speedHost, el('p', { class: 'muted' }, 'Sessions joined end to end; gaps between sessions left out.'));

  // Cursor position: where in the document each edit happened, as a share of its length, edit by edit.
  const W = 300, Hh = 110;
  const cur = svg('svg', { viewBox: `0 0 ${W} ${Hh}`, class: 'mini-chart', role: 'img', 'aria-label': 'Cursor position in the document against edits' });
  const pts = [];
  for (let i = 0; i < E.n; i++) if (E.pos[i] >= 0 && E.uid[i] === w) pts.push(i);
  const step = Math.max(1, Math.floor(pts.length / 1500));
  for (let j = 0; j < pts.length; j += step) {
    const i = pts[j];
    const len = Math.max(1, E.len[i]);
    const x = (j / Math.max(1, pts.length - 1)) * (W - 4) + 2;
    const y = (E.pos[i] / len) * (Hh - 4) + 2;
    const bulk = A.kind[i] === KIND_BULK || A.kind[i] === KIND_GEMINI;
    cur.append(svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: bulk ? 3.5 : 1.4, fill: bulk ? KIND_STYLE[KIND_BULK].color : A.kind[i] === 7 ? KIND_STYLE[7].color : KIND_STYLE[0].color, 'fill-opacity': bulk ? 1 : 0.55 }));
  }
  section.append(el('h3', {}, 'Cursor position against edits', defLink('linearity', open)), cur,
    el('p', { class: 'muted' }, 'Top of the chart is the start of the document. A person moves around; a bulk insertion or a typing bot moves in a straight line down. Blue: typing; red: deletions; amber: bulk insertions.'));

  const pauses = A.indicators.find(x => x.id === 'pauses');
  if (pauses && pauses.chart) section.append(el('h3', {}, 'Pause lengths', defLink('pauses', open)), histogram(pauses.chart));
  return section;
}

export function warningsBanner(A) {
  const strong = A.warnings.filter(w => w.level === 'strong');
  const notes = A.warnings.filter(w => w.level !== 'strong');
  if (!A.warnings.length) return null;
  return el('div', { class: 'warnings', role: 'note' },
    strong.map(w => el('p', { class: 'warn strong' }, el('span', { 'aria-hidden': 'true' }, '⚠ '), w.text)),
    notes.map(w => el('p', { class: 'warn' }, w.text)));
}

export { fmtDate };
